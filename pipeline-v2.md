# Mini-Vercel V2 — Platform Architecture Roadmap

> **Core Principle:** This is a self-hosted developer deployment platform. Not a centralized SaaS. Every architectural decision must optimize for running on the developer's own machine or server.

---

## The Foundational Shift

**V1 (current) — Folder-centric:**
```
cwd path → project lookup
```

**V2 (target) — Identity-centric:**
```
User
  ↓ owns
Projects
  ↓ own
Deployments
  ↓ map to
Containers
```

---

## Phase 1 — Real Local Identity System

**Goal:** Replace the random-UUID login with a stable, persistent local identity.

**The Problem:**
Every `mini-vercel login` currently creates a brand-new random user. There is no persistence, no ownership, and no way to reconnect to existing projects across sessions.

**New Commands:**
```
mini-vercel signup   → create local account (email + password)
mini-vercel login    → authenticate and start a session
mini-vercel logout   → destroy the local session token
```

**Database Change (`users` table):**
```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Password Security:**
- Use `bcrypt` (cost factor ≥ 12) for all password hashing.
- Never store or log raw passwords.
- Install: `npm install bcryptjs`

**Login Flow:**
```
email + password
      ↓
daemon: SELECT user WHERE email = ?
      ↓
bcrypt.compare(password, hash)
      ↓
generate cryptographically random session token (32 bytes hex)
      ↓
INSERT INTO sessions (token, user_id, expires_at)
      ↓
