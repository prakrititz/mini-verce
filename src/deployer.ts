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
  const port = await getPort();

  const timestamp = Date.now();
  const safeEnv = env === 'preview' ? 'pr' : 'prod';
  const imageName = `mini-vercel-${project.name}-${safeEnv}:${timestamp}`;
  const containerName = `mini-vercel-app-${project.name}-${safeEnv}-${timestamp}`;

  // 3. Build Docker image
  await buildImage(sourcePath, imageName, buildargs);

  // 4. Start Docker container
  console.log(`Starting container ${containerName} on port ${port}...`);
  const containerId = await startContainer(imageName, port, containerName, containerEnv);

  // 5. Record deployment in the database
  const deploymentId = uuidv4();
  await run(
    'INSERT INTO deployments (id, project_id, status, container_id, port, env, url) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [deploymentId, project.id, 'running', containerId, port, env, customUrl]
  );

  // 6. Regenerate Caddyfile proxy configuration and reload Caddy seamlessly
  console.log('Updating proxy routing configuration...');
  await generateAndReload();

  // 7. Blue-Green cleanup: gracefully stop and remove older running containers for this specific target
  console.log('Performing blue-green deployment cleanup...');
  let oldDeployments: any[] = [];
  if (env === 'production') {
    oldDeployments = await all(
      'SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ? AND id != ?',
      [project.id, 'running', 'production', deploymentId]
    );
  } else {
    oldDeployments = await all(
      'SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ? AND url = ? AND id != ?',
      [project.id, 'running', 'preview', customUrl, deploymentId]
    );
  }

  for (const oldDep of oldDeployments) {
    if (oldDep.container_id) {
      console.log(`Stopping previous container: ${oldDep.container_id}`);
      await stopContainer(oldDep.container_id);
    }
    await run('UPDATE deployments SET status = ? WHERE id = ?', ['stopped', oldDep.id]);
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
