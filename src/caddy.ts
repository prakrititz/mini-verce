import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { all } from './db';

const docker = new Docker();
const CADDY_CONTAINER_NAME = 'mini-vercel-caddy';
const CADDYFILE_PATH = path.join(process.cwd(), 'Caddyfile');

// ── Mode detection ────────────────────────────────────────────────────────────
//
//  CADDY_MODE=local   (default) — uses Caddy's built-in local CA
//                                 sites get `tls internal` + `local_certs` global block
//                                 runs on ports 80/443 inside Docker, exposed to host
//
//  CADDY_MODE=public  — bare hostnames only
//                       Caddy fetches Let's Encrypt automatically for real domains
//
// Set in your .env:   CADDY_MODE=public

export function getCaddyMode(): 'local' | 'public' {
  const mode = (process.env.CADDY_MODE || 'local').toLowerCase();
  return mode === 'public' ? 'public' : 'local';
}

// ── Port constants ────────────────────────────────────────────────────────────
//
// In local mode we bind 80→80 and 443→443 on the host so Caddy can handle
// real TLS handshakes and ACME challenges without port translation.

const HOST_HTTP_PORT  = parseInt(process.env.CADDY_HTTP_PORT  || '80',  10);
const HOST_HTTPS_PORT = parseInt(process.env.CADDY_HTTPS_PORT || '443', 10);

// ── Caddy container lifecycle ─────────────────────────────────────────────────

export async function startCaddy(): Promise<void> {
  if (!fs.existsSync(CADDYFILE_PATH)) {
    // Write a minimal valid Caddyfile so Caddy starts cleanly
    const mode = getCaddyMode();
    fs.writeFileSync(CADDYFILE_PATH, mode === 'local' ? '{\n  local_certs\n}\n' : '');
  }

  try {
    const container = docker.getContainer(CADDY_CONTAINER_NAME);
    const info = await container.inspect();
    if (!info.State.Running) await container.start();
    return;
  } catch (err: any) {
    if (err.statusCode !== 404) throw err;
  }

  console.log('[Caddy] Pulling caddy:latest...');
  await new Promise<void>((resolve, reject) => {
    docker.pull('caddy:latest', (err: any, stream: any) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e: any) => e ? reject(e) : resolve(), () => {});
    });
  });

  console.log(`[Caddy] Creating container (mode: ${getCaddyMode()}, http: ${HOST_HTTP_PORT}, https: ${HOST_HTTPS_PORT})...`);
  const container = await docker.createContainer({
    Image: 'caddy:latest',
    name:  CADDY_CONTAINER_NAME,
    HostConfig: {
      PortBindings: {
        '80/tcp':  [{ HostPort: HOST_HTTP_PORT.toString()  }],
        '443/tcp': [{ HostPort: HOST_HTTPS_PORT.toString() }],
      },
      // Mount Caddyfile + persist Caddy's cert/data directories on the host
      Binds: [
        `${CADDYFILE_PATH}:/etc/caddy/Caddyfile`,
        `${path.join(process.cwd(), '.caddy-data')}:/data`,
        `${path.join(process.cwd(), '.caddy-config')}:/config`,
      ],
    },
  });

  await container.start();
  console.log('[Caddy] Container started.');
}

/**
 * Run `caddy trust` inside the container to install the local CA into the
 * system trust store. Call once after first `start-daemon` in local mode.
 */
export async function trustLocalCA(): Promise<string> {
  const container = docker.getContainer(CADDY_CONTAINER_NAME);
  const exec = await container.exec({
    Cmd:          ['caddy', 'trust'],
    AttachStdout: true,
    AttachStderr: true,
  });

  return new Promise((resolve, reject) => {
    exec.start({}, (err: any, stream: any) => {
      if (err) return reject(err);
      let output = '';
      stream.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      stream.on('end',  () => resolve(output.trim()));
      stream.on('error', reject);
    });
  });
}

// ── Caddyfile generation ──────────────────────────────────────────────────────

export async function generateCaddyfile(): Promise<void> {
  const mode = getCaddyMode();

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

  // Fetch active preview deployments
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

  // ── Build config ──────────────────────────────────────────────────────────

  // Global options block
  let config = mode === 'local'
    ? '{\n  local_certs\n}\n\n'
    : '';

  // TLS directive appended to every site block
  const tlsLine = mode === 'local' ? '\n  tls internal' : '';

  for (const dep of prodDeployments) {
    // Primary .localhost subdomain (always generated)
    config += siteBlock(`${dep.name}.localhost`, dep.port, tlsLine);

    // Custom domain — bare in public mode (Let's Encrypt auto), `tls internal` in local
    if (dep.custom_domain) {
      config += siteBlock(dep.custom_domain, dep.port, tlsLine);
    }
  }

  for (const dep of previewDeployments) {
    config += siteBlock(dep.url, dep.port, tlsLine);
  }

  fs.writeFileSync(CADDYFILE_PATH, config.trimEnd() + '\n');
}

/** Produces a single Caddy site block. */
function siteBlock(hostname: string, port: number, tlsLine: string): string {
  return `${hostname} {${tlsLine}
  reverse_proxy host.docker.internal:${port}
}\n\n`;
}

// ── Reload ────────────────────────────────────────────────────────────────────

export async function reloadCaddy(): Promise<void> {
  try {
    const container = docker.getContainer(CADDY_CONTAINER_NAME);
    const exec = await container.exec({
      Cmd:          ['caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--force'],
      AttachStdout: true,
      AttachStderr: true,
    });
    await exec.start({});
  } catch (err) {
    console.error('[Caddy] Reload failed:', err);
  }
}

export async function generateAndReload(): Promise<void> {
  await generateCaddyfile();
  await reloadCaddy();
}