write ~/.mini-vercel-auth.json
```

**Session File (`~/.mini-vercel-auth.json`):**
```json
{
  "userId": "uuid-here",
  "sessionToken": "64-char-hex-token",
  "email": "dev@example.com"
}
```

**New `sessions` table:**
```sql
CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
```

Sessions expire after 30 days. The daemon must clean expired sessions on startup.

**Key Files to Change:**
- `src/db.ts` — new schema, sessions table
- `src/cli.ts` — replace `login` command, add `signup`, `logout`
- `src/daemon.ts` — add `/auth/signup`, `/auth/login`, `/auth/logout` endpoints

---

## Phase 2 — Project Ownership

**Goal:** Projects belong to users. A project without an owner is an orphan.

**The Problem:**
Projects are currently global. Anyone who knows a project name can touch it. There is no concept of "my projects."

**Database Change:**
```sql
ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id);
```

**Updated `link` flow:**
```
1. Read ~/.mini-vercel-auth.json → get userId
2. Send token to daemon (Authorization header)
3. Daemon validates session → extracts user_id
4. INSERT projects (id, name, path, owner_id = user_id, ...)
```

**Ownership Validation:**
All project mutations (deploy, stop, delete, env add) must verify:
```sql
SELECT * FROM projects WHERE id = ? AND owner_id = ?
```

**`list` command updates:**
Only show projects belonging to the authenticated user:
```sql
SELECT * FROM projects WHERE owner_id = ?
```

**Key Files to Change:**
- `src/db.ts` — migration for `owner_id`
- `src/cli.ts` — `link`, `deploy`, `list` read and send auth token
- `src/daemon.ts` — ownership checks on all project routes

---

## Phase 3 — Session Authorization Middleware

**Goal:** The daemon must stop trusting everything. Every destructive action requires a valid session.

**The Problem:**
Currently any process on the machine can hit the daemon and deploy, stop, or delete anything.

**Auth Middleware (`src/daemon.ts`):**
```ts
async function verifySessionToken(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No session token provided' });

  const session = await get(
    'SELECT s.*, u.id as userId FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime("now")',
    [token]
  );
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  (req as any).userId = session.userId;
  next();
}
```

**Protected Routes:**
| Route | Auth Required |
|---|---|
| `POST /deploy` | ✅ |
| `POST /stop` | ✅ |
| `GET /logs/:id` | ✅ |
| `POST /rollback` | ✅ |
| `POST /env` | ✅ |
| `GET /projects` | ✅ |
| `POST /webhooks/github` | ❌ (HMAC instead) |
| `GET /health` | ❌ |

**CLI Token Injection:**
Every CLI command that talks to the daemon reads `~/.mini-vercel-auth.json` and injects:
```
Authorization: Bearer <sessionToken>
```

**Key Files to Change:**
- `src/daemon.ts` — `verifySessionToken` middleware on all protected routes
- `src/cli.ts` — inject `Authorization` header on all daemon-calling commands

---

## Phase 4 — GitHub Account Linking

**Goal:** Connect a real GitHub identity to the platform. Stop relying on manually pasted repo URLs.

**The Problem:**
Currently only a raw repository URL is stored. There is no GitHub identity, no way to list repos, no way to auto-configure webhooks, and no access to private repos.

**New Command:**
```
mini-vercel github connect
```

**Implementation: Option A — Personal Access Token (build this first)**

Flow:
```
1. Prompt user: "Paste your GitHub Personal Access Token (repo + webhook scope):"
2. Validate token against GET https://api.github.com/user
3. Encrypt PAT using AES-256 with a key derived from the session token
4. Store encrypted_pat + github_username in users table
5. Confirm: "Connected as github.com/<username>"
```

Database change:
```sql
ALTER TABLE users ADD COLUMN github_username TEXT;
ALTER TABLE users ADD COLUMN github_pat_encrypted TEXT;
```

**Implementation: Option B — GitHub OAuth (upgrade path)**

Flow:
```
1. daemon opens http://localhost:4000/auth/github/start
2. redirect to GitHub OAuth authorize URL
3. GitHub redirects back to http://localhost:4000/auth/github/callback
4. exchange code for access_token
5. store token in users table
```

**With GitHub linked, the platform can:**
- `mini-vercel import` → fetch repo list via API, select interactively
- Auto-configure webhooks via `POST /repos/:owner/:repo/hooks`
- Clone private repositories using the stored token
- Validate webhook payloads match a repo the user actually owns

**New `import` command flow:**
```
1. GET https://api.github.com/user/repos
2. Display interactive list (use `inquirer`)
3. User selects repo
4. Auto-run: link --name <repo> --repo <clone_url>
5. Auto-configure GitHub webhook via API
```

**Key Files to Change:**
- `src/db.ts` — `github_username`, `github_pat_encrypted` columns
- `src/cli.ts` — `github connect`, `import` commands
- `src/daemon.ts` — `/auth/github/start`, `/auth/github/callback` endpoints

---

## Phase 5 — Real HTTPS

**Goal:** Automatic TLS everywhere. No more plain HTTP on port 8080.

**The Problem:**
HTTPS is currently non-functional or placeholder. The Caddy config binds to HTTP-only local URLs.

**For Local Development (localhost):**

Use Caddy's built-in local CA:
```
{
  local_certs
}

myapp.localhost {
  tls internal
  reverse_proxy host.docker.internal:3421
}
```

Run once:
```bash
caddy trust   # installs Caddy local CA to system trust store
```

All `.localhost` domains get automatic HTTPS via Caddy's local CA. No mkcert needed.

**For Public Domains (custom domain on a real server):**

Caddy handles Let's Encrypt automatically:
```
myapp.yourdomain.com {
  reverse_proxy host.docker.internal:3421
}
```

No configuration needed. Caddy fetches and renews TLS certs automatically.

**Wildcard Domains (advanced):**
```
*.yourdomain.com {
  tls {
    dns cloudflare {env.CF_API_TOKEN}
  }
  reverse_proxy host.docker.internal:{vars.port}
}
```

Requires Caddy DNS plugin. Good for preview environments.

**Updated Caddyfile generation (`src/caddy.ts`):**
- Replace all `http://` blocks with bare hostnames (Caddy auto-upgrades to HTTPS)
- Add `local_certs` global block when running in local mode
- Add `tls internal` directive per-site in local mode

**Key Files to Change:**
- `src/caddy.ts` — `generateCaddyfile()` rewrite for HTTPS-first generation
- `src/daemon.ts` — expose `CADDY_MODE=local|public` env var to toggle cert strategy

---

## Phase 6 — Local Project Dashboard

**Goal:** A web UI served by the daemon that gives full visibility into the platform state.

