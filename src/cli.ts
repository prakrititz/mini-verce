#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { initDB, run, get, all } from './db';
import { buildImage, startContainer, stopContainer } from './docker';
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

program.parse(process.argv);
