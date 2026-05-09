#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { initDB, run, get, all } from './db';
import { buildImage, startContainer } from './docker';
import { startCaddy, generateAndReload } from './caddy';

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
    
    // 1. Find project
    const project = await get('SELECT * FROM projects WHERE path = ?', [cwd]);
    if (!project) {
      console.error('Error: Project not found. Run "mini-vercel link" first.');
      process.exit(1);
    }
    
    // 2. Ensure Dockerfile exists
    if (!fs.existsSync(path.join(cwd, 'Dockerfile'))) {
      console.error('Error: No Dockerfile found in current directory.');
      process.exit(1);
    }
    
    try {
      // 3. Find available port
      const getPort = (await import('get-port')).default;
      const port = await getPort();
      
      const imageName = `mini-vercel-${project.name}:${Date.now()}`;
      const containerName = `mini-vercel-app-${project.name}-${Date.now()}`;
      
      // 4. Build image
      await buildImage(cwd, imageName);
      
      // 5. Start container
      console.log(`Starting container on port ${port}...`);
      const containerId = await startContainer(imageName, port, containerName);
      
      // 6. Record deployment
      const deploymentId = uuidv4();
      await run(
        'INSERT INTO deployments (id, project_id, status, container_id, port) VALUES (?, ?, ?, ?, ?)',
        [deploymentId, project.id, 'running', containerId, port]
      );
      
      // 7. Update Caddy
      console.log('Updating proxy routing...');
      await generateAndReload();
      
      console.log(`🚀 Deployed successfully!`);
      console.log(`URL: http://${project.name}.localhost:8080`);
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