**New Entry Point:**
```
http://localhost:4000/dashboard
```

The daemon serves a React or vanilla JS SPA from a `/public` directory.

**Dashboard Panels:**

| Panel | Data Source |
|---|---|
| Projects list | `GET /api/projects` |
| Active deployments | `GET /api/deployments?status=running` |
| Build queue state | `GET /api/queue` |
| Live container logs | `GET /api/logs/:containerId` (SSE stream) |
| Preview URLs | `GET /api/deployments?env=preview` |
| Domain config | `GET /api/domains/:projectId` |
| Rollback controls | `POST /api/rollback` |
| Restart / Stop buttons | `POST /api/restart`, `POST /api/stop` |

**Real-time log streaming:**
Use Server-Sent Events (SSE) instead of WebSockets for simplicity:
```ts
app.get('/api/logs/:containerId/stream', verifySessionToken, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  const stream = await docker.getContainer(req.params.containerId).logs({ follow: true, stdout: true, stderr: true });
  stream.on('data', chunk => res.write(`data: ${chunk.toString()}\n\n`));
  req.on('close', () => stream.destroy());
});
```

**Key Files to Add:**
- `src/dashboard/` — static SPA source (vanilla JS + CSS or React)
- `public/` — compiled dashboard output served by Express
- `src/daemon.ts` — `app.use('/dashboard', express.static('public'))`

---

## Phase 7 — Deployment Management Commands

**Goal:** Full lifecycle control over deployments from the CLI.

**New and Updated Commands:**

```
mini-vercel status [project]     → show all deployments, container health, URLs
mini-vercel stop [project]       → gracefully stop the running container
mini-vercel restart [project]    → stop + redeploy from last image (no rebuild)
mini-vercel rollback [project]   → switch Caddy to the previous retained container
mini-vercel ps                   → list ALL running containers across all projects
```

**`restart` implementation:**
Instead of a full rebuild, restart reuses the last Docker image:
```ts
// find latest stopped or running deployment
// startContainer(existingImageName, newPort, newContainerName)
// generateAndReload()
// mark old deployment stopped
```

This is much faster than a full rebuild for a quick bounce.

**`status` output:**
```
Project: my-app
  URL:          https://my-app.localhost
  Status:       running
  Container:    abc123def456
  Deployed at:  2026-05-18 10:00:00
  Rollbacks:    2 available
  Queue:        idle
```

**Key Files to Change:**
- `src/cli.ts` — add `status`, `stop`, `restart`, `ps` commands
- `src/daemon.ts` — add `POST /stop`, `POST /restart`, `GET /status` endpoints
- `src/deployer.ts` — add `restartDeployment()` function

---

## Phase 8 — Container Resource Safety

**Goal:** Prevent a bad deployment from destroying the host machine.

**The Problem:**
Docker containers with no resource limits can consume all available RAM and CPU, causing the host OS to freeze or OOM-kill critical processes.

**Updated `startContainer` in `src/docker.ts`:**
```ts
const container = await docker.createContainer({
  Image: imageName,
  name: containerName,
  Env: env || [],
  HostConfig: {
    Memory: 512 * 1024 * 1024,       // 512 MB RAM hard limit
    MemorySwap: 512 * 1024 * 1024,   // disable swap for container
    CpuShares: 512,                   // ~50% of 1 CPU core relative weight
    CpuPeriod: 100000,
    CpuQuota: 50000,                  // 50% of 1 CPU core hard limit
    RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
    PortBindings: { ... }
  }
});
```

**Per-project overrides via `minivercel.json`:**
```json
{
  "resources": {
    "memoryMB": 1024,
    "cpuPercent": 75
  }
}
```

**Health check integration:**
```ts
Healthcheck: {
  Test: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
  Interval: 10000000000,  // 10s in nanoseconds
  Timeout: 5000000000,
  Retries: 3
}
```

After starting a container, the deployer waits for the health check to pass before cutting Caddy over — making blue-green truly safe.

