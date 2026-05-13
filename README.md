# Mini-Vercel (Self-Hosted PaaS)

Mini-Vercel is an open-source, self-hosted Platform-as-a-Service (PaaS) designed to emulate the developer experience of Vercel. It is built to run efficiently on resource-constrained hardware (like an older laptop) while providing magical, zero-downtime deployments.

## Architecture & Tech Stack

- **CLI & Daemon**: Built with Node.js and TypeScript.
- **Containerization**: `dockerode` programmatically builds and manages Docker containers.
- **Reverse Proxy**: Caddy runs inside a Docker container, providing automatic, zero-downtime routing via a dynamically generated `Caddyfile`.
- **Database**: SQLite3 (`data.sqlite`) is used to locally store project metadata, environments, and deployment history.

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

### `mini-vercel list`
Queries the database and prints a formatted table of all active projects, their statuses, and their local URLs.

---

## Project Roadmap

This project is being built in stages:
- [x] **Stage 1: Foundation & Core CLI** (SQLite, Base CLI commands)
- [x] **Stage 2: Basic Deployment Engine** (Dockerode integration, Caddy proxy container)
- [x] **Stage 3: Zero-Config Framework Detection** (Auto-generating Dockerfiles for Next.js, Vite, Node)
- [ ] **Stage 4: Continuous Delivery** (GitHub Webhooks & FIFO Build Queue)
- [ ] **Stage 5: Environment Variables & Logs** (Managing secrets)
- [ ] **Stage 6: Advanced PaaS Features** (Rollbacks, PR Previews, Custom Domains)
