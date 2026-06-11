export default function Github() {
  return (
    <>
      <div className="d-tag">GitHub</div>
      <h1 className="d-h1">GitHub Integration</h1>
      <p className="d-lead">
        Orbit integrates with GitHub via a Personal Access Token (PAT) to list repositories, auto-register webhooks, and trigger deployments on every push — all from the CLI.
      </p>

      <h2 className="d-h2">Creating a Personal Access Token</h2>
      <p className="d-p">Go to <strong>GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)</strong> and create a new token with the following scopes:</p>
      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">✓</div>
          <div className="d-step-body">
            <div className="d-step-title">repo</div>
            <div className="d-step-desc">Full control of private repositories — needed to clone and list repos.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">✓</div>
          <div className="d-step-body">
            <div className="d-step-title">admin:repo_hook</div>
            <div className="d-step-desc">Read and write repository hooks — needed to auto-register webhooks.</div>
          </div>
        </li>
      </ul>
      <div className="d-callout warn">
        <strong>Warning:</strong> Treat your PAT like a password. Orbit stores it AES-256 encrypted, but you should still use a token with the minimum required scopes and rotate it periodically.
      </div>

      <h2 className="d-h2">Connecting your account</h2>
      <pre className="d-pre" data-lang="bash">{`orbit github connect
# Create a PAT at: https://github.com/settings/tokens/new
# Required scopes: repo, admin:repo_hook
#
# Paste your GitHub Personal Access Token: ****
# ✓ Connected as @your-github-username`}</pre>
      <p className="d-p">
        Orbit calls the GitHub API (<span className="d-inline">GET /user</span>) to validate the PAT and retrieve your username. The token is then encrypted with <strong>AES-256-CBC</strong> using a key derived from your <span className="d-inline">WEBHOOK_SECRET</span> (set in <span className="d-inline">back-end/.env</span>) and stored in SQLite. It is never stored in plain text.
      </p>

      <h2 className="d-h2">Importing a repository</h2>
      <pre className="d-pre" data-lang="bash">{`orbit import
# Fetching your GitHub repositories...
# ? Select a repository to link:
#   ❯ your-username/my-app (main)       ← press Enter
#     your-username/other-repo (main)
# ? Project name: my-app
#
# Linking "my-app" → your-username/my-app...
# ✓ Project "my-app" linked.
#   Repo:    https://github.com/your-username/my-app
#   Webhook: registered`}</pre>
      <p className="d-p">
        <span className="d-inline">orbit import</span> fetches up to <strong>100 repositories</strong> (sorted by last updated) that your PAT has push access to. After you confirm the project name, Orbit:
      </p>
      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">1</div>
          <div className="d-step-body">
            <div className="d-step-title">Creates the project record in SQLite</div>
            <div className="d-step-desc">Stores name, local path, repo URL, and your user ID as owner.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">2</div>
          <div className="d-step-body">
            <div className="d-step-title">Registers a webhook on GitHub</div>
            <div className="d-step-desc">
              Posts to <span className="d-inline">POST /repos/{"{owner}"}/{"{repo}"}/hooks</span> with events <span className="d-inline">push</span> and <span className="d-inline">pull_request</span>.
              If a webhook already exists (HTTP 422), it is treated as success.
            </div>
          </div>
        </li>
      </ul>

      <h2 className="d-h2">Webhook URL configuration</h2>
      <p className="d-p">The webhook URL defaults to:</p>
      <pre className="d-pre" data-lang="">{`http://localhost:4000/webhooks/github`}</pre>
      <p className="d-p">
        This only works if your machine is publicly reachable from GitHub (e.g. via <strong>ngrok</strong> or a VPS). Set <span className="d-inline">PUBLIC_URL</span> in <span className="d-inline">back-end/.env</span> to override:
      </p>
      <pre className="d-pre" data-lang=".env">{`PUBLIC_URL=https://xxxx.ngrok-free.app`}</pre>

      <h2 className="d-h2">WEBHOOK_SECRET</h2>
      <p className="d-p">Orbit uses HMAC-SHA256 to validate every incoming webhook payload. Set a strong secret in <span className="d-inline">back-end/.env</span>:</p>
      <pre className="d-pre" data-lang=".env">{`WEBHOOK_SECRET=your-random-secret-here`}</pre>
      <div className="d-callout">
        <strong>Note:</strong> This same secret is used to derive the AES encryption key for your PAT. Changing it after storing a PAT will break decryption — you'll need to <span className="d-inline">orbit github disconnect</span> and <span className="d-inline">orbit github connect</span> again.
      </div>

      <h2 className="d-h2">How push deployments work</h2>
      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">1</div>
          <div className="d-step-body">
            <div className="d-step-title">You push to GitHub</div>
            <div className="d-step-desc">GitHub sends a POST to your webhook URL with <span className="d-inline">X-Hub-Signature-256</span> for HMAC validation.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">2</div>
          <div className="d-step-body">
            <div className="d-step-title">Orbit validates and enqueues</div>
            <div className="d-step-desc">The daemon verifies the signature, looks up the project by repo clone URL, and adds it to the FIFO build queue.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">3</div>
          <div className="d-step-body">
            <div className="d-step-title">Deploy runs</div>
            <div className="d-step-desc">Same pipeline as <span className="d-inline">orbit deploy</span> — auto-detect stack, build Docker image, zero-downtime Caddy swap.</div>
          </div>
        </li>
      </ul>

      <h2 className="d-h2">OAuth (alternative)</h2>
      <p className="d-p">
        If you'd prefer OAuth over a PAT, set up a GitHub OAuth App and configure:
      </p>
      <pre className="d-pre" data-lang=".env">{`GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
GITHUB_CALLBACK_URL=http://localhost:4000/auth/github/callback`}</pre>
      <p className="d-p">Then run:</p>
      <pre className="d-pre" data-lang="bash">{`orbit github oauth
# Opens GitHub authorization in your browser
# Waiting for authorization (timeout: 5 minutes)...
# ✓ Connected as @your-github-username`}</pre>

      <h2 className="d-h2">Checking & disconnecting</h2>
      <pre className="d-pre" data-lang="bash">{`orbit github status
# GitHub connected: @your-github-username

orbit github disconnect
# GitHub account disconnected.`}</pre>
    </>
  );
}
