import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';

import { initDB, all, get, run } from './db';
import { buildQueue } from './queue';
import { deployProject } from './deployer';
import { stopContainer } from './docker';
import { generateAndReload, getCaddyMode, trustLocalCA } from './caddy';

const execAsync = util.promisify(exec);

const app = express();
const PORT = process.env.DAEMON_PORT || 4000;

// Capture raw body buffer for HMAC validation before JSON parsing
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; }
}));

// ── Public routes ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', daemon: 'mini-vercel', queueLength: buildQueue.getLength(), isBusy: buildQueue.isBusy() });
});

app.get('/api/queue', (_req, res) => {
  res.json({ length: buildQueue.getLength(), isBusy: buildQueue.isBusy() });
});

// ── Phase 5: Caddy mode & trust endpoints (public — no auth needed) ───────────

/**
 * GET /api/caddy/mode
 * Returns the current Caddy TLS mode (local | public).
 */
app.get('/api/caddy/mode', (_req, res) => {
  res.json({
    mode: getCaddyMode(),
    description: getCaddyMode() === 'local'
      ? 'Caddy local CA — tls internal (set CADDY_MODE=public for Let\'s Encrypt)'
      : 'Let\'s Encrypt — bare hostnames, auto TLS',
    httpPort:  process.env.CADDY_HTTP_PORT  || 80,
    httpsPort: process.env.CADDY_HTTPS_PORT || 443,
  });
});

/**
 * POST /api/caddy/trust
 * Runs `caddy trust` inside the Caddy container to install the local CA.
 * Only meaningful in local mode. Safe to call multiple times.
 */
app.post('/api/caddy/trust', async (_req, res) => {
  try {
    const output = await trustLocalCA();
    console.log('[Caddy] trust output:', output);
    res.json({ message: 'Local CA trusted successfully.', output });
  } catch (err: any) {
    res.status(500).json({ error: `caddy trust failed: ${err.message}` });
  }
});

// ── Phase 1: Auth rate limiter ────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Phase 1: Identity endpoints ───────────────────────────────────────────────

/**
 * POST /auth/signup
 * Creates a new user with bcrypt-hashed password and returns a session token.
 */
app.post('/auth/signup', authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email format.' });

  const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();
  await run('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [userId, email, passwordHash]);

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [sessionToken, userId, expiresAt]);

  console.log(`[Auth] Signup: ${email} (${userId})`);
  res.status(201).json({ userId, sessionToken });
});

/**
 * POST /auth/login
 * Verifies credentials, returns a new session token.
 */
app.post('/auth/login', authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  // Constant-time comparison path — same error prevents account enumeration
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [sessionToken, user.id, expiresAt]);

  console.log(`[Auth] Login: ${email}`);
  res.json({ userId: user.id, sessionToken });
});

/**
 * POST /auth/logout
 * Destroys the caller's session.
 */
app.post('/auth/logout', async (req: Request, res: Response) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) await run('DELETE FROM sessions WHERE token = ?', [token]).catch(() => {});
  res.json({ message: 'Logged out.' });
});

// ── Phase 3: Session auth middleware ──────────────────────────────────────────

/**
 * Reads Authorization: Bearer <token>, validates against sessions table,
 * and attaches req.userId. Every protected route uses this.
 */
async function verifySessionToken(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Run "mini-vercel login".' });
  }
  const session = await get(
    `SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')`,
    [token]
  );
  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid. Run "mini-vercel login".' });
  }
  (req as any).userId = session.user_id;
  next();
}

/**
 * Phase 2 helper: load a project by id and assert the caller owns it.
 * Returns the project row or sends 403/404 and returns null.
 */
async function requireProjectOwner(req: Request, res: Response, projectId: string): Promise<any | null> {
  const project = await get('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return null;
  }
  if (project.owner_id && project.owner_id !== (req as any).userId) {
    res.status(403).json({ error: 'Access denied: you do not own this project.' });
    return null;
  }
  return project;
}

// ── Phase 4: GitHub crypto helpers ────────────────────────────────────────────

const CIPHER_ALGO = 'aes-256-cbc';

