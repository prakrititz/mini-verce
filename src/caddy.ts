import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { all } from './db';

const docker = new Docker();
const CADDY_CONTAINER_NAME = 'mini-vercel-caddy';
const CADDYFILE_PATH = path.join(process.cwd(), 'Caddyfile');

const HTTP_PORT = 8080;
const HTTPS_PORT = 8443;

export async function startCaddy(): Promise<void> {
  if (!fs.existsSync(CADDYFILE_PATH)) {
    fs.writeFileSync(CADDYFILE_PATH, '');
  }
  try {
    const container = docker.getContainer(CADDY_CONTAINER_NAME);
    const info = await container.inspect();
    if (!info.State.Running) {
      await container.start();
    }
    return;
  } catch (err: any) {
    if (err.statusCode !== 404) {
      throw err;
    }
  }

  console.log('Starting Caddy proxy server container...');
  await new Promise((resolve, reject) => {
    docker.pull('caddy:latest', (err: any, stream: any) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, onFinished, onProgress);
      function onFinished(err: any) { if (err) reject(err); else resolve(null); }
      function onProgress(event: any) { }
    });
  });

  const container = await docker.createContainer({
    Image: 'caddy:latest',
    name: CADDY_CONTAINER_NAME,
    HostConfig: {
      PortBindings: {
        '80/tcp': [{ HostPort: HTTP_PORT.toString() }],
        '443/tcp': [{ HostPort: HTTPS_PORT.toString() }]
      },
      Binds: [
        `${CADDYFILE_PATH}:/etc/caddy/Caddyfile`
      ]
    }
  });
  await container.start();
}

export async function generateCaddyfile(): Promise<void> {
  // Fetch active production deployments
  const prodDeployments = await all(`
    SELECT p.name, p.custom_domain, d.port 
    FROM projects p
    JOIN deployments d ON p.id = d.project_id
    WHERE d.status = 'running'
    AND (d.env = 'production' OR d.env IS NULL)
    AND d.created_at = (
      SELECT MAX(created_at) FROM deployments 
      WHERE project_id = p.id AND status = 'running' AND (env = 'production' OR env IS NULL)
    )
  `);

  // Fetch active preview deployments grouped by unique preview URL
  const previewDeployments = await all(`
    SELECT d.url, d.port
    FROM deployments d
    WHERE d.status = 'running'
    AND d.env = 'preview'
    AND d.url IS NOT NULL
    AND d.created_at = (
      SELECT MAX(created_at) FROM deployments d2
      WHERE d2.url = d.url AND d2.status = 'running' AND d2.env = 'preview'
    )
  `);

  let caddyConfig = '';

  for (const dep of prodDeployments) {
    caddyConfig += `
http://${dep.name}.localhost:${HTTP_PORT} {
  reverse_proxy host.docker.internal:${dep.port}
}
`;
    if (dep.custom_domain) {
      caddyConfig += `
http://${dep.custom_domain}:${HTTP_PORT} {
  reverse_proxy host.docker.internal:${dep.port}
}
`;
    }
  }

  for (const dep of previewDeployments) {
    caddyConfig += `
http://${dep.url}:${HTTP_PORT} {
  reverse_proxy host.docker.internal:${dep.port}
}
`;
  }

  fs.writeFileSync(CADDYFILE_PATH, caddyConfig.trim() + '\\n');
}

export async function reloadCaddy(): Promise<void> {
  try {
    const container = docker.getContainer(CADDY_CONTAINER_NAME);
    const exec = await container.exec({
      Cmd: ['caddy', 'reload', '--config', '/etc/caddy/Caddyfile'],
      AttachStdout: true,
      AttachStderr: true
    });
    await exec.start({});
  } catch (err) {
    console.error('Failed to reload Caddy:', err);
  }
}

export async function generateAndReload(): Promise<void> {
  await generateCaddyfile();
  await reloadCaddy();
}
