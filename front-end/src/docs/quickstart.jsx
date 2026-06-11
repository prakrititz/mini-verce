export default function Quickstart() {
  return (
    <>
      <div className="d-tag">Getting started</div>
      <h1 className="d-h1">Quickstart</h1>
      <p className="d-lead">
        Get Orbit running on your machine and deploy your first project in under five minutes.
        You need Node.js ≥ 18 and Docker Desktop (or Docker Engine on Linux).
      </p>

      <h2 className="d-h2">Prerequisites</h2>
      <p className="d-p"><strong>Node.js ≥ 18</strong> — check with <span className="d-inline">node -v</span>.</p>
      <p className="d-p"><strong>Docker</strong> — the Docker daemon must be running before you use Orbit. On Windows/macOS, start Docker Desktop. On Linux, run <span className="d-inline">sudo systemctl start docker</span>.</p>

      <div className="d-callout">
        <strong>Note:</strong> Orbit uses Docker to containerise every project. Without it, the deploy and start-daemon commands will fail.
      </div>

      <hr className="d-divider" />

      <h2 className="d-h2">Installation</h2>
      <p className="d-h3">1 — Clone and install</p>
      <pre className="d-pre" data-lang="bash">{`git clone https://github.com/you/orbit
cd orbit
npm install`}</pre>

      <p className="d-h3">2 — Build the TypeScript source</p>
      <pre className="d-pre" data-lang="bash">{`npm run build`}</pre>
      <p className="d-p">This compiles <span className="d-inline">src/</span> into <span className="d-inline">dist/</span> using <span className="d-inline">tsc</span>.</p>

      <p className="d-h3">3 — Link the CLI globally</p>
      <pre className="d-pre" data-lang="bash">{`npm link`}</pre>
      <p className="d-p">The <span className="d-inline">orbit</span> binary is now available everywhere in your terminal. Verify with:</p>
      <pre className="d-pre" data-lang="bash">{`orbit --version
# 2.0.0`}</pre>

      <hr className="d-divider" />

      <h2 className="d-h2">Deploying your first project</h2>

      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">1</div>
          <div className="d-step-body">
            <div className="d-step-title">Start the daemon</div>
            <div className="d-step-desc">Runs the control plane (Express on port 4000) and starts the Caddy Docker container.</div>
          </div>
        </li>
      </ul>
      <pre className="d-pre" data-lang="bash">{`orbit start-daemon
# Starting daemon...
# Daemon started in background.
# Ensuring Caddy is running...
# Caddy is ready.`}</pre>

      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">2</div>
          <div className="d-step-body">
            <div className="d-step-title">Create an account</div>
            <div className="d-step-desc">Your credentials are stored locally in SQLite with bcrypt hashing. A session token is saved to <span className="d-inline">~/.orbit-auth.json</span>.</div>
          </div>
        </li>
      </ul>
      <pre className="d-pre" data-lang="bash">{`orbit signup
# Email: dev@example.com
# Password: ****
# Confirm password: ****
# Account created. Logged in as dev@example.com.`}</pre>

      <div className="d-callout ok">
        <strong>Already have an account?</strong> Run <span className="d-inline">orbit login</span> instead.
      </div>

      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">3</div>
          <div className="d-step-body">
            <div className="d-step-title">Connect your GitHub account</div>
            <div className="d-step-desc">Orbit encrypts your PAT with AES-256 and stores it in SQLite. Required scopes: <span className="d-inline">repo</span>, <span className="d-inline">admin:repo_hook</span>.</div>
          </div>
        </li>
      </ul>
      <pre className="d-pre" data-lang="bash">{`orbit github connect
# Create a PAT at: https://github.com/settings/tokens/new
# Required scopes: repo, admin:repo_hook
#
# Paste your GitHub Personal Access Token: ****
# ✓ Connected as @your-github-username`}</pre>

      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">4</div>
          <div className="d-step-body">
            <div className="d-step-title">Import a GitHub repository</div>
            <div className="d-step-desc">Orbit lists all your repos (up to 100, sorted by last updated). Pick one — Orbit creates the project record and auto-registers the webhook.</div>
          </div>
        </li>
      </ul>
      <pre className="d-pre" data-lang="bash">{`orbit import
# Fetching your GitHub repositories...
# ? Select a repository to link:
#   ❯ your-username/my-app (main)
#     your-username/other-repo (main)
# ? Project name: my-app
#
# ✓ Project "my-app" linked.
#   Repo:    https://github.com/your-username/my-app
#   Webhook: registered`}</pre>

      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">5</div>
          <div className="d-step-body">
            <div className="d-step-title">Deploy</div>
            <div className="d-step-desc">Orbit detects your stack, generates a Dockerfile if needed, builds the Docker image, and routes it through Caddy. Zero-downtime.</div>
          </div>
        </li>
      </ul>
      <pre className="d-pre" data-lang="bash">{`cd path/to/my-app
orbit deploy
# Deployment enqueued (buildId: ...)
# Watch logs: orbit logs`}</pre>

      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">6</div>
          <div className="d-step-body">
            <div className="d-step-title">Check status and get your URL</div>
            <div className="d-step-desc">Your app is served via Caddy at the local domain shown below.</div>
          </div>
        </li>
      </ul>
      <pre className="d-pre" data-lang="bash">{`orbit list
# ┌─────────────────────────────────────────────────────┐
# │ Project   Status    URL                              │
# ├─────────────────────────────────────────────────────┤
# │ my-app    running   http://my-app.localhost:8080     │
# └─────────────────────────────────────────────────────┘`}</pre>

      <div className="d-callout ok">
        <strong>HTTPS locally?</strong> Run <span className="d-inline">orbit caddy trust</span> once to install the local CA, then visit <span className="d-inline">https://my-app.localhost</span>.
      </div>

      <hr className="d-divider" />

      <h2 className="d-h2">Continuous delivery</h2>
      <p className="d-p">
        After <span className="d-inline">orbit import</span>, every <span className="d-inline">git push</span> to the default branch triggers a new deployment automatically — no manual <span className="d-inline">orbit deploy</span> needed. The daemon picks up the GitHub webhook and enqueues the build.
      </p>

      <hr className="d-divider" />

      <h2 className="d-h2">Next steps</h2>
      <p className="d-p">
        Now that you're up and running, explore the rest of the docs:
      </p>
      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">→</div>
          <div className="d-step-body">
            <div className="d-step-title"><a href="/docs/commands" style={{color:"var(--purple)", textDecoration:"none"}}>CLI Reference</a></div>
            <div className="d-step-desc">Full reference for every orbit command.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">→</div>
          <div className="d-step-body">
            <div className="d-step-title"><a href="/docs/envvars" style={{color:"var(--purple)", textDecoration:"none"}}>Environment Variables</a></div>
            <div className="d-step-desc">Store secrets safely in SQLite and inject them at deploy time.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">→</div>
          <div className="d-step-body">
            <div className="d-step-title"><a href="/docs/networking" style={{color:"var(--purple)", textDecoration:"none"}}>Networking & TLS</a></div>
            <div className="d-step-desc">HTTPS, custom domains, and Caddy configuration.</div>
          </div>
        </li>
      </ul>
    </>
  );
}