/**
 * Derive a 32-byte AES key from the daemon's WEBHOOK_SECRET (or a fallback).
 * The key is stable per installation — same secret → same key every time.
 */
function deriveEncryptionKey(): Buffer {
  const secret = process.env.WEBHOOK_SECRET || 'mini-vercel-default-enc-key-change-me';
  return crypto.createHash('sha256').update(secret).digest(); // always 32 bytes
}

function encryptPAT(pat: string): string {
  const key = deriveEncryptionKey();
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(pat, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptPAT(stored: string): string {
  const [ivHex, encHex] = stored.split(':');
  const key = deriveEncryptionKey();
  const iv  = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Validate a PAT against the GitHub API and return the GitHub username. */
async function validateGitHubPAT(pat: string): Promise<{ login: string; name: string | null }> {
  const nodeFetch = require('node-fetch');
  const fetch = nodeFetch.default || nodeFetch;
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${pat}`,
      'User-Agent':  'mini-vercel-paas',
      Accept:        'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub API rejected the PAT (HTTP ${res.status})`);
  const data = await res.json() as any;
  return { login: data.login, name: data.name };
}

/** List repos accessible by the PAT. */
async function listGitHubRepos(pat: string): Promise<any[]> {
  const nodeFetch = require('node-fetch');
  const fetch = nodeFetch.default || nodeFetch;
  // Fetch up to 100 repos the user has push access to (for linking)
  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator', {
    headers: {
      Authorization: `token ${pat}`,
      'User-Agent':  'mini-vercel-paas',
      Accept:        'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`Failed to list repos (HTTP ${res.status})`);
  return res.json() as any;
}

/** Register a webhook on a GitHub repo via the API. */
async function registerGitHubWebhook(pat: string, owner: string, repo: string, webhookUrl: string, secret: string): Promise<void> {
  const nodeFetch = require('node-fetch');
  const fetch = nodeFetch.default || nodeFetch;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
    method: 'POST',
    headers: {
      Authorization:  `token ${pat}`,
      'User-Agent':   'mini-vercel-paas',
      Accept:         'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name:   'web',
      active: true,
      events: ['push', 'pull_request'],
      config: {
        url:          webhookUrl,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
    }),
  });
  // 422 = webhook already exists on that repo — treat as success
  if (!res.ok && res.status !== 422) {
    const body = await res.json() as any;
    throw new Error(`Failed to register webhook: ${body.message || res.status}`);
  }
}

// ── Phase 4: GitHub account endpoints ────────────────────────────────────────

/**
 * POST /auth/github/connect
 * Body: { pat }  — GitHub Personal Access Token
 * Validates PAT, encrypts it with AES-256, stores it in users table.
 */
app.post('/auth/github/connect', verifySessionToken, async (req: Request, res: Response) => {
  const { pat } = req.body;
  if (!pat || typeof pat !== 'string' || pat.trim().length < 10) {
    return res.status(400).json({ error: 'A valid GitHub Personal Access Token is required.' });
  }

  let ghUser: { login: string; name: string | null };
  try {
    ghUser = await validateGitHubPAT(pat.trim());
  } catch (err: any) {
    return res.status(401).json({ error: err.message });
  }

  const encryptedPAT = encryptPAT(pat.trim());
  const userId = (req as any).userId;
  await run(
    'UPDATE users SET github_username = ?, github_pat_encrypted = ? WHERE id = ?',
    [ghUser.login, encryptedPAT, userId]
  );

  console.log(`[GitHub] Linked GitHub account @${ghUser.login} to user ${userId}`);
  res.json({ message: `Connected as @${ghUser.login}`, githubUsername: ghUser.login });
});

/**
 * DELETE /auth/github/disconnect
 * Removes the stored GitHub PAT and username for the authenticated user.
 */
app.delete('/auth/github/disconnect', verifySessionToken, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  await run('UPDATE users SET github_username = NULL, github_pat_encrypted = NULL WHERE id = ?', [userId]);
  console.log(`[GitHub] Disconnected GitHub from user ${userId}`);
  res.json({ message: 'GitHub account disconnected.' });
});

