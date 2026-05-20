import { v4 as uuidv4 } from 'uuid';
import { run, all } from './db';
import { buildImage, startContainer, stopContainer } from './docker';
import { generateAndReload } from './caddy';
import { ensureDockerAssets } from './frameworks';

export interface DeployOptions {
  project: {
    id: string;
    name: string;
    path: string;
    repository_url?: string | null;
  };
  sourcePath: string;
  env?: 'production' | 'preview';
  customUrl?: string | null;
}

export interface DeployResult {
  deploymentId: string;
  containerId: string;
  port: number;
  url: string;
}
/**
 * Core deployment engine decoupled from the CLI.
 * Builds, deploys, and updates routing for a project smoothly using Blue-Green strategy.
 */
export async function deployProject(options: DeployOptions): Promise<DeployResult> {
  const { project, sourcePath, env = 'production', customUrl = null } = options;

  console.log(`Starting deployment for project "${project.name}" (${env} environment)...`);

  // 1. Ensure optimized Docker assets exist for the framework
  ensureDockerAssets(sourcePath);

  // Fetch environment variables for the project
  const envVarsRows = await all('SELECT key, value FROM env_vars WHERE project_id = ?', [project.id]);
  const buildargs: Record<string, string> = {};
  const containerEnv: string[] = [];

  for (const row of envVarsRows) {
    buildargs[row.key] = row.value;
    containerEnv.push(`${row.key}=${row.value}`);
  }

  // 2. Find an available port dynamically
  const getPort = (await import('get-port')).default;
  const preferredPort = 8081 + Math.floor(Math.random() * 1000);
  const port = await getPort({ port: preferredPort });

  const timestamp = Date.now();
  const safeEnv = env === 'preview' ? 'pr' : 'prod';
  const safeProjectName = project.name.toLowerCase();
  const imageName = `mini-vercel-${safeProjectName}-${safeEnv}:${timestamp}`;
  const containerName = `mini-vercel-app-${safeProjectName}-${safeEnv}-${timestamp}`;

  // 3. Build Docker image
  await buildImage(sourcePath, imageName, buildargs);

  // 4. Start Docker container
  const { detectFramework } = await import('./frameworks');
  const { framework } = detectFramework(sourcePath);
  const exposedPort = framework === 'vite' || framework === 'cra' ? 80 : 3000;
  
  console.log(`Starting container ${containerName} on port ${port} (mapping to internal ${exposedPort})...`);
  const containerId = await startContainer(imageName, port, containerName, containerEnv, exposedPort);

  // 5. Record deployment in the database
  const deploymentId = uuidv4();
  await run(
    'INSERT INTO deployments (id, project_id, status, container_id, port, env, url) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [deploymentId, project.id, 'running', containerId, port, env, customUrl]
  );

  // 6. Regenerate Caddyfile proxy configuration and reload Caddy seamlessly
  console.log('Updating proxy routing configuration...');
  await generateAndReload();

  // 7. Blue-Green cleanup: gracefully stop and retain recent containers for rollbacks
  console.log('Performing blue-green deployment cleanup...');
  let allOldDeployments: any[] = [];
  if (env === 'production') {
    allOldDeployments = await all(
      'SELECT * FROM deployments WHERE project_id = ? AND env = ? AND id != ? ORDER BY created_at DESC',
      [project.id, 'production', deploymentId]
    );
  } else {
    allOldDeployments = await all(
      'SELECT * FROM deployments WHERE project_id = ? AND env = ? AND url = ? AND id != ? ORDER BY created_at DESC',
      [project.id, 'preview', customUrl, deploymentId]
    );
  }

  for (let i = 0; i < allOldDeployments.length; i++) {
    const oldDep = allOldDeployments[i];
    const shouldRemove = i >= 3; // retain up to 3 older deployments (stop but don't remove)
    
    if (oldDep.status === 'running') {
      console.log(`Stopping previous container: ${oldDep.container_id} (Remove: ${shouldRemove})`);
      if (oldDep.container_id) await stopContainer(oldDep.container_id, shouldRemove);
      await run('UPDATE deployments SET status = ? WHERE id = ?', ['stopped', oldDep.id]);
    } else if (shouldRemove && oldDep.status === 'stopped') {
      if (oldDep.container_id) {
        console.log(`Removing old stopped container: ${oldDep.container_id}`);
        await stopContainer(oldDep.container_id, true);
      }
    }
  }

  const finalUrl = env === 'preview' && customUrl 
    ? `http://${customUrl}:8080` 
    : `http://${project.name}.localhost:8080`;

  console.log(`🚀 Deployment successful for "${project.name}"!`);
  console.log(`Serving at: ${finalUrl}`);

  return {
    deploymentId,
    containerId,
    port,
    url: finalUrl
  };
}