**Key Files to Change:**
- `src/docker.ts` — resource limits in `createContainer`
- `src/frameworks.ts` — read `minivercel.json` resource block
- `src/deployer.ts` — poll container health before `generateAndReload()`

---

## Phase 9 — Smarter Build System

**Goal:** Faster deployments through Docker layer caching and build reuse.

**The Problem:**
Every deployment does a full `docker build` from scratch. On a resource-constrained machine this is slow and wasteful.

**Improvement 1 — Named base image caching:**
Tag intermediate builder images and reuse them:
```ts
const baseImageName = `mini-vercel-base-${project.name}`;
// build with --cache-from baseImageName
buildOptions['cachefrom'] = [baseImageName];
```

**Improvement 2 — `.dockerignore` enforcement:**
Automatically write a strict `.dockerignore` if missing:
```
node_modules
.git
.env
dist
*.log
```
This drastically reduces the tar pack size sent to the Docker daemon.

**Improvement 3 — BuildKit support:**
Enable Docker BuildKit for parallel layer building:
```ts
const buildOptions = {
  t: imageName,
  buildargs: { BUILDKIT_INLINE_CACHE: '1' },
  cachefrom: [previousImage]
};
```

**Improvement 4 — Incremental deploys (advanced):**
Track the last git commit SHA deployed per project:
```sql
ALTER TABLE deployments ADD COLUMN commit_sha TEXT;
```
If the new push has the same SHA as the last successful deployment, skip the build entirely and just restart the existing container.

**Key Files to Change:**
- `src/docker.ts` — `buildImage()` with cache options
- `src/frameworks.ts` — `.dockerignore` auto-generation
- `src/db.ts` — `commit_sha` column migration

---

## Phase 10 — Dev Mode (File Watch)

**Goal:** Local development loop with automatic re-deployment on file changes.

**New Command:**
```
mini-vercel dev
```

**Implementation:**
Use `chokidar` for file watching:
```ts
import chokidar from 'chokidar';

const watcher = chokidar.watch(cwd, {
  ignored: /(node_modules|\.git|dist)/,
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 500 }
});

let debounceTimer: NodeJS.Timeout;
watcher.on('change', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => triggerLocalDeploy(), 1000);
});
```

**Behavior:**
- Debounce 1 second after last file change before triggering redeploy.
- Show a compact rebuild spinner (no full deploy log noise).
- Keep the last deployment running until the new one is healthy.
- Print the local URL after each successful redeploy.

**Install:** `npm install chokidar`

**Key Files to Change:**
- `src/cli.ts` — add `dev` command
- `src/deployer.ts` — `devDeploy()` variant with quieter output

---

## Phase 11 — Better Domain System

**Goal:** First-class domain management. Move from fragile `.localhost` hacks to a proper domain model.

**The Problem:**
`project.localhost` behavior is inconsistent across browsers and OS. Custom domains require manual Caddyfile knowledge.

**V2 Domain Model:**

| Environment | Domain Format | TLS |
|---|---|---|
| Local dev | `project.localhost` | Caddy local CA |
| Local named | `project.local` (mDNS) | mkcert or Caddy local CA |
| Custom domain | `myapp.com` | Let's Encrypt (auto) |
| Preview PR | `pr-42.project.localhost` | Caddy local CA |
| Wildcard | `*.project.yourdomain.com` | Let's Encrypt DNS challenge |

**`domain` command enhancements:**
```
mini-vercel domain add myapp.com          → adds domain, updates Caddy, triggers cert
mini-vercel domain rm myapp.com           → removes domain, reloads Caddy
mini-vercel domain list                   → show all domains + cert status
mini-vercel domain verify myapp.com       → check DNS propagation via API
```

**DNS verification:**
Before adding a custom domain, optionally check DNS:
```ts
import dns from 'dns/promises';
const records = await dns.resolve4(domain);
// warn if not pointing to this machine's IP
```

**Database change:**
```sql
CREATE TABLE domains (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  domain     TEXT UNIQUE NOT NULL,
  is_primary BOOLEAN DEFAULT 0,
  tls_status TEXT DEFAULT 'pending',  -- pending | active | failed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
```
Replace the single `custom_domain` column on `projects` with this relational table, supporting multiple domains per project.

