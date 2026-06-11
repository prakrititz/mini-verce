function CmdCard({ name, args, desc, example, options }) {
  return (
    <div className="d-cmd-card">
      <div className="d-cmd-header">
        <span className="d-cmd-name">orbit {name}</span>
        {args && <span className="d-cmd-args">{args}</span>}
      </div>
      <div className="d-cmd-body">
        <p style={{ marginBottom: example || options ? "0.8rem" : 0 }}>{desc}</p>
        {options && (
          <ul style={{ paddingLeft: "1.2rem", color: "var(--off)", fontSize: "0.76rem", lineHeight: 1.8 }}>
            {options.map(([flag, d]) => (
              <li key={flag}><span style={{ color: "var(--purple)" }}>{flag}</span> — {d}</li>
            ))}
          </ul>
        )}
        {example && (
          <pre style={{
            background: "rgba(0,0,0,0.5)", padding: "0.7rem 1rem",
            fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "#c8e6ff",
            lineHeight: 1.85, marginTop: options ? "0.8rem" : 0, overflowX: "auto",
            whiteSpace: "pre",
          }}>{example}</pre>
        )}
      </div>
    </div>
  );
}

export default function Commands() {
  return (
    <>
      <div className="d-tag">Reference</div>
      <h1 className="d-h1">CLI Reference</h1>
      <p className="d-lead">
        Complete reference for all <span className="d-inline">orbit</span> commands. The daemon must be running (<span className="d-inline">orbit start-daemon</span>) for most commands to work, and you must be logged in (<span className="d-inline">orbit signup</span> or <span className="d-inline">orbit login</span>).
      </p>

      <h2 className="d-h2">Daemon & Setup</h2>

      <CmdCard
        name="start-daemon"
        desc="Spawns the background Express control plane on port 4000 and ensures the Caddy Docker container is running. Run once — it detaches and stays alive."
        example={`orbit start-daemon\n# Starting daemon...\n# Daemon started in background.\n# Ensuring Caddy is running...\n# Caddy is ready.`}
      />

      <h2 className="d-h2">Identity</h2>

      <CmdCard
        name="signup"
        desc="Creates a new local account. Email and password are validated; password is hashed with bcrypt (12 rounds). A 30-day session token is saved to ~/.orbit-auth.json."
        example={`orbit signup\n# Email: dev@example.com\n# Password: ****\n# Account created. Logged in as dev@example.com.`}
      />

      <CmdCard
        name="login"
        desc="Authenticates with an existing account, refreshes the session token in ~/.orbit-auth.json."
        example={`orbit login\n# Email: dev@example.com\n# Password: ****\n# Logged in as dev@example.com.`}
      />

      <CmdCard
        name="logout"
        desc="Destroys the current session server-side and deletes ~/.orbit-auth.json."
        example={`orbit logout\n# Logged out.`}
      />

      <CmdCard
        name="whoami"
        desc="Prints the currently logged-in email and user ID."
        example={`orbit whoami\n# Logged in as: dev@example.com  (userId: xxxxxxxx-xxxx-...)`}
      />

      <h2 className="d-h2">GitHub</h2>

      <CmdCard
        name="github connect"
        desc="Links your GitHub account via a Personal Access Token. The PAT is validated against the GitHub API, then encrypted with AES-256-CBC and stored in SQLite. Required PAT scopes: repo, admin:repo_hook."
        example={`orbit github connect\n# Paste your GitHub Personal Access Token: ****\n# ✓ Connected as @your-github-username`}
      />

      <CmdCard
        name="github status"
        desc="Shows whether a GitHub account is currently linked for your user."
        example={`orbit github status\n# GitHub connected: @your-github-username`}
      />

      <CmdCard
        name="github disconnect"
        desc="Removes the stored GitHub PAT and username from the database."
        example={`orbit github disconnect\n# GitHub account disconnected.`}
      />

      <CmdCard
        name="github oauth"
        desc="Alternative OAuth flow (requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET set in back-end/.env). Opens the GitHub authorization page in your browser and polls for completion."
        example={`orbit github oauth\n# Opening GitHub authorization page in your browser...\n# Waiting for authorization (timeout: 5 minutes)...\n# ✓ Connected as @your-github-username`}
      />

      <h2 className="d-h2">Projects</h2>

      <CmdCard
        name="import"
        args="[-n name]"
        desc="Interactively lists your GitHub repositories (up to 100, sorted by last updated). Select one — Orbit creates the project record and auto-registers the GitHub webhook."
        options={[
          ["-n, --name <name>", "Override the project name (defaults to the repo name)"],
        ]}
        example={`orbit import\n# ? Select a repository: your-username/my-app (main)\n# ? Project name: my-app\n# ✓ Project "my-app" linked.\n#   Webhook: registered`}
      />

      <CmdCard
        name="link"
        args="[-n name] [-r repo]"
        desc="Registers the current working directory as a project without GitHub interaction. Useful for local-only projects."
        options={[
          ["-n, --name <name>", "Project name (defaults to folder name)"],
          ["-r, --repo <repo>",  "GitHub repository URL"],
        ]}
        example={`cd my-project\norbit link -n my-project\n# Project "my-project" linked.`}
      />

      <CmdCard
        name="deploy"
        desc="Triggers a production build and deployment for the current directory. Orbit detects your stack, writes a Dockerfile if missing, builds the Docker image, starts a new container on a random free port, and performs a zero-downtime Caddy reload."
        example={`cd my-project\norbit deploy\n# Deployment enqueued (buildId: ...)\n# Watch logs: orbit logs`}
      />

      <CmdCard
        name="list"
        desc="Prints a formatted table of all projects owned by your account, their deployment status, and their local URLs."
        example={`orbit list\n# ┌──────────────────────────────────────────────────────┐\n# │ Project   Status    URL                             │\n# ├──────────────────────────────────────────────────────┤\n# │ my-app    running   http://my-app.localhost:8080    │\n# └──────────────────────────────────────────────────────┘`}
      />

      <CmdCard
        name="rollback"
        desc="Rolls back to the most recent stopped (previously running) deployment for the current project. Caddy is reloaded automatically."
        example={`orbit rollback\n# Rollback complete.\n# Restored deployment from: 2025-11-12T10:34:22.000Z`}
      />

      <h2 className="d-h2">Logs</h2>

      <CmdCard
        name="logs"
        args="[project-name] [-f]"
        desc="Prints recent stdout/stderr from the running container. Optionally stream live output with -f."
        options={[
          ["-f, --follow", "Stream live log output continuously"],
        ]}
        example={`orbit logs\norbit logs my-app -f`}
      />

      <h2 className="d-h2">Environment Variables</h2>

      <CmdCard
        name="env add"
        args="<key> <value>"
        desc="Stores an environment variable for the linked project in SQLite. Variables are injected into the container at next deploy."
        example={`orbit env add DATABASE_URL postgres://localhost:5432/mydb\n# Set DATABASE_URL on "my-app".`}
      />

      <CmdCard
        name="env rm"
        args="<key>"
        desc="Removes a stored environment variable."
        example={`orbit env rm DATABASE_URL\n# Removed DATABASE_URL from "my-app".`}
      />

      <CmdCard
        name="env pull"
        desc="Writes all stored environment variables for the linked project to a local .env file."
        example={`orbit env pull\n# Wrote 3 variable(s) to .env`}
      />

      <h2 className="d-h2">Domains</h2>

      <CmdCard
        name="domain add"
        args="<domain>"
        desc="Sets a custom domain for the current project. Caddy is reloaded to apply the new routing rule."
        example={`orbit domain add myapp.example.com\n# Custom domain "myapp.example.com" set on "my-app".`}
      />

      <CmdCard
        name="domain rm"
        desc="Removes the custom domain from the current project."
        example={`orbit domain rm\n# Custom domain removed from "my-app".`}
      />

      <h2 className="d-h2">Caddy TLS</h2>

      <CmdCard
        name="caddy trust"
        desc="Installs the Caddy local CA into your system trust store. Run once after first orbit start-daemon in local mode. After this, HTTPS works in the browser at *.localhost."
        example={`orbit caddy trust\n# ✓ Local CA trusted successfully.`}
      />

      <CmdCard
        name="caddy mode"
        desc="Shows the current Caddy TLS mode (local = tls internal, public = Let's Encrypt), and which ports are in use."
        example={`orbit caddy mode\n# Mode:        local\n# Description: Caddy local CA — tls internal\n# HTTP port:   80\n# HTTPS port:  443`}
      />
    </>
  );
}