/**
 * GET /auth/github/status
 * Returns whether GitHub is linked for the authenticated user.
 */
app.get('/auth/github/status', verifySessionToken, async (req: Request, res: Response) => {
  const user = await get('SELECT github_username FROM users WHERE id = ?', [(req as any).userId]);
  if (!user?.github_username) {
    return res.json({ connected: false });
  }
  res.json({ connected: true, githubUsername: user.github_username });
});

/**
 * GET /api/github/repos
 * Lists repos accessible by the authenticated user's stored PAT.
 */
app.get('/api/github/repos', verifySessionToken, async (req: Request, res: Response) => {
  const user = await get('SELECT github_pat_encrypted FROM users WHERE id = ?', [(req as any).userId]);
  if (!user?.github_pat_encrypted) {
    return res.status(400).json({ error: 'No GitHub account connected. Run "mini-vercel github connect".' });
  }

  try {
    const pat   = decryptPAT(user.github_pat_encrypted);
    const repos = await listGitHubRepos(pat);
    res.json({ repos: repos.map((r: any) => ({
      name:          r.name,
      fullName:      r.full_name,
      cloneUrl:      r.clone_url,
      sshUrl:        r.ssh_url,
      private:       r.private,
      defaultBranch: r.default_branch,
      updatedAt:     r.updated_at,
    }))});
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/projects/link-github
 * Links a project AND auto-registers the GitHub webhook in one step.
 * Body: { name, path, repoFullName }   — e.g. repoFullName = "prakrititz/my-app"
 */
app.post('/api/projects/link-github', verifySessionToken, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { name, path: projectPath, repoFullName } = req.body;

  if (!name || !projectPath || !repoFullName) {
    return res.status(400).json({ error: 'name, path, and repoFullName are required.' });
  }

  const user = await get('SELECT github_username, github_pat_encrypted FROM users WHERE id = ?', [userId]);
  if (!user?.github_pat_encrypted) {
    return res.status(400).json({ error: 'No GitHub account connected. Run "mini-vercel github connect" first.' });
  }

  const pat  = decryptPAT(user.github_pat_encrypted);
  const cloneUrl = `https://github.com/${repoFullName}.git`;

  // Create the project record
  const existing = await get('SELECT id FROM projects WHERE name = ?', [name]);
  if (existing) {
    return res.status(409).json({ error: `Project name "${name}" already exists.` });
  }

  const projectId = uuidv4();
  await run(
    'INSERT INTO projects (id, name, path, repository_url, owner_id) VALUES (?, ?, ?, ?, ?)',
    [projectId, name, projectPath, cloneUrl, userId]
  );

  // Auto-register the GitHub webhook
  const [owner, repo] = repoFullName.split('/');
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const daemonPort    = process.env.DAEMON_PORT || 4000;
  // Use the user-configured public URL or fall back to localhost (useful with ngrok)
  const webhookUrl    = process.env.PUBLIC_URL
    ? `${process.env.PUBLIC_URL}/webhooks/github`
    : `http://localhost:${daemonPort}/webhooks/github`;

  let webhookStatus = 'skipped';
  try {
    await registerGitHubWebhook(pat, owner, repo, webhookUrl, webhookSecret);
    webhookStatus = 'registered';
    console.log(`[GitHub] Webhook registered for ${repoFullName} → ${webhookUrl}`);
  } catch (err: any) {
    console.warn(`[GitHub] Webhook registration failed: ${err.message}`);
    webhookStatus = `failed: ${err.message}`;
  }

  res.status(201).json({
    projectId,
    name,
    repoFullName,
    cloneUrl,
    webhookStatus,
  });
});

// ── Phase 2+3: Project API (all routes require a valid session) ───────────────

/**
 * POST /api/projects/link
 * Registers the current directory as a project owned by the authenticated user.
 * Body: { name, path, repositoryUrl? }
 */
app.post('/api/projects/link', verifySessionToken, async (req: Request, res: Response) => {
  const { name, path: projectPath, repositoryUrl } = req.body;
  const userId = (req as any).userId;

  if (!name || !projectPath) {
    return res.status(400).json({ error: 'name and path are required.' });
  }

  const existing = await get('SELECT id FROM projects WHERE name = ?', [name]);
  if (existing) {
    return res.status(409).json({ error: `Project name "${name}" already exists.` });
  }

  const projectId = uuidv4();
  await run(
    'INSERT INTO projects (id, name, path, repository_url, owner_id) VALUES (?, ?, ?, ?, ?)',
    [projectId, name, projectPath, repositoryUrl || null, userId]
  );

  console.log(`[Projects] Linked "${name}" for user ${userId}`);
  res.status(201).json({ projectId, name, path: projectPath, ownerId: userId });
});

/**
 * GET /api/projects
 * Returns only the projects owned by the authenticated user.
 */
app.get('/api/projects', verifySessionToken, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const projects = await all(`
    SELECT p.id, p.name, p.path, p.repository_url, p.custom_domain, p.created_at,
           d.status, d.port, d.env
    FROM projects p
    LEFT JOIN deployments d ON p.id = d.project_id
    WHERE p.owner_id = ?
    AND (d.created_at = (
      SELECT MAX(created_at) FROM deployments WHERE project_id = p.id
    ) OR d.id IS NULL)
  `, [userId]);
  res.json({ projects });
});

/**
 * GET /api/projects/by-path?path=<cwd>
 * Looks up a project by its filesystem path, scoped to the authenticated user.
 */
app.get('/api/projects/by-path', verifySessionToken, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const projectPath = req.query.path as string;
  if (!projectPath) return res.status(400).json({ error: 'path query parameter required.' });

  const project = await get(
    'SELECT * FROM projects WHERE path = ? AND owner_id = ?',
    [projectPath, userId]
  );
  if (!project) return res.status(404).json({ error: 'No project found at this path for your account.' });
  res.json({ project });
});

