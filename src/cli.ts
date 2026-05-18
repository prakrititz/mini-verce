#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import readline from 'readline';
import { startCaddy } from './caddy';
import { printContainerLogs } from './docker';
import { initDB, get, all, run } from './db';

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTH_PATH = path.join(os.homedir(), '.mini-vercel-auth.json');
const DAEMON_URL = `http://localhost:${process.env.DAEMON_PORT || 4000}`;

// ── Auth helpers ──────────────────────────────────────────────────────────────

interface AuthSession {
  userId: string;
  sessionToken: string;
  email: string;
}

function readAuth(): AuthSession | null {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function requireAuth(): AuthSession {
  const auth = readAuth();
  if (!auth) {
    console.error('Not logged in. Run "mini-vercel login" first.');
    process.exit(1);
  }
  return auth;
}

// ── Daemon HTTP helpers ───────────────────────────────────────────────────────

function fetch() {
  const nodeFetch = require('node-fetch');
  return nodeFetch.default || nodeFetch;
}

async function daemonRequest(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  endpoint: string,
  token: string | undefined,
  body?: any
): Promise<any> {
  const f = fetch();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await f(`${DAEMON_URL}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.error) {
    console.error(`Error: ${data.error}`);
    process.exit(1);
  }
  return data;
}

// Shorthand wrappers
const daemonGet  = (ep: string, token: string) => daemonRequest('GET',    ep, token);
const daemonPost = (ep: string, token: string | undefined, body: any) => daemonRequest('POST',   ep, token, body);
const daemonPut    = (ep: string, token: string, body: any) => daemonRequest('PUT',    ep, token, body);
const daemonPatch  = (ep: string, token: string, body: any) => daemonRequest('PATCH',  ep, token, body);
const daemonDelete = (ep: string, token: string)             => daemonRequest('DELETE', ep, token);

// ── Prompt helper ─────────────────────────────────────────────────────────────

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
      rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
    }
  });
}

// ── CLI definition ────────────────────────────────────────────────────────────

const program = new Command();
program
  .name('mini-vercel')
  .description('A self-hosted PaaS CLI')
  .version('2.0.0');

// ── start-daemon ──────────────────────────────────────────────────────────────

program
  .command('start-daemon')
  .description('Start the background daemon server and Caddy proxy')
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

// ── caddy ─────────────────────────────────────────────────────────────────────

const caddyCmd = program
  .command('caddy')
  .description('Manage Caddy TLS configuration');

caddyCmd
  .command('trust')
  .description('Install Caddy local CA into the system trust store (run once, local mode only)')
  .action(async () => {
    const f = fetch();
    let data: any;
    try {
      const res = await f(`${DAEMON_URL}/api/caddy/trust`, { method: 'POST' });
      data = await res.json();
    } catch {
      console.error('Could not reach the daemon. Is it running? Run "mini-vercel start-daemon".');
      process.exit(1);
    }
    if (data.error) { console.error(`Error: ${data.error}`); process.exit(1); }
    console.log('✓', data.message);
    if (data.output) console.log(data.output);
  });

caddyCmd
  .command('mode')
  .description('Show current Caddy TLS mode and port configuration')
  .action(async () => {
    const f = fetch();
    let data: any;
    try {
      const res = await f(`${DAEMON_URL}/api/caddy/mode`);
      data = await res.json();
    } catch {
      console.error('Could not reach the daemon. Is it running? Run "mini-vercel start-daemon".');
      process.exit(1);
    }
    console.log(`Mode:        ${data.mode}`);
    console.log(`Description: ${data.description}`);
    console.log(`HTTP port:   ${data.httpPort}`);
    console.log(`HTTPS port:  ${data.httpsPort}`);
    console.log('');
    if (data.mode === 'local') {
      console.log('Tip: run "mini-vercel caddy trust" once to install the local CA.');
      console.log('     Then visit https://<project>.localhost in your browser.');
    } else {
      console.log('Tip: set CADDY_MODE=local in your .env for local development.');
    }
  });

// ── signup ────────────────────────────────────────────────────────────────────

program
  .command('signup')
  .description('Create a persistent local account')
  .action(async () => {
    const email    = await prompt('Email: ');
    const password = await prompt('Password: ', true);
    const confirm  = await prompt('Confirm password: ', true);

    if (password !== confirm) { console.error('Passwords do not match.'); process.exit(1); }
    if (password.length < 8)  { console.error('Password must be at least 8 characters.'); process.exit(1); }

    const data = await daemonPost('/auth/signup', undefined, { email, password });
    fs.writeFileSync(AUTH_PATH, JSON.stringify({ userId: data.userId, sessionToken: data.sessionToken, email }, null, 2));
    console.log(`Account created. Logged in as ${email}.`);
    console.log(`Session saved to ${AUTH_PATH}`);
  });

// ── login ─────────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with your local account')
  .action(async () => {
    const email    = await prompt('Email: ');
    const password = await prompt('Password: ', true);

    const data = await daemonPost('/auth/login', undefined, { email, password });
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
      const f = fetch();
      await f(`${DAEMON_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${auth.sessionToken}` }
      }).catch(() => {});
    }
    if (fs.existsSync(AUTH_PATH)) fs.unlinkSync(AUTH_PATH);
    console.log('Logged out.');
  });

// ── whoami ────────────────────────────────────────────────────────────────────

program
  .command('whoami')
  .description('Show the currently logged-in account')
  .action(() => {
    const auth = readAuth();
    if (!auth) console.log('Not logged in.');
    else console.log(`Logged in as: ${auth.email}  (userId: ${auth.userId})`);
  });

// ── github ────────────────────────────────────────────────────────────────────

const githubCmd = program
  .command('github')
  .description('Manage your GitHub account connection');

githubCmd
  .command('connect')
  .description('Link your GitHub account via Personal Access Token')
  .action(async () => {
    const { sessionToken } = requireAuth();

    console.log('');
    console.log('Create a PAT at: https://github.com/settings/tokens/new');
    console.log('Required scopes: repo, admin:repo_hook');
    console.log('');

    const pat = await prompt('Paste your GitHub Personal Access Token: ', true);
    if (!pat.trim()) {
      console.error('No token provided.');
      process.exit(1);
    }

    const data = await daemonPost('/auth/github/connect', sessionToken, { pat: pat.trim() });
    console.log(`\n✓ ${data.message}`);
    console.log('You can now run "mini-vercel import" to link repos interactively.');
  });

githubCmd
  .command('status')
  .description('Show current GitHub connection status')
  .action(async () => {
    const { sessionToken } = requireAuth();
    const data = await daemonGet('/auth/github/status', sessionToken);
    if (data.connected) {
      console.log(`GitHub connected: @${data.githubUsername}`);
    } else {
      console.log('GitHub not connected. Run "mini-vercel github connect".');
    }
  });

githubCmd
  .command('disconnect')
  .description('Remove your stored GitHub credentials')
  .action(async () => {
    const { sessionToken } = requireAuth();
    await daemonDelete('/auth/github/disconnect', sessionToken);
    console.log('GitHub account disconnected.');
  });

githubCmd
  .command('oauth')
  .description('Link your GitHub account via OAuth (Option B — requires OAuth App in .env)')
  .action(async () => {
    const { sessionToken } = requireAuth();
    const f = fetch();

    // Check if OAuth is configured on the daemon side first
    const modeCheck = await f(`${DAEMON_URL}/auth/github/start`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${sessionToken}` },
      redirect: 'manual', // don't follow the redirect — we want the URL
    });

    if (modeCheck.status === 503) {
      const data = await modeCheck.json();
      console.error(`Error: ${(data as any).error}`);
      console.error('Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your .env file.');
      console.error('Register an OAuth App at: https://github.com/settings/applications/new');
      process.exit(1);
    }

    // The daemon replied with a 302 → extract the Location header
    const authorizeUrl = modeCheck.headers.get('location');
    if (!authorizeUrl) {
      console.error('Unexpected response from daemon. Is the daemon running?');
      process.exit(1);
    }

    // Open the browser automatically (cross-platform)
    const { exec: execCb } = require('child_process');
    const openCmd = process.platform === 'win32' ? `start "" "${authorizeUrl}"`
                  : process.platform === 'darwin' ? `open "${authorizeUrl}"`
                  : `xdg-open "${authorizeUrl}"`;
    execCb(openCmd);

    console.log('');
    console.log('Opening GitHub authorization page in your browser…');
    console.log(`If it didn't open automatically, visit:\n  ${authorizeUrl}`);
    console.log('');
    console.log('Waiting for authorization (timeout: 5 minutes)…');

    // Poll github/status until the token appears (set by the callback)
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const statusRes = await f(`${DAEMON_URL}/auth/github/status`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        const status = await statusRes.json() as any;
        if (status.connected) {
          console.log(`\n✓ Connected as @${status.githubUsername}`);
          console.log('You can now run "mini-vercel import" to link repos interactively.');
          return;
        }
      } catch { /* daemon may briefly restart */ }
    }

    console.error('\nTimeout: GitHub authorization was not completed within 5 minutes.');
    console.error('Run "mini-vercel github oauth" to try again.');
    process.exit(1);
  });

