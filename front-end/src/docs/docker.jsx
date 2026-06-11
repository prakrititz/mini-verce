export default function Docker() {
  return (
    <>
      <div className="d-tag">Docker</div>
      <h1 className="d-h1">Docker & Auto-Dockerfile</h1>
      <p className="d-lead">
        Orbit automatically detects your project's stack and generates an optimised Dockerfile if one doesn't exist. Every deployment builds a fresh Docker image tagged with the project name and a build ID.
      </p>

      <h2 className="d-h2">Stack detection</h2>
      <p className="d-p">
        Before building, Orbit inspects your project directory in this order:
      </p>
      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">1</div>
          <div className="d-step-body">
            <div className="d-step-title">Check for a Dockerfile</div>
            <div className="d-step-desc">If a <span className="d-inline">Dockerfile</span> already exists at the project root, Orbit uses it as-is. No overrides are written.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">2</div>
          <div className="d-step-body">
            <div className="d-step-title">Check minivercel.json</div>
            <div className="d-step-desc">If <span className="d-inline">minivercel.json</span> is present, the <span className="d-inline">buildCommand</span>, <span className="d-inline">installCommand</span>, and <span className="d-inline">outputDirectory</span> fields override auto-detection defaults.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">3</div>
          <div className="d-step-body">
            <div className="d-step-title">Parse package.json dependencies</div>
            <div className="d-step-desc">Orbit reads <span className="d-inline">dependencies</span> and <span className="d-inline">devDependencies</span> to identify Next.js, Vite/CRA, or generic Node.</div>
          </div>
        </li>
      </ul>

      <h2 className="d-h2">Detected frameworks</h2>

      <h3 className="d-h3">Next.js — Standalone output</h3>
      <p className="d-p">
        Detected when <span className="d-inline">next</span> appears in dependencies. Orbit generates a multi-stage Dockerfile using the <strong>Next.js standalone</strong> output (<span className="d-inline">output: 'standalone'</span> in <span className="d-inline">next.config.js</span>):
      </p>
      <pre className="d-pre" data-lang="dockerfile">{`FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]`}</pre>

      <h3 className="d-h3">Vite / Create React App — nginx</h3>
      <p className="d-p">
        Detected when <span className="d-inline">vite</span> or <span className="d-inline">react-scripts</span> is found. Orbit builds with npm and serves the static output via nginx:
      </p>
      <pre className="d-pre" data-lang="dockerfile">{`FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]`}</pre>

      <h3 className="d-h3">Generic Node.js</h3>
      <p className="d-p">
        All other Node projects. Uses the <span className="d-inline">start</span> script from <span className="d-inline">package.json</span>:
      </p>
      <pre className="d-pre" data-lang="dockerfile">{`FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]`}</pre>

      <h2 className="d-h2">minivercel.json overrides</h2>
      <p className="d-p">
        Place a <span className="d-inline">minivercel.json</span> file in your project root to override auto-detection:
      </p>
      <pre className="d-pre" data-lang="json">{`{
  "buildCommand": "npm run build:prod",
  "installCommand": "npm ci --ignore-scripts",
  "outputDirectory": "build"
}`}</pre>
      <p className="d-p">All three fields are optional. Only the fields you specify are overridden.</p>

      <h2 className="d-h2">Build process</h2>
      <ul className="d-steps">
        <li className="d-step-item">
          <div className="d-step-n">1</div>
          <div className="d-step-body">
            <div className="d-step-title">Tar the project directory</div>
            <div className="d-step-desc">Orbit creates a tar stream of your project folder (respecting <span className="d-inline">.dockerignore</span> if present) and streams it to the Docker daemon.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">2</div>
          <div className="d-step-body">
            <div className="d-step-title">docker build</div>
            <div className="d-step-desc">The image is built via <span className="d-inline">dockerode</span>. The tag is <span className="d-inline">{"{project-name}:{buildId}"}</span>.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">3</div>
          <div className="d-step-body">
            <div className="d-step-title">Random port allocation</div>
            <div className="d-step-desc">Orbit uses <span className="d-inline">get-port</span> to find an available host port and starts the container bound to it.</div>
          </div>
        </li>
        <li className="d-step-item">
          <div className="d-step-n">4</div>
          <div className="d-step-body">
            <div className="d-step-title">Caddy reload</div>
            <div className="d-step-desc">Orbit writes the new upstream to the Caddyfile and issues <span className="d-inline">caddy reload</span>. The old container is stopped only after the new one is serving traffic.</div>
          </div>
        </li>
      </ul>

      <div className="d-callout">
        <strong>Docker layer caching:</strong> Orbit currently builds every image fresh. Once Docker layer caching and BuildKit support land (Phase 9 on the roadmap), incremental deploys will be significantly faster.
      </div>

      <h2 className="d-h2">Environment variables in builds</h2>
      <p className="d-p">
        Variables stored with <span className="d-inline">orbit env add</span> are retrieved from SQLite at deploy time and passed as <strong>Docker environment variables</strong> to the running container. They are not baked into the image layer.
      </p>
      <pre className="d-pre" data-lang="bash">{`orbit env add API_KEY supersecret
orbit deploy   # API_KEY is injected at container start`}</pre>
    </>
  );
}
