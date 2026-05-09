# Mini-Vercel Project Pipeline

This document breaks down the development of the "Mini-Vercel" PaaS into manageable stages, moving from a basic foundation to a fully-featured, production-ready system.

## Stage 1: Foundation & Core CLI
**Goal:** Set up the project structure, database, and basic CLI commands.
* Initialize a Node.js project with TypeScript.
* Set up SQLite3 and design the database schema (tables for `projects`, `deployments`, `env_vars`, `users`).
* Create the CLI skeleton using `commander` or `yargs`.
* Implement `mini-vercel start-daemon`: Starts a barebones background Express server.
* Implement `mini-vercel login`: Generates and stores a local auth token to communicate with the daemon.
* Implement `mini-vercel link`: Registers the current working directory as a project in the SQLite database.

## Stage 2: Basic Deployment Engine
**Goal:** Get a manual, basic Docker deployment working locally.
* Integrate `dockerode` to communicate with the local Docker daemon.
* Implement manual `mini-vercel deploy`:
  * Assumes a `Dockerfile` already exists in the project.
  * Builds the Docker image.
  * Starts the container on a random available port.
* Set up Caddy locally and implement dynamic `Caddyfile` generation to route `project.localhost` to the container's port.
* Reload Caddy programmatically (`caddy reload`).
* Implement `mini-vercel list` to show the active projects and their local URLs.

## Stage 3: Zero-Config & Blue-Green Deployments
**Goal:** Make deployments feel "magical" without manual Dockerfiles, and ensure zero-downtime updates.
* Implement **Zero-Config Framework Detection**: Parse `package.json` to detect Next.js, Vite, Create React App, or Express.
* Dynamically generate optimized `Dockerfile`s based on the detected framework.
* Add support for `minivercel.json` to allow users to override build commands and output directories.
* Implement **Blue-Green Deployments**:
  * During a new deployment, start the NEW container while the OLD one is still serving traffic.
  * Once the NEW container is healthy, update the `Caddyfile`.
  * Reload Caddy.
  * Gracefully shut down and remove the OLD container.

## Stage 4: Continuous Delivery (Webhooks & Queue)
**Goal:** Automate deployments via GitHub pushes while protecting the host machine.
* Create the `POST /webhooks/github` Express endpoint on the daemon.
* Implement HMAC SHA-256 signature validation to secure the webhook.
* Add API Rate Limiting (`express-rate-limit`) to prevent spam/DDoS.
* Implement a strict **FIFO Queue** (`p-queue`):
  * When a webhook fires for the `main` branch, add the job to the queue.
  * Ensure the queue processes **strictly one build at a time** to prevent the older laptop from crashing.
* Have the queue job automatically clone the repo into a temp directory and trigger the Deployment Engine.

## Stage 5: Environment Variables & Logs
**Goal:** Provide essential PaaS features for configuration and debugging.
* Implement `mini-vercel env add`, `env rm`, and `env pull` to store secrets securely in SQLite.
* Update the Deployment Engine to inject these stored environment variables into the `docker build` process (as build args) and at runtime.
* Implement `mini-vercel logs [-f] <project-name>`:
  * Connect to the Docker daemon and fetch the last 100 lines of logs.
  * Support the `-f` flag to stream logs continuously to the terminal.

## Stage 6: Advanced Vercel-like Features
**Goal:** Polish the system with advanced PaaS capabilities.
* **Custom Domains:** Implement `mini-vercel domain add <project-name> <domain>`. Update the Caddyfile logic to route the custom domain alongside the local URL.
* **Preview Deployments:** 
  * Update the GitHub webhook handler to listen for Pull Request events.
  * Deploy the PR branch to a temporary URL (e.g., `pr-12.project.localhost`).
  * Listen for PR close/merge events to automatically destroy the preview container and clean up Caddy.
* **Rollbacks:** 
  * Modify the deployment engine to retain the last 3 successful containers (instead of deleting them immediately).
  * Implement `mini-vercel rollback <project-name> <deployment-id>` to instantly switch the Caddy route back to a previous container.
* **Automated Maintenance:** Implement a `node-cron` job that runs at 3:00 AM daily to execute `docker system prune -af --volumes` to prevent the laptop's hard drive from filling up.
