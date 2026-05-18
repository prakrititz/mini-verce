#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { initDB, run, get, all } from './db';
import { buildImage, startContainer, stopContainer, printContainerLogs } from './docker';
import { startCaddy, generateAndReload } from './caddy';
import { ensureDockerAssets } from './frameworks';
import { deployProject } from './deployer';

const program = new Command();
program
  .name('mini-vercel')
  .description('A self-hosted PaaS CLI')
  .version('1.0.0');

program
  .command('start-daemon')
  .description('Starts the background Express server')
  .action(async () => {
    const daemonPath = path.join(__dirname, 'daemon.js');
    console.log('Starting daemon...');

    const child = spawn('node', [daemonPath], {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();
    console.log('Daemon started in background.');

    console.log('Ensuring Caddy is running...');
    await startCaddy();
    console.log('Caddy is ready.');
  });

program
  .command('login')
  .description('Authenticate the CLI with the local daemon')
  .action(async () => {
    await initDB();
    const token = uuidv4();
    const id = uuidv4();

    await run('INSERT INTO users (id, token) VALUES (?, ?)', [id, token]);

    const authPath = path.join(require('os').homedir(), '.mini-vercel-auth.json');
    fs.writeFileSync(authPath, JSON.stringify({ token }));
    console.log(`Logged in successfully! Token saved to ${authPath}`);
  });

program
  .command('link')
  .description('Connect the current directory to a project')
  .option('-n, --name <name>', 'Project name')
  .option('-r, --repo <repo>', 'GitHub repository URL')
  .action(async (options) => {
    await initDB();
    const dirName = path.basename(process.cwd());
    const projectName = options.name || dirName;
    const repoUrl = options.repo || null;
    const projectId = uuidv4();

    try {
      await run(
        'INSERT INTO projects (id, name, path, repository_url) VALUES (?, ?, ?, ?)',
        [projectId, projectName, process.cwd(), repoUrl]
      );
      console.log(`Project "${projectName}" linked successfully to ${process.cwd()}`);
    } catch (error: any) {
      if (error.message.includes('UNIQUE constraint failed')) {
        console.error(`Error: Project name "${projectName}" already exists.`);
      } else {
        console.error('Failed to link project:', error);
      }
    }
  });


program
  .command('deploy')
  .description('Manually trigger a Docker build and deployment')
  .action(async () => {
    await initDB();
    const cwd = process.cwd();

    const project = await get('SELECT * FROM projects WHERE path = ?', [cwd]);
    if (!project) {
      console.error('Error: Project not found. Run "mini-vercel link" first.');
      process.exit(1);
    }
    try {
      await deployProject({
        project,
        sourcePath: cwd,
        env: 'production'
      });
    } catch (err: any) {
      console.error('Deployment failed:', err);
    }
  });


program
  .command('list')
  .description('List all running projects and URLs')
  .action(async () => {
    await initDB();
    const projects = await all(`
      SELECT p.name, d.port, d.status
      FROM projects p
      LEFT JOIN deployments d ON p.id = d.project_id
      WHERE d.created_at = (
        SELECT MAX(created_at) FROM deployments WHERE project_id = p.id
      ) OR d.id IS NULL
    `);

    console.log('Active Projects:');
    console.table(projects.map(p => ({
      Project: p.name,
      Status: p.status || 'No Deployments',
      URL: p.status === 'running' ? `http://${p.name}.localhost:8080` : 'N/A'
    })));
  });

const envCmd = program
  .command('env')
  .description('Manage environment variables for the current project');

envCmd
  .command('add <key> <value>')
  .description('Add or update an environment variable')
  .action(async (key, value) => {
    await initDB();
    const cwd = process.cwd();
    const project = await get('SELECT * FROM projects WHERE path = ?', [cwd]);
    if (!project) {
      console.error('Error: Project not found. Run "mini-vercel link" first.');
      process.exit(1);
    }

    const id = uuidv4();
    try {
      await run(
        'INSERT INTO env_vars (id, project_id, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value',
        [id, project.id, key, value]
      );
      console.log(`Environment variable ${key} added successfully to project "${project.name}".`);
    } catch (err: any) {
      console.error('Failed to add environment variable:', err);
    }
  });

envCmd
  .command('rm <key>')
  .description('Remove an environment variable')
  .action(async (key) => {
    await initDB();
    const cwd = process.cwd();
    const project = await get('SELECT * FROM projects WHERE path = ?', [cwd]);
    if (!project) {
      console.error('Error: Project not found.');
      process.exit(1);
    }

    await run('DELETE FROM env_vars WHERE project_id = ? AND key = ?', [project.id, key]);
    console.log(`Environment variable ${key} removed from project "${project.name}".`);
  });

envCmd
  .command('pull')
  .description('Pull environment variables to a local .env file')
  .action(async () => {
    await initDB();
    const cwd = process.cwd();
    const project = await get('SELECT * FROM projects WHERE path = ?', [cwd]);
    if (!project) {
      console.error('Error: Project not found.');
      process.exit(1);
    }

    const envVars = await all('SELECT key, value FROM env_vars WHERE project_id = ?', [project.id]);
    if (envVars.length === 0) {
      console.log('No environment variables found for this project.');
      return;
    }

    const envContent = envVars.map(row => `${row.key}=${row.value}`).join('\n');
    fs.writeFileSync(path.join(cwd, '.env'), envContent);
    console.log(`Successfully pulled ${envVars.length} environment variables to .env file.`);
  });

program
  .command('logs [project-name]')
  .description('View logs for a deployed project')
  .option('-f, --follow', 'Follow log output')
  .action(async (projectName, options) => {
    await initDB();

    let queryProject;
    if (projectName) {
      queryProject = await get('SELECT * FROM projects WHERE name = ?', [projectName]);
    } else {
      queryProject = await get('SELECT * FROM projects WHERE path = ?', [process.cwd()]);
    }

    if (!queryProject) {
      console.error('Error: Project not found.');
      process.exit(1);
    }

    const latestDeployment = await get(
      'SELECT container_id FROM deployments WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      [queryProject.id, 'running']
    );

    if (!latestDeployment || !latestDeployment.container_id) {
      console.error(`Error: No running deployment found for project "${queryProject.name}".`);
      process.exit(1);
    }

    console.log(`Fetching logs for project "${queryProject.name}" (Container: ${latestDeployment.container_id.substring(0, 12)})...`);
    try {
      await printContainerLogs(latestDeployment.container_id, options.follow);
    } catch (err: any) {
      console.error('Failed to fetch logs:', err);
    }
  });

const domainCmd = program
  .command('domain')
  .description('Manage custom domains for the current project');

domainCmd
  .command('add <domain>')
  .description('Add a custom domain to the project')
  .action(async (domain) => {
    await initDB();
    const cwd = process.cwd();
    const project = await get('SELECT * FROM projects WHERE path = ?', [cwd]);
    if (!project) {
      console.error('Error: Project not found.');
      process.exit(1);
    }
    await run('UPDATE projects SET custom_domain = ? WHERE id = ?', [domain, project.id]);
    console.log(`Custom domain ${domain} added to project "${project.name}".`);
    await generateAndReload();
  });

domainCmd
  .command('rm')
  .description('Remove the custom domain from the project')
  .action(async () => {
    await initDB();
    const cwd = process.cwd();
    const project = await get('SELECT * FROM projects WHERE path = ?', [cwd]);
    if (!project) {
      console.error('Error: Project not found.');
      process.exit(1);
    }
    await run('UPDATE projects SET custom_domain = NULL WHERE id = ?', [project.id]);
    console.log(`Custom domain removed from project "${project.name}".`);
    await generateAndReload();
  });

program
  .command('rollback')
  .description('Rollback to a previous deployment')
  .action(async () => {
    await initDB();
    const cwd = process.cwd();
    const project = await get('SELECT * FROM projects WHERE path = ?', [cwd]);
    if (!project) {
      console.error('Error: Project not found.');
      process.exit(1);
    }

    const running = await get('SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ?', [project.id, 'running', 'production']);
    const stopped = await all('SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ? ORDER BY created_at DESC LIMIT 3', [project.id, 'stopped', 'production']);

    if (stopped.length === 0) {
      console.error('No previous deployments available for rollback.');
      return;
    }

    const target = stopped[0];
    console.log(`Rolling back project "${project.name}" to deployment from ${target.created_at}...`);
    
    if (running) {
      await run('UPDATE deployments SET status = ? WHERE id = ?', ['stopped', running.id]);
    }
    await run('UPDATE deployments SET status = ? WHERE id = ?', ['running', target.id]);

    await generateAndReload();
    console.log('Rollback complete! The older deployment is now active.');
  });

program.parse(process.argv);