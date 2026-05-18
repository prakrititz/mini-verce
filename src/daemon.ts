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
import { generateAndReload } from './caddy';

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

// ── Phase 1: Identity endpoints ───────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many auth attempts. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /auth/signup
 * Body: { email, password }
 * Creates a new user account with bcrypt-hashed password and returns a session token.
 */
app.post('/auth/signup', authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();
  await run('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [userId, email, passwordHash]);

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  await run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [sessionToken, userId, expiresAt]);

  console.log(`[Auth] New account created: ${email} (${userId})`);
  res.status(201).json({ userId, sessionToken });
});

/**
 * POST /auth/login
 * Body: { email, password }
 * Verifies credentials and returns a new session token.
 */
app.post('/auth/login', authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    // Same error regardless of whether email exists — prevents enumeration
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
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
 * Deletes the caller's session token.
 */
app.post('/auth/logout', async (req: Request, res: Response) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    await run('DELETE FROM sessions WHERE token = ?', [token]).catch(() => {});
  }
  res.json({ message: 'Logged out.' });
});

// ── Phase 1: Session auth middleware ──────────────────────────────────────────

/**
 * Validates the Bearer session token from the Authorization header.
 * Attaches req.userId on success.
 */
async function verifySessionToken(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Run "mini-vercel login".' });
  }

  const session = await get(
    `SELECT s.user_id FROM sessions s
     WHERE s.token = ? AND s.expires_at > datetime('now')`,
    [token]
  );

  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid. Run "mini-vercel login".' });
  }

  (req as any).userId = session.user_id;
  next();
}

// ── GitHub webhook middleware ─────────────────────────────────────────────────

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

// ── GitHub webhook handler ────────────────────────────────────────────────────

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
    const incomingHtml = (repoHtmlUrl || '').trim().replace(/\.git$/, '');
    return target === incomingClone || target === incomingHtml;
  });

  if (!project) {
    return res.status(404).json({ error: 'No linked project found for this repository' });
  }

  const event = req.headers['x-github-event'];

  if (event === 'push') {
    const ref = req.body.ref;
    if (ref !== 'refs/heads/main' && ref !== 'refs/heads/master') {
      return res.json({ message: `Push to ${ref} ignored.` });
    }

    const buildId = uuidv4();
    const targetRepoUrl = repoCloneUrl || repoHtmlUrl;
    res.status(202).json({ message: 'Production deployment enqueued', buildId, project: project.name });

    buildQueue.enqueue(async () => {
      const tempDir = path.join(process.cwd(), '.temp-builds', buildId);
      try {
        await execAsync(`git clone --depth 1 ${targetRepoUrl} "${tempDir}"`);
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
    const prHeadRepoUrl = req.body.pull_request?.head?.repo?.clone_url || req.body.pull_request?.head?.repo?.html_url;
    const prBranch = req.body.pull_request?.head?.ref;

    if (!prNumber) return res.status(400).json({ error: 'PR number missing' });

    const customUrl = `pr-${prNumber}.${project.name}.localhost`;

    if (action === 'opened' || action === 'synchronize' || action === 'reopened') {
      if (!prHeadRepoUrl || !prBranch) {
        return res.status(400).json({ error: 'PR head details missing' });
      }
      const buildId = uuidv4();
      res.status(202).json({ message: `Preview deploy enqueued for PR #${prNumber}`, buildId, previewUrl: `http://${customUrl}:8080` });

      buildQueue.enqueue(async () => {
        const tempDir = path.join(process.cwd(), '.temp-builds', buildId);
        try {
          await execAsync(`git clone --depth 1 --branch ${prBranch} ${prHeadRepoUrl} "${tempDir}"`);
          await deployProject({ project, sourcePath: tempDir, env: 'preview', customUrl });
          console.log(`[Queue] Preview ready at http://${customUrl}:8080`);
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