/**
 * GET /api/projects/:id
 * Returns a single project — ownership enforced.
 */
app.get('/api/projects/:id', verifySessionToken, async (req: Request, res: Response) => {
  const project = await requireProjectOwner(req, res, req.params.id as string);
  if (!project) return;
  res.json({ project });
});

/**
 * POST /api/projects/:id/deploy
 * Triggers a production deployment — ownership enforced.
 */
app.post('/api/projects/:id/deploy', verifySessionToken, async (req: Request, res: Response) => {
  const project = await requireProjectOwner(req, res, req.params.id as string);
  if (!project) return;

  const buildId = uuidv4();
  res.status(202).json({ message: 'Deployment enqueued.', buildId, project: project.name });

  buildQueue.enqueue(async () => {
    try {
      console.log(`[Deploy] Starting production deploy for "${project.name}" (buildId: ${buildId})`);
      await deployProject({ project, sourcePath: project.path, env: 'production' });
      console.log(`[Deploy] Done: "${project.name}"`);
    } catch (err) {
      console.error(`[Deploy] Failed for "${project.name}":`, err);
    }
  });
});

/**
 * POST /api/projects/:id/rollback
 * Rolls back to the most recent stopped deployment — ownership enforced.
 */
app.post('/api/projects/:id/rollback', verifySessionToken, async (req: Request, res: Response) => {
  const project = await requireProjectOwner(req, res, req.params.id as string);
  if (!project) return;

  const running = await get(
    'SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ?',
    [project.id, 'running', 'production']
  );
  const stopped = await all(
    'SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ? ORDER BY created_at DESC LIMIT 3',
    [project.id, 'stopped', 'production']
  );

  if (!stopped.length) {
    return res.status(400).json({ error: 'No previous deployments available for rollback.' });
  }

  const target = stopped[0];
  if (running) await run('UPDATE deployments SET status = ? WHERE id = ?', ['stopped', running.id]);
  await run('UPDATE deployments SET status = ? WHERE id = ?', ['running', target.id]);
  await generateAndReload();

  console.log(`[Rollback] "${project.name}" rolled back to deployment from ${target.created_at}`);
  res.json({ message: 'Rollback complete.', deployedAt: target.created_at });
});

/**
 * PATCH /api/projects/:id/domain
 * Sets or clears a custom domain — ownership enforced.
 * Body: { domain } or { domain: null }
 */