// ── import ────────────────────────────────────────────────────────────────────

program
  .command('import')
  .description('Interactively select a GitHub repo and link it as a project')
  .option('-n, --name <name>', 'Override the project name')
  .action(async (options) => {
    const { sessionToken } = requireAuth();
    const cwd = process.cwd();

    // 1. Fetch repo list from daemon (uses stored PAT)
    console.log('Fetching your GitHub repositories...');
    const { repos } = await daemonGet('/api/github/repos', sessionToken);

    if (!repos.length) {
      console.log('No repositories found. Make sure your PAT has "repo" scope.');
      process.exit(1);
    }

    // 2. Prompt for selection using inquirer
    const inquirer = require('inquirer');
    const { selectedRepo } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedRepo',
        message: 'Select a repository to link:',
        choices: repos.map((r: any) => ({
          name:  `${r.fullName}${r.private ? ' 🔒' : ''} (${r.defaultBranch})`,
          value: r,
        })),
        pageSize: 15,
      },
    ]);

    // 3. Confirm project name
    const defaultName = options.name || selectedRepo.name;
    const { projectName } = await inquirer.prompt([
      {
        type:    'input',
        name:    'projectName',
        message: 'Project name:',
        default: defaultName,
      },
    ]);

    // 4. Link the project and auto-register webhook via daemon
    console.log(`\nLinking "${projectName}" → ${selectedRepo.fullName}...`);
    const data = await daemonPost('/api/projects/link-github', sessionToken, {
      name:         projectName,
      path:         cwd,
      repoFullName: selectedRepo.fullName,
    });

    console.log(`\n✓ Project "${data.name}" linked.`);
    console.log(`  Repo:    https://github.com/${data.repoFullName}`);
    console.log(`  Webhook: ${data.webhookStatus}`);
    console.log(`\nRun "mini-vercel deploy" to trigger your first deployment.`);
  });

