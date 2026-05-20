# Mini-Vercel (Self-Hosted PaaS)

[![Architecture Diagram](./overview.svg)](./overview.svg)
*(Click the diagram to open it in full screen for zooming and panning)*

Mini-Vercel is an open-source, self-hosted Platform-as-a-Service (PaaS) designed to emulate the developer experience of Vercel. It is built to run efficiently on resource-constrained hardware (like an older laptop) while providing magical, zero-downtime deployments.

## Architecture & Tech Stack

- **CLI & Daemon**: Built with Node.js and TypeScript.
- **Containerization**: `dockerode` programmatically builds and manages Docker containers.
- **Reverse Proxy**: Caddy runs inside a Docker container, providing automatic, zero-downtime routing via a dynamically generated `Caddyfile`.
- **Database**: SQLite3 (`data.sqlite`) is used to locally store project metadata, environments, and deployment history.

### Blazing Fast Performance ⚡
With optimized port-binding and caching strategies, `mini-vercel` is extremely fast. Once dependencies and base Docker images are cached locally, deployment overhead is minimal. 
*Benchmark: A production Vite React application completes a full zero-downtime deployment in just **~25 seconds**!*

---

## Prerequisites

Before using the CLI, ensure you have the following installed and running on your host machine:
1. **Node.js** (v18+)
2. **Docker Desktop** (or Docker Engine). *The daemon must be running for deployments to succeed.*

---

## Installation & Setup

1. **Clone the repository** (or navigate to the project folder).
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Build the TypeScript files**:
   ```bash
   npm run build
   ```
4. **Link the CLI globally**:
   ```bash
   npm link
   ```
   *You can now run `mini-vercel` from anywhere in your terminal.*

---

## Getting Started: Deploying Your First Project

Follow these exact steps in order to deploy your first project from a GitHub repository:

1. **Start the background daemon**:
   ```bash
   mini-vercel start-daemon
   ```
2. **Create an account / Login**:
   ```bash
   mini-vercel signup
   ```
   *(Or `mini-vercel login` if you already have an account)*
3. **Clone your project repository**:
   ```bash
   git clone https://github.com/your-username/your-repo.git
   cd your-repo
   ```
4. **Link the project to Mini-Vercel**:
   ```bash
   mini-vercel link
   ```
5. **Deploy the project**:
   ```bash
   mini-vercel deploy
   ```
6. **Check the status and get your URL**:
   ```bash
   mini-vercel list
   ```
   *(Your app will be available at `https://your-project-name.localhost`)*

---

## Available Commands (Stages 1, 2 & 3)

Currently, the CLI supports the following workflow:

### `mini-vercel start-daemon`
Spawns the background Express server (the Control Plane) and ensures the Caddy reverse proxy Docker container is running.
*This must be run once before you start deploying apps.*

### `mini-vercel login`
Generates a unique local authentication token and stores it in your home directory (`~/.mini-vercel-auth.json`).

### `mini-vercel link [options]`
Registers the current working directory as a project in the database.
- `-n, --name <name>`: Override the default project name (which defaults to the folder name).
- `-r, --repo <repo>`: Provide a GitHub repository URL for future webhook integration.

### `mini-vercel deploy`
Manually triggers a build and deployment for the current directory.
1. **Zero-Config Framework Auto-Detection**: Inspects `package.json` and optionally `minivercel.json` to detect Next.js, Vite, Create React App, or generic Node.js apps. If a `Dockerfile` or `.dockerignore` is missing, optimized standalone or multi-stage assets are automatically written to the root directory.
2. Packages the directory and builds the Docker image.
3. Finds a random available host port and starts the new container.
4. Dynamically updates the `Caddyfile` and executes `caddy reload` for a seamless blue-green deployment.
5. **Graceful Cleanup**: Gracefully shuts down and removes previous running containers for the project to free up host resources immediately with zero downtime.
6. Proxies the app to `http://<project-name>.localhost:8080`.