app.patch('/api/projects/:id/domain', verifySessionToken, async (req: Request, res: Response) => {
  const project = await requireProjectOwner(req, res, req.params.id as string);
  if (!project) return;

  const { domain } = req.body;
  await run('UPDATE projects SET custom_domain = ? WHERE id = ?', [domain || null, project.id]);
  await generateAndReload();

  const msg = domain ? `Custom domain "${domain}" set.` : 'Custom domain removed.';
  console.log(`[Domain] ${project.name}: ${msg}`);
  res.json({ message: msg });
});

/**
 * GET /api/projects/:id/env
 * Returns all env vars for a project — ownership enforced.
 */
app.get('/api/projects/:id/env', verifySessionToken, async (req: Request, res: Response) => {
  const project = await requireProjectOwner(req, res, req.params.id as string);
  if (!project) return;
  const vars = await all('SELECT key, value, is_secret FROM env_vars WHERE project_id = ?', [project.id]);
  res.json({ vars });
});

/**
 * PUT /api/projects/:id/env
 * Upserts an env var — ownership enforced.
 * Body: { key, value }
 */
app.put('/api/projects/:id/env', verifySessionToken, async (req: Request, res: Response) => {
  const project = await requireProjectOwner(req, res, req.params.id as string);
  if (!project) return;

  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'key and value are required.' });

  await run(
    'INSERT INTO env_vars (id, project_id, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value',
    [uuidv4(), project.id, key, value]
  );
  res.json({ message: `Set ${key}.` });
});

/**
 * DELETE /api/projects/:id/env/:key
 * Removes an env var — ownership enforced.
 */
app.delete('/api/projects/:id/env/:key', verifySessionToken, async (req: Request, res: Response) => {
  const project = await requireProjectOwner(req, res, req.params.id as string);
  if (!project) return;
  await run('DELETE FROM env_vars WHERE project_id = ? AND key = ?', [project.id, req.params.key as string]);
  res.json({ message: `Removed ${req.params.key}.` });
});

// ── Phase 4 Option B: GitHub OAuth flow ──────────────────────────────────────
//
// Prerequisites (set in .env):
//   GITHUB_CLIENT_ID     = <your OAuth App client id>
//   GITHUB_CLIENT_SECRET = <your OAuth App client secret>
//   GITHUB_CALLBACK_URL  = http://localhost:4000/auth/github/callback  (or public URL)
//
// Register at: https://github.com/settings/applications/new

/**
 * In-memory CSRF state store:  state → { userId, expiresAt }
 * Entries expire after 10 minutes and are cleaned up on each new request.
 */
const oauthStateStore = new Map<string, { userId: string; expiresAt: number }>();

function pruneOAuthState() {
  const now = Date.now();
  for (const [k, v] of oauthStateStore) {
    if (v.expiresAt < now) oauthStateStore.delete(k);
  }
}

/**
 * GET /auth/github/start
 * Initiates the OAuth flow.  Requires a valid session — the state is tied to
 * the calling user so the callback can update the right account.
 * Redirects the browser to GitHub's authorization page.
 */
app.get('/auth/github/start', verifySessionToken, (req: Request, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({
      error: 'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.'
    });
  }

  pruneOAuthState();

  const state     = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  oauthStateStore.set(state, { userId: (req as any).userId, expiresAt });

  const callbackUrl = process.env.GITHUB_CALLBACK_URL || `http://localhost:${PORT}/auth/github/callback`;
  const params = new URLSearchParams({
    client_id:    clientId,
    redirect_uri: callbackUrl,
    scope:        'repo admin:repo_hook read:user user:email',
    state,
  });

  const authorizeUrl = `https://github.com/login/oauth/authorize?${params}`;
  console.log(`[GitHub OAuth] Redirecting user ${(req as any).userId} to GitHub…`);
  res.redirect(authorizeUrl);
});

/**
 * GET /auth/github/callback
 * GitHub redirects here after the user approves the OAuth App.
 * Exchanges the `code` for an access token, validates CSRF state,
 * stores the token (AES-256 encrypted) and GitHub username on the user record.
 *
 * On success, renders a tiny HTML page the user can close.
 */