// ── link ──────────────────────────────────────────────────────────────────────

program
  .command('link')
  .description('Register the current directory as a project')
  .option('-n, --name <name>', 'Project name (defaults to folder name)')
  .option('-r, --repo <repo>', 'GitHub repository URL')
  .action(async (options) => {
    const { sessionToken, email } = requireAuth();
    const cwd  = process.cwd();
    const name = options.name || path.basename(cwd);

    const data = await daemonPost('/api/projects/link', sessionToken, {
      name,
      path: cwd,
      repositoryUrl: options.repo || null,
    });

    console.log(`Project "${data.name}" linked.`);
    console.log(`Owner: ${email} | ID: ${data.projectId}`);
  });

// ── deploy ────────────────────────────────────────────────────────────────────

program
  .command('deploy')
  .description('Trigger a production build and deployment')
  .action(async () => {
    const { sessionToken } = requireAuth();
    const cwd = process.cwd();

    // Phase 3: resolve project via daemon (ownership enforced server-side)
    const { project } = await daemonGet(`/api/projects/by-path?path=${encodeURIComponent(cwd)}`, sessionToken);
    const data = await daemonPost(`/api/projects/${project.id}/deploy`, sessionToken, {});

    console.log(`Deployment enqueued (buildId: ${data.buildId})`);
    console.log(`Watch logs: mini-vercel logs`);
  });

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List your projects and their deployment status')
  .action(async () => {
    const { sessionToken } = requireAuth();
    const { projects } = await daemonGet('/api/projects', sessionToken);

    if (!projects.length) { console.log('No projects yet. Run "mini-vercel link".'); return; }

    console.log('\nYour Projects:');
    console.table(projects.map((p: any) => ({
      Project: p.name,
      Status:  p.status || 'no deployments',
      URL:     p.status === 'running' ? `http://${p.name}.localhost:8080` : 'N/A',
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
    const { sessionToken } = requireAuth();
    const { project } = await daemonGet(`/api/projects/by-path?path=${encodeURIComponent(process.cwd())}`, sessionToken);
    await daemonPut(`/api/projects/${project.id}/env`, sessionToken, { key, value });
    console.log(`Set ${key} on "${project.name}".`);
  });

envCmd
  .command('rm <key>')
  .description('Remove an environment variable')
  .action(async (key) => {
    const { sessionToken } = requireAuth();
    const { project } = await daemonGet(`/api/projects/by-path?path=${encodeURIComponent(process.cwd())}`, sessionToken);
    await daemonDelete(`/api/projects/${project.id}/env/${encodeURIComponent(key)}`, sessionToken);
    console.log(`Removed ${key} from "${project.name}".`);
  });

envCmd
  .command('pull')
  .description('Write stored env vars to a local .env file')
  .action(async () => {
    const { sessionToken } = requireAuth();
    const cwd = process.cwd();
    const { project } = await daemonGet(`/api/projects/by-path?path=${encodeURIComponent(cwd)}`, sessionToken);
    const { vars } = await daemonGet(`/api/projects/${project.id}/env`, sessionToken);
    if (!vars.length) { console.log('No environment variables found.'); return; }
    fs.writeFileSync(path.join(cwd, '.env'), vars.map((v: any) => `${v.key}=${v.value}`).join('\n'));
    console.log(`Wrote ${vars.length} variable(s) to .env`);
  });

// ── logs ──────────────────────────────────────────────────────────────────────

program
  .command('logs [project-name]')
  .description('View logs for a deployed project')
  .option('-f, --follow', 'Stream live log output')
  .action(async (projectName, options) => {
    await initDB();
    const { sessionToken, userId } = requireAuth();

    // Resolve project — either by name arg or by cwd, scoped to this user
    let project: any;
    if (projectName) {
      project = await get('SELECT * FROM projects WHERE name = ? AND owner_id = ?', [projectName, userId]);
    } else {
      const res = await daemonGet(`/api/projects/by-path?path=${encodeURIComponent(process.cwd())}`, sessionToken);
      project = res.project;
    }

    if (!project) { console.error('Project not found.'); process.exit(1); }

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
  .description('Set a custom domain')
  .action(async (domain) => {
    const { sessionToken } = requireAuth();
    const { project } = await daemonGet(`/api/projects/by-path?path=${encodeURIComponent(process.cwd())}`, sessionToken);
    await daemonPatch(`/api/projects/${project.id}/domain`, sessionToken, { domain });
    console.log(`Custom domain "${domain}" set on "${project.name}".`);
  });

domainCmd
  .command('rm')
  .description('Remove the custom domain')
  .action(async () => {
    const { sessionToken } = requireAuth();
    const { project } = await daemonGet(`/api/projects/by-path?path=${encodeURIComponent(process.cwd())}`, sessionToken);
    await daemonPatch(`/api/projects/${project.id}/domain`, sessionToken, { domain: null });
    console.log(`Custom domain removed from "${project.name}".`);
  });

// ── rollback ──────────────────────────────────────────────────────────────────

program
  .command('rollback')
  .description('Roll back to the previous deployment')
  .action(async () => {
    const { sessionToken } = requireAuth();
    const { project } = await daemonGet(`/api/projects/by-path?path=${encodeURIComponent(process.cwd())}`, sessionToken);
    const data = await daemonPost(`/api/projects/${project.id}/rollback`, sessionToken, {});
    console.log(data.message);
    console.log(`Restored deployment from: ${data.deployedAt}`);
  });

program.parse(process.argv);