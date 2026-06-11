export default function Networking() {
  return (
    <>
      <div className="d-tag">Networking & TLS</div>
      <h1 className="d-h1">Networking & TLS</h1>
      <p className="d-lead">
        Orbit uses <strong>Caddy</strong> as its built-in reverse proxy, running inside a Docker container. It maps every deployed project to a <span className="d-inline">*.localhost</span> domain and handles TLS automatically — no manual certificate management needed.
      </p>

      <h2 className="d-h2">How Caddy is started</h2>
      <p className="d-p">
        When you run <span className="d-inline">orbit start-daemon</span>, Orbit checks for a running Caddy container and starts one if needed. The container is configured with a dynamically generated <span className="d-inline">Caddyfile</span> stored at the project root.
      </p>
      <pre className="d-pre" data-lang="bash">{`orbit start-daemon
# Ensuring Caddy is running...
# Caddy is ready.`}</pre>

      <h2 className="d-h2">URL scheme</h2>
      <p className="d-p">Every project is served at:</p>
      <pre className="d-pre" data-lang="">{`http://  <project-name>.localhost:8080   ← HTTP (default)
https:// <project-name>.localhost        ← HTTPS (after caddy trust)`}</pre>
      <p className="d-p">
        The project name comes from the name you gave at <span className="d-inline">orbit link</span> or <span className="d-inline">orbit import</span>. Orbit rewrites the Caddyfile and reloads Caddy on every deployment without dropping traffic.
      </p>

      <h2 className="d-h2">TLS modes</h2>

      <h3 className="d-h3">Local mode (default)</h3>
      <p className="d-p">
        Caddy uses its built-in CA to issue certificates for <span className="d-inline">*.localhost</span> (<span className="d-inline">tls internal</span>). Browsers won't trust these by default — run the trust command once:
      </p>
      <pre className="d-pre" data-lang="bash">{`orbit caddy trust
# ✓ Local CA trusted successfully.`}</pre>
      <p className="d-p">
        After this, <span className="d-inline">https://my-app.localhost</span> works in Chrome, Firefox, and Safari without warnings. The CA is installed into your system/browser trust store.
      </p>

      <h3 className="d-h3">Public mode (Let's Encrypt)</h3>
      <p className="d-p">
        Set <span className="d-inline">CADDY_MODE=public</span> in <span className="d-inline">back-end/.env</span> for production deployments on a real domain. Caddy will automatically provision a Let's Encrypt certificate — your machine must be reachable on ports 80 and 443.
      </p>
      <pre className="d-pre" data-lang=".env">{`CADDY_MODE=public
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443`}</pre>

      <h3 className="d-h3">Check current mode</h3>
      <pre className="d-pre" data-lang="bash">{`orbit caddy mode
# Mode:        local
# Description: Caddy local CA — tls internal
# HTTP port:   80
# HTTPS port:  443
#
# Tip: run "orbit caddy trust" once to install the local CA.`}</pre>

      <h2 className="d-h2">Custom domains</h2>
      <p className="d-p">
        Point any domain at your machine's IP and add it to the project:
      </p>
      <pre className="d-pre" data-lang="bash">{`orbit domain add myapp.example.com
# Custom domain "myapp.example.com" set on "my-app".`}</pre>
      <p className="d-p">
        Orbit writes the new domain to the Caddyfile entry for your project and reloads Caddy. In public mode, Caddy will automatically fetch a Let's Encrypt certificate.
      </p>
      <pre className="d-pre" data-lang="bash">{`orbit domain rm
# Custom domain removed from "my-app".`}</pre>

      <div className="d-callout warn">
        <strong>DNS:</strong> You must create an A record pointing your domain to your machine's public IP before Caddy can issue a Let's Encrypt certificate. Custom domains only work in public Caddy mode.
      </div>

      <h2 className="d-h2">Port management</h2>
      <p className="d-p">
        Each container runs on a <strong>random free host port</strong> chosen by <span className="d-inline">get-port</span> at deploy time. Caddy proxies from the named domain to this internal port. You never need to manage ports manually.
      </p>
      <pre className="d-pre" data-lang="">{`my-app.localhost:8080  →  Caddy  →  container:random-port`}</pre>
      <p className="d-p">
        When a new deployment replaces an old one, the old container is stopped (and its port freed) only after Caddy has reloaded with the new upstream — guaranteeing zero downtime.
      </p>

      <h2 className="d-h2">Exposing to the internet</h2>
      <p className="d-p">
        For a quick public tunnel (e.g. to receive GitHub webhooks during development), use <strong>ngrok</strong>:
      </p>
      <pre className="d-pre" data-lang="bash">{`ngrok http 8080
# Forwarding  https://xxxx.ngrok-free.app  →  localhost:8080`}</pre>
      <p className="d-p">Set <span className="d-inline">PUBLIC_URL</span> in your <span className="d-inline">.env</span> so Orbit registers the correct webhook URL:</p>
      <pre className="d-pre" data-lang=".env">{`PUBLIC_URL=https://xxxx.ngrok-free.app`}</pre>

      <h2 className="d-h2">Environment variables</h2>
      <pre className="d-pre" data-lang=".env">{`DAEMON_PORT=4000          # Port the control plane listens on (default: 4000)
CADDY_MODE=local          # "local" or "public"
CADDY_HTTP_PORT=80        # HTTP port Caddy binds (default: 80)
CADDY_HTTPS_PORT=443      # HTTPS port Caddy binds (default: 443)
PUBLIC_URL=               # Public URL for webhook registration (optional)`}</pre>
    </>
  );
}
