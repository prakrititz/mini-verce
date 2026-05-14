import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';

import { initDB, all, run } from './db';
import { buildQueue } from './queue';
import { deployProject } from './deployer';
import { stopContainer } from './docker';
import { generateAndReload } from './caddy';

const execAsync = util.promisify(exec);

const app = express();
const PORT = process.env.DAEMON_PORT || 4000;

// Capture raw request body buffer to precisely compute HMAC SHA-256 signature
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', daemon: 'mini-vercel', queueLength: buildQueue.getLength(), isBusy: buildQueue.isBusy() });
});

app.get('/api/queue', (req, res) => {
  res.json({
    length: buildQueue.getLength(),
    isBusy: buildQueue.isBusy()
  });
});

/**
 * Middleware to securely validate GitHub HMAC SHA-256 signature.
 */
function verifyGitHubSignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn('Warning: WEBHOOK_SECRET is not configured in environment. Skipping webhook validation.');
    return next();
  }

  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) {
    return res.status(401).json({ error: 'Missing x-hub-signature-256 header' });
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    return res.status(500).json({ error: 'Raw request body buffer unavailable for validation' });
  }

  const hmac = crypto.createHmac('sha256', secret);
  const digest = `sha256=${hmac.update(rawBody).digest('hex')}`;

  if (signature.length !== digest.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    return res.status(401).json({ error: 'Invalid webhook HMAC signature' });
  }

  next();
}

/**
 * Rate limiter middleware restricting webhook endpoints to max 10 requests per minute per IP.
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many webhook triggers from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Main Webhook Handler Endpoint for Continuous Delivery.
 */
app.post('/webhooks/github', webhookLimiter, verifyGitHubSignature, async (req: Request, res: Response) => {
  const repoCloneUrl = req.body.repository?.clone_url;
  const repoHtmlUrl = req.body.repository?.html_url;

  if (!repoCloneUrl && !repoHtmlUrl) {
    return res.status(400).json({ error: 'Repository URL missing in incoming webhook payload' });
  }

  // Find corresponding linked project in local SQLite database
  const projects = await all('SELECT * FROM projects WHERE repository_url IS NOT NULL');
  const project = projects.find(p => {
    const target = p.repository_url.trim().replace(/\.git$/, '');
    const incomingClone = (repoCloneUrl || '').trim().replace(/\.git$/, '');
    const incomingHtml = (repoHtmlUrl || '').trim().replace(/\.git$/, '');
    return target === incomingClone || target === incomingHtml;
  });

  if (!project) {
    return res.status(404).json({ error: 'No linked project registered for this GitHub repository' });
  }

  const event = req.headers['x-github-event'];

  if (event === 'push') {
    const ref = req.body.ref;
    // Only deploy production target when pushing to main or master
    if (ref !== 'refs/heads/main' && ref !== 'refs/heads/master') {
      return res.json({ message: `Push event ignored for non-production reference: ${ref}` });
    }

    const buildId = uuidv4();
    const targetRepoUrl = repoCloneUrl || repoHtmlUrl;

    // Acknowledge immediately to prevent GitHub delivery timeouts while enqueued
    res.status(202).json({ 
      message: 'Production deployment task enqueued successfully', 
      buildId, 
      project: project.name 
    });

    buildQueue.enqueue(async () => {
      const tempDir = path.join(process.cwd(), '.temp-builds', buildId);
      try {
        console.log(`[Queue] Pulling source and building production deployment for "${project.name}"...`);
        
        // Fast shallow clone into unique temp build directory
        await execAsync(`git clone --depth 1 ${targetRepoUrl} "${tempDir}"`);
        
        await deployProject({
          project,
          sourcePath: tempDir,
          env: 'production'
        });
        
        console.log(`[Queue] Production deployment completed successfully for "${project.name}".`);
      } catch (err) {
        console.error(`[Queue] Deployment pipeline failure for "${project.name}":`, err);
      } finally {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

  } else if (event === 'pull_request') {
    const action = req.body.action;
    const prNumber = req.body.pull_request?.number;
    const prHeadRepoUrl = req.body.pull_request?.head?.repo?.clone_url || req.body.pull_request?.head?.repo?.html_url;
    const prBranch = req.body.pull_request?.head?.ref;

    if (!prNumber) {
      return res.status(400).json({ error: 'Pull request identification number missing' });
    }

    const customUrl = `pr-${prNumber}.${project.name}.localhost`;

    if (action === 'opened' || action === 'synchronize') {
      if (!prHeadRepoUrl || !prBranch) {
        return res.status(400).json({ error: 'Pull request head origin details missing' });
      }

      const buildId = uuidv4();
      res.status(202).json({ 
        message: `Preview environment deployment enqueued for PR #${prNumber}`, 
        buildId, 
        previewUrl: `http://${customUrl}:8080` 
      });

      buildQueue.enqueue(async () => {
        const tempDir = path.join(process.cwd(), '.temp-builds', buildId);
        try {
          console.log(`[Queue] Building Preview Environment for PR #${prNumber} of "${project.name}"...`);
          
          await execAsync(`git clone --depth 1 --branch ${prBranch} ${prHeadRepoUrl} "${tempDir}"`);
          
          await deployProject({
            project,
            sourcePath: tempDir,
            env: 'preview',
            customUrl
          });
          
          console.log(`[Queue] Preview environment ready at http://${customUrl}:8080`);
        } catch (err) {
          console.error(`[Queue] Preview deployment failed for PR #${prNumber}:`, err);
        } finally {
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        }
      });

    } else if (action === 'closed') {
      res.json({ message: `Triggering preview environment teardown for closed PR #${prNumber}` });

      try {
        console.log(`Destroying preview containers for closed PR #${prNumber} (${customUrl})...`);
        const activePreviews = await all(
          'SELECT * FROM deployments WHERE project_id = ? AND status = ? AND env = ? AND url = ?',
          [project.id, 'running', 'preview', customUrl]
        );

        for (const dep of activePreviews) {
          if (dep.container_id) {
            await stopContainer(dep.container_id);
          }
          await run('UPDATE deployments SET status = ? WHERE id = ?', ['stopped', dep.id]);
        }

        await generateAndReload();
        console.log(`Preview environment destroyed successfully for PR #${prNumber}.`);
      } catch (err) {
        console.error(`Teardown failure for preview environment PR #${prNumber}:`, err);
      }
    } else {
      res.json({ message: `Pull request action state "${action}" ignored.` });
    }
  } else {
    res.json({ message: `GitHub event type "${event}" received but ignored.` });
  }
});

async function start() {
  await initDB();
  console.log('Database and persistent schema initialized.');

  app.listen(PORT, () => {
    console.log(`Daemon server listening on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