app.get('/auth/github/callback', async (req: Request, res: Response) => {
  const nodeFetch = require('node-fetch');
  const fetch     = nodeFetch.default || nodeFetch;

  const { code, state, error: ghError } = req.query as Record<string, string>;

  if (ghError) {
    return res.status(400).send(oauthPage('❌ GitHub authorization denied.', ghError, false));
  }
  if (!code || !state) {
    return res.status(400).send(oauthPage('❌ Invalid callback.', 'Missing code or state parameter.', false));
  }

  pruneOAuthState();

  const stored = oauthStateStore.get(state);
  if (!stored || stored.expiresAt < Date.now()) {
    return res.status(400).send(oauthPage('❌ State mismatch.', 'OAuth state expired or invalid. Please try again.', false));
  }
  oauthStateStore.delete(state);

  const { userId } = stored;

  // Exchange code for access_token
  const clientId     = process.env.GITHUB_CLIENT_ID!;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET!;
  const callbackUrl  = process.env.GITHUB_CALLBACK_URL || `http://localhost:${PORT}/auth/github/callback`;

  let accessToken: string;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body: JSON.stringify({
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        redirect_uri:  callbackUrl,
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');
    }
    accessToken = tokenData.access_token;
  } catch (err: any) {
    console.error('[GitHub OAuth] Token exchange failed:', err.message);
    return res.status(502).send(oauthPage('❌ Token exchange failed.', err.message, false));
  }

  // Validate token and get GitHub user info
  let ghUser: { login: string; name: string | null };
  try {
    ghUser = await validateGitHubPAT(accessToken); // reuses existing helper
  } catch (err: any) {
    console.error('[GitHub OAuth] Token validation failed:', err.message);
    return res.status(502).send(oauthPage('❌ Token validation failed.', err.message, false));
  }

  // Encrypt and persist
  const encryptedToken = encryptPAT(accessToken);
  await run(
    'UPDATE users SET github_username = ?, github_pat_encrypted = ? WHERE id = ?',
    [ghUser.login, encryptedToken, userId]
  );

  console.log(`[GitHub OAuth] Linked @${ghUser.login} to user ${userId}`);
  res.send(oauthPage(
    `✓ Connected as @${ghUser.login}`,
    'You can close this tab and return to the terminal.',
    true
  ));
});

