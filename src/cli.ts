#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import os from 'os';
import readline from 'readline';
import { initDB, run, get, all } from './db';
import { printContainerLogs } from './docker';
import { startCaddy, generateAndReload } from './caddy';
import { deployProject } from './deployer';

// ── Auth helpers ─────────────────────────────────────────────────────────────

const AUTH_PATH = path.join(os.homedir(), '.mini-vercel-auth.json');
const DAEMON_URL = `http://localhost:${process.env.DAEMON_PORT || 4000}`;

function readAuth(): { userId: string; sessionToken: string; email: string } | null {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function requireAuth(): { userId: string; sessionToken: string; email: string } {
  const auth = readAuth();
  if (!auth) {
    console.error('Error: Not logged in. Run "mini-vercel login" first.');
    process.exit(1);
  }
  return auth;
}

/** Prompt for a value, optionally masking input (for passwords). */
function prompt(question: string, silent = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (silent) {
      process.stdout.write(question);
      process.stdin.setRawMode?.(true);
      let input = '';
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', function handler(ch: string) {
        if (ch === '\n' || ch === '\r' || ch === '\u0003') {
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener('data', handler);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (ch === '\u007f') {
          input = input.slice(0, -1);
        } else {
          input += ch;
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/** POST to the daemon, attaching the session token as Bearer auth. */
async function daemonPost(endpoint: string, body: any, token?: string): Promise<any> {
  const nodeFetch = require('node-fetch');
  const fetch = nodeFetch.default || nodeFetch;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${DAEMON_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const program = new Command();
program
  .name('mini-vercel')
  .description('A self-hosted PaaS CLI')
  .version('2.0.0');

// ── start-daemon ─────────────────────────────────────────────────────────────

program
  .command('start-daemon')
  .description('Starts the background daemon server')
  .action(async () => {
    const daemonPath = path.join(__dirname, 'daemon.js');
    console.log('Starting daemon...');
    const child = spawn('node', [daemonPath], { detached: true, stdio: 'ignore' });
    child.unref();
    console.log('Daemon started in background.');
    console.log('Ensuring Caddy is running...');
    await startCaddy();
    console.log('Caddy is ready.');
  });

// ── signup ────────────────────────────────────────────────────────────────────

program
  .command('signup')
  .description('Create a persistent local account')
  .action(async () => {
    const email = await prompt('Email: ');
    const password = await prompt('Password: ', true);
    const confirm = await prompt('Confirm password: ', true);

    if (password !== confirm) {
      console.error('Error: Passwords do not match.');
      process.exit(1);
    }
    if (password.length < 8) {
      console.error('Error: Password must be at least 8 characters.');
      process.exit(1);
    }

    const data = await daemonPost('/auth/signup', { email, password });
    if (data.error) {
      console.error('Signup failed:', data.error);
      process.exit(1);
    }

    fs.writeFileSync(AUTH_PATH, JSON.stringify({ userId: data.userId, sessionToken: data.sessionToken, email }, null, 2));
    console.log(`Account created and logged in as ${email}.`);
    console.log(`Session saved to ${AUTH_PATH}`);
  });

// ── login ─────────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with your local account')
  .action(async () => {
    const email = await prompt('Email: ');
    const password = await prompt('Password: ', true);

    const data = await daemonPost('/auth/login', { email, password });
    if (data.error) {
      console.error('Login failed:', data.error);
      process.exit(1);
    }

    fs.writeFileSync(AUTH_PATH, JSON.stringify({ userId: data.userId, sessionToken: data.sessionToken, email }, null, 2));
    console.log(`Logged in as ${email}.`);
  });

// ── logout ────────────────────────────────────────────────────────────────────

program
  .command('logout')
  .description('Destroy the current session')
  .action(async () => {
    const auth = readAuth();
    if (auth) {
      await daemonPost('/auth/logout', {}, auth.sessionToken).catch(() => {});
    }
    if (fs.existsSync(AUTH_PATH)) fs.unlinkSync(AUTH_PATH);
    console.log('Logged out. Session destroyed.');
  });

// ── whoami ────────────────────────────────────────────────────────────────────

program
  .command('whoami')
  .description('Show the currently logged-in account')
  .action(() => {
    const auth = readAuth();
    if (!auth) {
      console.log('Not logged in.');
    } else {
      console.log(`Logged in as: ${auth.email} (userId: ${auth.userId})`);
    }
  });

// ── link ──────────────────────────────────────────────────────────────────────

program
  .command('link')
  .description('Connect the current directory to a project')
  .option('-n, --name <name>', 'Project name')
  .option('-r, --repo <repo>', 'GitHub repository URL')
  .action(async (options) => {
    await initDB();
    const auth = requireAuth();
    const dirName = path.basename(process.cwd());
    const projectName = options.name || dirName;
    const repoUrl = options.repo || null;
    const projectId = uuidv4();

    try {
      await run(
        'INSERT INTO projects (id, name, path, repository_url) VALUES (?, ?, ?, ?)',
        [projectId, projectName, process.cwd(), repoUrl]
      );
      console.log(`Project "${projectName}" linked (user: ${auth.email}).`);
    } catch (error: any) {
      if (error.message.includes('UNIQUE constraint failed')) {
        console.error(`Error: Project name "${projectName}" already exists.`);
      } else {
        console.error('Failed to link project:', error);
      }
    }
  });

// ── deploy ────────────────────────────────────────────────────────────────────

program
  .command('deploy')
  .description('Manually trigger a Docker build and deployment')
  .action(async () => {
    await initDB();
    requireAuth(); // ensures user is logged in before any work happens
    const cwd = process.cwd();
    const project = await get('SELECT * FROM projects WHERE path = ?', [cwd]);
    if (!project) {
      console.error('Error: Project not found. Run "mini-vercel link" first.');
      process.exit(1);
    }
    try {
      await deployProject({ project, sourcePath: cwd, env: 'production' });
    } catch (err: any) {
      console.error('Deployment failed:', err);
    }
  });

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all projects and their status')
  .action(async () => {
    await initDB();
    requireAuth();
    const projects = await all(`
      SELECT p.name, d.port, d.status
      FROM projects p
      LEFT JOIN deployments d ON p.id = d.project_id
      WHERE d.created_at = (
        SELECT MAX(created_at) FROM deployments WHERE project_id = p.id
      ) OR d.id IS NULL
    `);
    console.log('Projects:');
    console.table(projects.map(p => ({
      Project: p.name,
      Status: p.status || 'No Deployments',
      URL: p.status === 'running' ? `http://${p.name}.localhost:8080` : 'N/A',
    })));
  });

// ── env ───────────────────────────────────────────────────────────────────────

const envCmd = program
  .command('env')
  .description('Manage environment variables for the current project');

envCmd
  .command('add <key> <value>')
  .description('Add or update an environment variable')
  .action(async (key, value) => {
    await initDB();
    requireAuth();
    const project = await get('SELECT * FROM projects WHERE path = ?', [process.cwd()]);
    if (!project) { console.error('Error: Project not found.'); process.exit(1); }
    await run(
      'INSERT INTO env_vars (id, project_id, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value',
      [uuidv4(), project.id, key, value]
    );
    console.log(`Set ${key} on project "${project.name}".`);
  });

envCmd
  .command('rm <key>')
  .description('Remove an environment variable')
  .action(async (key) => {
    await initDB();
    requireAuth();
    const project = await get('SELECT * FROM projects WHERE path = ?', [process.cwd()]);
    if (!project) { console.error('Error: Project not found.'); process.exit(1); }
    await run('DELETE FROM env_vars WHERE project_id = ? AND key = ?', [project.id, key]);
    console.log(`Removed ${key} from project "${project.name}".`);
  });

envCmd
  .command('pull')
  .description('Write stored env vars to a local .env file')
  .action(async () => {
    await initDB();
    requireAuth();
    const project = await get('SELECT * FROM projects WHERE path = ?', [process.cwd()]);
    if (!project) { console.error('Error: Project not found.'); process.exit(1); }
    const vars = await all('SELECT key, value FROM env_vars WHERE project_id = ?', [project.id]);
    if (!vars.length) { console.log('No environment variables found.'); return; }
    fs.writeFileSync(path.join(process.cwd(), '.env'), vars.map(r => `${r.key}=${r.value}`).join('\n'));
    console.log(`Wrote ${vars.length} variables to .env`);
  });

// ── logs ──────────────────────────────────────────────────────────────────────

program
  .command('logs [project-name]')
  .description('View logs for a deployed project')
  .option('-f, --follow', 'Stream live log output')
  .action(async (projectName, options) => {
    await initDB();
    requireAuth();
    const project = projectName
      ? await get('SELECT * FROM projects WHERE name = ?', [projectName])
      : await get('SELECT * FROM projects WHERE path = ?', [process.cwd()]);
    if (!project) { console.error('Error: Project not found.'); process.exit(1); }

    const dep = await get(
      'SELECT container_id FROM deployments WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      [project.id, 'running']
    );
    if (!dep?.container_id) { console.error('No running container for this project.'); process.exit(1); }

    console.log(`Logs for "${project.name}" (${dep.container_id.slice(0, 12)}):`);
    await printContainerLogs(dep.container_id, options.follow);
  });

// ── domain ────────────────────────────────────────────────────────────────────

const domainCmd = program
  .command('domain')
  .description('Manage custom domains for the current project');

domainCmd
  .command('add <domain>')
  .action(async (domain) => {
    await initDB();
    requireAuth();
    const project = await get('SELECT * FROM projects WHERE path = ?', [process.cwd()]);
    if (!project) { console.error('Error: Project not found.'); process.exit(1); }
    await run('UPDATE projects SET custom_domain = ? WHERE id = ?', [domain, project.id]);
    console.log(`Custom domain ${domain} set on "${project.name}".`);
    await generateAndReload();
  });

domainCmd
  .command('rm')
  .action(async () => {
    await initDB();
    requireAuth();
    const project = await get('SELECT * FROM projects WHERE path = ?', [process.cwd()]);
    if (!project) { console.error('Error: Project not found.'); process.exit(1); }
    await run('UPDATE projects SET custom_domain = NULL WHERE id = ?', [project.id]);
    console.log(`Custom domain removed from "${project.name}".`);
    await generateAndReload();
  });

// ── rollback ──────────────────────────────────────────────────────────────────

program
  .command('rollback')
  .description('Rollback to the previous deployment')
  .action(async () => {
    await initDB();
    requireAuth();
    const project = await get('SELECT * FROM projects WHERE path = ?', [process.cwd()]);
    if (!project) { console.error('Error: Project not found.'); process.exit(1); }

    const running = await get(
      'SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ?',
      [project.id, 'running', 'production']
    );
    const stopped = await all(
      'SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ? ORDER BY created_at DESC LIMIT 3',
      [project.id, 'stopped', 'production']
    );
    if (!stopped.length) { console.error('No previous deployments available.'); return; }

    const target = stopped[0];
    console.log(`Rolling back to deployment from ${target.created_at}...`);
    if (running) await run('UPDATE deployments SET status = ? WHERE id = ?', ['stopped', running.id]);
    await run('UPDATE deployments SET status = ? WHERE id = ?', ['running', target.id]);
    await generateAndReload();
    console.log('Rollback complete.');
  });

program.parse(process.argv);