**Key Files to Change:**
- `src/db.ts` — `domains` table, migrate `custom_domain` column
- `src/caddy.ts` — query `domains` table instead of `projects.custom_domain`
- `src/cli.ts` — full `domain` subcommand suite

---

## Phase 12 — Plugin / Framework Adapter System

**Goal:** Make framework detection extensible. Any framework, any language.

**The Problem:**
Framework detection is currently a large hardcoded `if/else` chain in `frameworks.ts`. Adding a new framework requires editing core platform code.

**New Architecture — Adapter Pattern:**
```
src/
  adapters/
    nextjs.ts
    vite.ts
    react-cra.ts
    express.ts
    fastapi.ts
    static.ts       ← fallback
    base.ts         ← abstract base class
```

**Base adapter interface:**
```ts
export interface FrameworkAdapter {
  name: string;
  detect(projectPath: string, pkg: any): boolean;
  generateDockerfile(projectPath: string, config: MiniVercelConfig): string;
  generateDockerignore(): string;
  defaultPort: number;
  buildCommand: string;
  startCommand: string;
}
```

**Detection runs in priority order:**
```ts
const adapters: FrameworkAdapter[] = [
  new NextJsAdapter(),
  new ViteAdapter(),
  new ReactCRAAdapter(),
  new FastAPIAdapter(),
  new ExpressAdapter(),
  new StaticAdapter(),  // always matches as fallback
];

export function detectFramework(projectPath: string): FrameworkAdapter {
  const pkg = readPackageJson(projectPath);
  return adapters.find(a => a.detect(projectPath, pkg)) ?? new StaticAdapter();
}
```

**Community adapters (future):**
A `mini-vercel.adapters.json` in the project root can specify a custom adapter path:
```json
{
  "adapter": "./my-custom-adapter.js"
}
```

**Key Files to Change:**
- `src/frameworks.ts` → `src/adapters/index.ts` (refactor, not rewrite)
- `src/adapters/base.ts` — interface definition
- `src/adapters/*.ts` — one file per framework

---

## Final Target Architecture

```
CLI (mini-vercel)
  ↓  Authorization header (session token)
Persistent Daemon (Express, port 4000)
  ├── Auth layer (signup / login / sessions)
  ├── Project API (CRUD + ownership)
  ├── Deployment Engine
  │     ├── Framework Adapter (auto-detect)
  │     ├── Docker (build + run + health check)
  │     ├── Resource Limits (mem / cpu)
  │     └── Build Cache
  ├── FIFO Build Queue (p-queue)
  ├── GitHub Webhook Handler (HMAC validated)
  ├── GitHub Integration (PAT / OAuth)
  ├── Caddy Manager (HTTPS-first Caddyfile generation)
  ├── Domain System (multi-domain per project)
  ├── Preview Environments (PR-based, auto-teardown)
  ├── Rollback Engine (retained containers)
  ├── Maintenance Cron (prune + DB cleanup)
  └── Dashboard (SPA at /dashboard)
```

---

## Implementation Order (Recommended)

| Priority | Phase | Why |
|---|---|---|
| 🔴 Critical | Phase 1 — Identity | Everything else depends on this |
| 🔴 Critical | Phase 2 — Ownership | Makes projects meaningful |
| 🔴 Critical | Phase 3 — Auth Middleware | Security baseline |
| 🟠 High | Phase 8 — Container Safety | Protects the host machine |
| 🟠 High | Phase 5 — Real HTTPS | Makes it actually usable |
| 🟠 High | Phase 4 — GitHub Linking | Removes the biggest UX friction |
| 🟡 Medium | Phase 7 — Deployment Management | Quality of life |
| 🟡 Medium | Phase 11 — Domain System | Proper multi-domain support |
| 🟡 Medium | Phase 6 — Dashboard | Major UX win |
| 🟢 Low | Phase 9 — Build System | Performance |
| 🟢 Low | Phase 12 — Adapters | Extensibility |
| 🟢 Low | Phase 10 — Dev Mode | Developer convenience |