/** Tiny self-closing HTML page shown at the end of the OAuth callback. */
function oauthPage(heading: string, body: string, success: boolean): string {
  const color = success ? '#22c55e' : '#ef4444';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>mini-vercel GitHub Auth</title>
  <style>
    body { font-family: system-ui, sans-serif; display:flex; align-items:center;
           justify-content:center; min-height:100vh; margin:0; background:#0f172a; color:#f1f5f9; }
    .card { background:#1e293b; border-radius:12px; padding:2.5rem 3rem; text-align:center; max-width:420px; }
    h1 { color:${color}; font-size:1.5rem; margin-bottom:.75rem; }
    p  { color:#94a3b8; margin:0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
}

// ── GitHub webhook (public — HMAC instead of session) ────────────────────────

function verifyGitHubSignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Webhook] WEBHOOK_SECRET not set — skipping HMAC validation.');
    return next();
  }
  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) return res.status(401).json({ error: 'Missing x-hub-signature-256 header' });

  const rawBody = (req as any).rawBody;
  if (!rawBody) return res.status(500).json({ error: 'Raw body unavailable for validation' });

  const digest = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  if (signature.length !== digest.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  next();
}

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many webhook triggers. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/webhooks/github', webhookLimiter, verifyGitHubSignature, async (req: Request, res: Response) => {
  const repoCloneUrl = req.body.repository?.clone_url;
  const repoHtmlUrl = req.body.repository?.html_url;

  if (!repoCloneUrl && !repoHtmlUrl) {
    return res.status(400).json({ error: 'Repository URL missing in payload' });
  }

  const projects = await all('SELECT * FROM projects WHERE repository_url IS NOT NULL');
  const project = projects.find(p => {
    const target = p.repository_url.trim().replace(/\.git$/, '');
    const incomingClone = (repoCloneUrl || '').trim().replace(/\.git$/, '');
    const incomingHtml  = (repoHtmlUrl  || '').trim().replace(/\.git$/, '');
    return target === incomingClone || target === incomingHtml;
  });

  if (!project) return res.status(404).json({ error: 'No linked project found for this repository' });

  const event = req.headers['x-github-event'];

  if (event === 'push') {
    const ref = req.body.ref;
    if (ref !== 'refs/heads/main' && ref !== 'refs/heads/master') {
      return res.json({ message: `Push to ${ref} ignored.` });
    }
    const buildId = uuidv4();
    const targetUrl = repoCloneUrl || repoHtmlUrl;
    res.status(202).json({ message: 'Production deployment enqueued', buildId, project: project.name });

    buildQueue.enqueue(async () => {
      const tempDir = path.join(process.cwd(), '.temp-builds', buildId);
      try {
        await execAsync(`git clone --depth 1 ${targetUrl} "${tempDir}"`);
        await deployProject({ project, sourcePath: tempDir, env: 'production' });
        console.log(`[Queue] Production deploy complete for "${project.name}".`);
      } catch (err) {
        console.error(`[Queue] Deploy failed for "${project.name}":`, err);
      } finally {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

  } else if (event === 'pull_request') {
    const action = req.body.action;
    const prNumber = req.body.pull_request?.number;
    const prHeadUrl = req.body.pull_request?.head?.repo?.clone_url || req.body.pull_request?.head?.repo?.html_url;
    const prBranch  = req.body.pull_request?.head?.ref;

    if (!prNumber) return res.status(400).json({ error: 'PR number missing' });

    const customUrl = `pr-${prNumber}.${project.name}.localhost`;

    if (action === 'opened' || action === 'synchronize' || action === 'reopened') {
      if (!prHeadUrl || !prBranch) return res.status(400).json({ error: 'PR head details missing' });

      const buildId = uuidv4();
      res.status(202).json({ message: `Preview enqueued for PR #${prNumber}`, buildId, previewUrl: `http://${customUrl}:8080` });

      buildQueue.enqueue(async () => {
        const tempDir = path.join(process.cwd(), '.temp-builds', buildId);
        try {
          await execAsync(`git clone --depth 1 --branch ${prBranch} ${prHeadUrl} "${tempDir}"`);
          await deployProject({ project, sourcePath: tempDir, env: 'preview', customUrl });
          console.log(`[Queue] Preview ready: http://${customUrl}:8080`);
        } catch (err) {
          console.error(`[Queue] Preview deploy failed for PR #${prNumber}:`, err);
        } finally {
          if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        }
      });

    } else if (action === 'closed') {
      res.json({ message: `Tearing down preview for PR #${prNumber}` });
      try {
        const previews = await all(
          'SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ? AND url = ?',
          [project.id, 'running', 'preview', customUrl]
        );
        for (const dep of previews) {
          if (dep.container_id) await stopContainer(dep.container_id);
          await run('UPDATE deployments SET status = ? WHERE id = ?', ['stopped', dep.id]);
        }
        await generateAndReload();
      } catch (err) {
        console.error(`[Webhook] Preview teardown failed for PR #${prNumber}:`, err);
      }
    } else {
      res.json({ message: `PR action "${action}" ignored.` });
    }
  } else {
    res.json({ message: `Event "${event}" ignored.` });
  }
});

// ── Maintenance cron ──────────────────────────────────────────────────────────

setInterval(async () => {
  try {
    console.log('[Maintenance] Running cleanup...');
    await execAsync('docker system prune -f');
    await run(`DELETE FROM deployments WHERE status = 'stopped' AND created_at < datetime('now', '-7 days')`);
    await run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
    console.log('[Maintenance] Done.');
  } catch (err) {
    console.error('[Maintenance] Failed:', err);
  }
}, 60 * 60 * 1000);

// ── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  await initDB();
  console.log('[DB] Schema initialized.');
  app.listen(PORT, () => {
    console.log(`Daemon listening on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