### Custom Configuration (`minivercel.json`)
You can place a `minivercel.json` file in your project root to override auto-detection defaults:
```json
{
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "outputDirectory": "dist"
}
```

### `mini-vercel env add <key> <value>`
Securely store an environment variable for the linked project in the SQLite database.

### `mini-vercel env rm <key>`
Remove a stored environment variable.

### `mini-vercel env pull`
Query the database and write all stored environment variables to a `.env` file in the current project directory.

### `mini-vercel logs [project-name]`
View the recent stdout/stderr logs from the running project container.
- `-f, --follow`: Stream live log output continuously to your terminal.

### `mini-vercel list`
Queries the database and prints a formatted table of all active projects, their statuses, and their local URLs.

---

## Project Roadmap

This project is being built in stages. **Stages 1–6** are complete and shipped on `main`. **V2 phases** are the next evolution of the platform.

### ✅ Completed Stages (V1)

- [x] **Stage 1: Foundation & Core CLI** — SQLite, base CLI commands
- [x] **Stage 2: Basic Deployment Engine** — Dockerode integration, Caddy proxy container
- [x] **Stage 3: Zero-Config Framework Detection** — Auto-generating Dockerfiles for Next.js, Vite, Node
- [x] **Stage 4: Continuous Delivery** — GitHub Webhooks & FIFO Build Queue
- [x] **Stage 5: Environment Variables & Logs** — Managing secrets
- [x] **Stage 6: Advanced PaaS Features** — Rollbacks, PR Previews, Custom Domains

---

### 🚀 V2 Platform Architecture (In Progress)

The V2 roadmap shifts from a folder-centric model to an **identity-centric** platform. See [`pipeline-v2.md`](./pipeline-v2.md) for full technical specs.

| Priority | Phase | Description | Status |
|---|---|---|---|
| 🔴 Critical | **Phase 1 — Real Local Identity** | Replace random-UUID login with persistent `signup`/`login`/`logout` backed by bcrypt + sessions | ✅ Done |
| 🔴 Critical | **Phase 2 — Project Ownership** | Projects belong to users; all mutations require ownership validation | ✅ Done |
| 🔴 Critical | **Phase 3 — Session Auth Middleware** | Daemon-side `verifySessionToken` middleware protects all destructive routes | ✅ Done |
| 🟠 High | **Phase 4 — GitHub Account Linking** | `mini-vercel github connect` — PAT-based linking (AES-256 encrypted), repo list, webhook auto-registration, `import` command | ✅ Done |
| 🟠 High | **Phase 5 — Real HTTPS** | Caddy local CA (`tls internal`) for localhost + automatic Let's Encrypt for public domains; `caddy trust` & `caddy mode` commands | ✅ Done |
| 🟠 High | **Phase 6 — Local Project Dashboard** | Web UI at `http://localhost:4000/dashboard` with live SSE log streaming, rollback controls, build queue state | 🔲 Planned |
| 🟡 Medium | **Phase 7 — Deployment Management Commands** | `status`, `stop`, `restart`, `rollback`, `ps` — full lifecycle control from the CLI | 🔲 Planned |
| 🟠 High | **Phase 8 — Container Resource Safety** | Hard memory/CPU limits on every container; per-project overrides via `minivercel.json`; health-check-gated blue-green | 🔲 Planned |
| 🟢 Low | **Phase 9 — Smarter Build System** | Docker layer caching, BuildKit, auto `.dockerignore`, incremental deploys via commit SHA | 🔲 Planned |
| 🟢 Low | **Phase 10 — Dev Mode (File Watch)** | `mini-vercel dev` — chokidar-powered file watcher with debounced auto-redeploy | 🔲 Planned |
| 🟡 Medium | **Phase 11 — Better Domain System** | Relational `domains` table, multi-domain per project, `domain add/rm/list/verify` suite, DNS propagation check | 🔲 Planned |
| 🟢 Low | **Phase 12 — Plugin / Framework Adapter System** | Extensible adapter pattern replacing hardcoded framework detection; community adapter support via `mini-vercel.adapters.json` | 🔲 Planned |
