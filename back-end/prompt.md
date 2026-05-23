# MISSION: 
You are an expert DevOps and Node.js Engineer. Your task is to build a comprehensive, open-source, self-hosted Platform-as-a-Service (PaaS) — effectively a "Free Version of Vercel" — designed to run efficiently on a resource-constrained older laptop. It should mimic the developer experience of Vercel, providing zero-config deployments, automatic framework detection, and seamless GitHub integration.

# ARCHITECTURE & TECH STACK:
1. **Language:** Node.js (TypeScript preferred for robust type safety)
2. **CLI Interface:** `commander` or `yargs` (for user commands, mirroring the Vercel CLI experience).
3. **API / Control Plane:** `express` (to listen for GitHub Webhooks, API requests, and serve a minimal dashboard).
4. **Containerization:** `dockerode` (to programmatically interact with the local Docker Engine).
5. **Database:** `sqlite3` (to store project metadata, environment variables, webhooks, and deployment history).
6. **Reverse Proxy:** Generate a `Caddyfile` dynamically (Caddy handles auto-SSL, subdomains, and routing seamlessly).
7. **Rate Limiting:** `express-rate-limit` for the API.
8. **Queue System:** `p-queue` or a simple FIFO array to ensure ONLY ONE Docker build happens at a time to prevent host resource exhaustion.

# CORE FEATURES TO IMPLEMENT:

## 1. The CLI Application (`mini-vercel`)
Create a CLI tool that mirrors the Vercel CLI workflow with the following commands:
* `mini-vercel start-daemon`: Starts the background Express server (Control Plane) and Caddy proxy.
* `mini-vercel login`: Authenticate the CLI with the local daemon via a generated token.
* `mini-vercel link`: Connects the current directory to a project in the database and links a GitHub repository URL.
* `mini-vercel env [add|rm|pull]`: Manage environment variables for a project, storing them securely in SQLite and injecting them during build/runtime.
* `mini-vercel deploy`: Manually triggers a zero-config Docker build and deployment for the current directory.
* `mini-vercel logs [-f] <project-name>`: Fetches or streams logs from the running Docker container.
* `mini-vercel list`: Lists all running projects, their local/public URLs, and deployment status.
* `mini-vercel domain add <project-name> <domain>`: Link a custom domain to a project.
* `mini-vercel rollback <project-name> <deployment-id>`: Instantly revert to a previous successful deployment container.

## 2. Project Configuration (`minivercel.json`)
Support a configuration file (similar to `vercel.json`) allowing users to override defaults:
* Build Command (e.g., `npm run build`)
* Install Command (e.g., `npm install`)
* Output Directory (e.g., `dist`, `build`, `.next`)
* Environment variables specific to the build or runtime.

## 3. The Control Plane (Express API & Webhooks)
* Create endpoints for the CLI to interact with (e.g., `/api/projects`, `/api/deploy`).
* Create an endpoint `POST /webhooks/github`.
* **Security:** Validate the GitHub HMAC SHA-256 signature using a secret stored in a local `.env` file.
* **Rate Limiting:** Restrict the webhook endpoint to max 10 requests per minute per IP to prevent spam.
* **Production Deployments:** When a valid webhook triggers on the `main` branch:
  1. Add the build job to a **FIFO Queue** (CRITICAL: Do not run concurrent builds).
  2. Clone/Pull the latest code into a temporary directory.
* **Preview Deployments:** If a webhook triggers for a Pull Request, deploy to a temporary preview URL (e.g., `pr-12.project.localhost`) and destroy it when the PR is merged/closed.

## 4. The Deployment Engine (Dockerode)
When a build job is pulled from the queue:
1. **Zero-Config Framework Detection:** Look for a `minivercel.json` or auto-detect the framework (Next.js, Create React App, Vite, Express, plain Node.js) based on `package.json`.
2. Generate an optimized `Dockerfile` (multi-stage build if applicable) based on the detected framework.
3. Run `docker build` programmatically, injecting configured Environment Variables.
4. **Blue-Green Deployment (Zero Downtime):** 
   * Start the NEW container on a random available port.
   * Verify it is running by awaiting a successful health check or container status.
   * Update the `Caddyfile` to route the domain (e.g., `project.localhost`, custom domains, or a Cloudflare Tunnel URL) to the new port.
   * Reload Caddy (`caddy reload`).
   * Stop and gracefully remove the OLD container.

## 5. Maintenance / Resource Management
* Implement a daily Cron job (using `node-cron`) that runs the equivalent of `docker system prune -af --volumes` at 3:00 AM to clear dangling images and prevent the laptop's hard drive from filling up.
* Keep a maximum of 3 recent deployments per project in Docker for rollback purposes, pruning older containers.

# RULES & CONSTRAINTS:
* **No external databases.** Use a local `data.sqlite` file.
* **No concurrent builds.** The old laptop will freeze. Strictly enforce the build queue.
* Assume the user will set up Cloudflare Tunnels (`cloudflared`) independently to route public traffic to the Caddy proxy. Your script only needs to route traffic internally via Caddy using generated virtual hosts.
* Ensure the developer experience (DX) is as close to Vercel as possible—commands should be intuitive, and deployments should feel "magical" without manual Dockerfile creation from the user.
* Provide clean, well-architected, and heavily commented code.
* Output the project structure first, then provide the code for `package.json`, `cli.ts`, `daemon.ts`, `docker.ts`, and `db.ts`.