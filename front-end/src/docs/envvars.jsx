export default function EnvVars() {
  return (
    <>
      <div className="d-tag">Env Variables</div>
      <h1 className="d-h1">Environment Variables</h1>
      <p className="d-lead">
        Orbit stores per-project environment variables in SQLite and injects them into each container at deploy time. Values are never baked into the Docker image.
      </p>

      <h2 className="d-h2">Adding variables</h2>
      <pre className="d-pre" data-lang="bash">{`cd my-project
orbit env add DATABASE_URL postgres://localhost:5432/mydb
# Set DATABASE_URL on "my-app".

orbit env add API_KEY supersecretkey
# Set API_KEY on "my-app".`}</pre>
      <p className="d-p">
        Variables are stored per project in the <span className="d-inline">env_vars</span> table of <span className="d-inline">data.sqlite</span>. The key is unique per project — running <span className="d-inline">orbit env add</span> on an existing key <strong>updates</strong> the value (upsert).
      </p>

      <h2 className="d-h2">Removing variables</h2>
      <pre className="d-pre" data-lang="bash">{`orbit env rm API_KEY
# Removed API_KEY from "my-app".`}</pre>

      <h2 className="d-h2">Pulling to a .env file</h2>
      <pre className="d-pre" data-lang="bash">{`orbit env pull
# Wrote 2 variable(s) to .env`}</pre>
      <p className="d-p">
        This writes all stored variables for the linked project to a <span className="d-inline">.env</span> file in the current directory, in <span className="d-inline">KEY=VALUE</span> format. Useful for local development when you need the same vars outside Docker.
      </p>
      <div className="d-callout warn">
        <strong>Warning:</strong> Add <span className="d-inline">.env</span> to your <span className="d-inline">.gitignore</span>. Never commit secrets to source control.
      </div>

      <h2 className="d-h2">How variables are injected</h2>
      <p className="d-p">
        At deploy time, Orbit reads all stored vars for the project from SQLite and passes them as <strong>Docker container environment variables</strong> (the <span className="d-inline">Env</span> field of the container config). They are visible inside the container as standard environment variables — accessible via <span className="d-inline">process.env.KEY</span> in Node.js, <span className="d-inline">os.environ["KEY"]</span> in Python, etc.
      </p>
      <div className="d-callout">
        <strong>Note:</strong> Variables stored after a deploy won't be available until the next <span className="d-inline">orbit deploy</span>. Variables are not hot-reloaded.
      </div>

      <h2 className="d-h2">Authentication requirement</h2>
      <p className="d-p">
        All env commands require you to be logged in. The project is resolved by the current working directory path, scoped to your user — you can only manage variables for projects you own.
      </p>

      <h2 className="d-h2">Storage details</h2>
      <p className="d-p">Variables are stored in the <span className="d-inline">env_vars</span> table:</p>
      <pre className="d-pre" data-lang="sql">{`CREATE TABLE env_vars (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  is_secret  INTEGER DEFAULT 0,
  UNIQUE(project_id, key)
);`}</pre>
      <p className="d-p">
        Values are stored in plain text. If you need additional encryption at rest, consider using an encrypted SQLite extension or mounting an encrypted filesystem. The <span className="d-inline">is_secret</span> column is reserved for a future UI that masks values in displays.
      </p>

      <h2 className="d-h2">Workflow example</h2>
      <pre className="d-pre" data-lang="bash">{`# 1. Add secrets before deploying
orbit env add DATABASE_URL "postgres://user:pass@host:5432/db"
orbit env add JWT_SECRET "my-jwt-signing-secret"
orbit env add NODE_ENV "production"

# 2. Deploy — variables are injected automatically
orbit deploy
# Deployment enqueued...

# 3. Your app reads them normally
# process.env.DATABASE_URL → "postgres://user:pass@host:5432/db"

# 4. Later — pull to a local .env for debugging
orbit env pull
# Wrote 3 variable(s) to .env`}</pre>
    </>
  );
}
