import { useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";

const DOCS_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --purple: #e76fff;
    --purple-dim: rgba(186,49,255,0.18);
    --purple-border: rgba(186,49,255,0.2);
    --white: #f0eaf8;
    --off: #b8a8d0;
    --muted: #beff7e;
    --bg: #000010;
    --sidebar-w: 240px;
    --font-display: 'Handjet', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    --font-body: 'Inter', system-ui, sans-serif;
  }
  html { scroll-behavior: smooth; }
  body { background: var(--bg); color: var(--white); font-family: var(--font-body); }

  /* ── Top bar ── */
  .d-topbar {
    position: sticky; top: 0; z-index: 100;
    display: flex; align-items: center; gap: 1.5rem;
    padding: 0.85rem 1.6rem;
    background: rgba(0,0,16,0.85); backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--purple-border);
    font-family: var(--font-mono);
  }
  .d-topbar-logo {
    font-family: var(--font-display); font-size: 1.55rem; font-weight: 158;
    font-variation-settings: "ELGR" 1.2, "ELSH" 2;
    color: var(--white); text-decoration: none; letter-spacing: 0;
  }
  .d-topbar-logo em { color: var(--purple); font-style: normal; }
  .d-topbar-sep { color: rgba(255,255,255,0.15); font-size: 1.1rem; }
  .d-topbar-section { font-size: 0.72rem; color: var(--off); letter-spacing: 0.08em; text-transform: uppercase; }
  .d-topbar-back {
    margin-left: auto; font-size: 0.7rem; color: var(--muted);
    text-decoration: none; letter-spacing: 0.08em; text-transform: uppercase;
    transition: color 0.2s;
  }
  .d-topbar-back:hover { color: var(--white); }

  /* ── Shell ── */
  .d-shell {
    display: grid;
    grid-template-columns: var(--sidebar-w) 1fr;
    min-height: calc(100vh - 53px);
  }

  /* ── Sidebar ── */
  .d-sidebar {
    border-right: 1px solid var(--purple-border);
    padding: 2rem 0;
    position: sticky; top: 53px; height: calc(100vh - 53px); overflow-y: auto;
    background: rgba(0,0,8,0.6);
    scrollbar-width: thin; scrollbar-color: rgba(186,49,255,0.3) transparent;
  }
  .d-sidebar::-webkit-scrollbar { width: 4px; }
  .d-sidebar::-webkit-scrollbar-thumb { background: rgba(186,49,255,0.3); border-radius: 2px; }
  .d-sidebar-group { margin-bottom: 0.25rem; }
  .d-sidebar-label {
    font-family: var(--font-mono); font-size: 0.58rem; letter-spacing: 0.18em;
    text-transform: uppercase; color: rgba(186,49,255,0.5);
    padding: 0.6rem 1.4rem 0.3rem;
  }
  .d-sidebar-link {
    display: block; padding: 0.5rem 1.4rem;
    font-family: var(--font-mono); font-size: 0.75rem; color: var(--off);
    text-decoration: none; letter-spacing: 0.02em;
    transition: color 0.15s, background 0.15s;
    border-left: 2px solid transparent;
  }
  .d-sidebar-link:hover { color: var(--white); background: rgba(186,49,255,0.06); }
  .d-sidebar-link.active {
    color: var(--purple); border-left-color: var(--purple);
    background: rgba(186,49,255,0.08);
  }

  /* ── Content ── */
  .d-content {
    padding: 3rem 4rem 5rem;
    max-width: 860px;
  }

  /* ── Typography ── */
  .d-h1 {
    font-family: var(--font-display); font-size: 3.5rem; font-weight: 158;
    font-variation-settings: "ELGR" 1.2, "ELSH" 2;
    line-height: 0.9; letter-spacing: 0; margin-bottom: 1.2rem; color: var(--white);
  }
  .d-lead {
    font-family: var(--font-mono); font-size: 0.9rem; color: var(--off);
    line-height: 1.8; margin-bottom: 2.5rem; font-weight: 300;
    border-left: 2px solid var(--purple); padding-left: 1rem;
  }
  .d-h2 {
    font-family: var(--font-display); font-size: 1.9rem; font-weight: 158;
    font-variation-settings: "ELGR" 1.2, "ELSH" 2;
    letter-spacing: 0; margin: 2.5rem 0 0.9rem; color: var(--white);
  }
  .d-h3 {
    font-family: var(--font-mono); font-size: 0.85rem; font-weight: 600;
    color: var(--purple); letter-spacing: 0.06em; text-transform: uppercase;
    margin: 1.8rem 0 0.5rem;
  }
  .d-p {
    font-family: var(--font-mono); font-size: 0.82rem; color: var(--off);
    line-height: 1.85; margin-bottom: 1rem; font-weight: 300;
  }
  .d-p strong { color: var(--white); font-weight: 500; }
  .d-p a { color: var(--purple); text-decoration: none; }
  .d-p a:hover { text-decoration: underline; }

  /* ── Code blocks ── */
  .d-pre {
    background: rgba(0,0,0,0.55); border: 1px solid var(--purple-border);
    border-left: 3px solid var(--purple);
    padding: 1.1rem 1.3rem; margin: 1rem 0 1.4rem;
    font-family: var(--font-mono); font-size: 0.78rem; color: #c8e6ff;
    line-height: 1.9; overflow-x: auto;
    position: relative;
  }
  .d-pre::before {
    content: attr(data-lang);
    position: absolute; top: 0.45rem; right: 0.8rem;
    font-size: 0.58rem; color: rgba(186,49,255,0.5); letter-spacing: 0.1em; text-transform: uppercase;
  }
  .d-inline { background: rgba(186,49,255,0.12); padding: 0.1em 0.4em; font-family: var(--font-mono); font-size: 0.82em; color: var(--purple); border-radius: 2px; }

  /* ── Callout ── */
  .d-callout {
    border: 1px solid rgba(186,49,255,0.3); background: rgba(186,49,255,0.07);
    padding: 1rem 1.2rem; margin: 1.4rem 0;
    font-family: var(--font-mono); font-size: 0.78rem; color: var(--off); line-height: 1.75;
  }
  .d-callout strong { color: var(--purple); }
  .d-callout.warn { border-color: rgba(255,184,108,0.4); background: rgba(255,184,108,0.07); }
  .d-callout.warn strong { color: #ffb86c; }
  .d-callout.ok { border-color: rgba(80,250,123,0.3); background: rgba(80,250,123,0.06); }
  .d-callout.ok strong { color: #50fa7b; }

  /* ── Command card ── */
  .d-cmd-card {
    border: 1px solid var(--purple-border); margin-bottom: 1.2rem;
    background: rgba(0,0,10,0.5);
  }
  .d-cmd-header {
    display: flex; align-items: baseline; gap: 0.8rem;
    padding: 0.9rem 1.2rem; border-bottom: 1px solid var(--purple-border);
    background: rgba(146,0,219,0.06);
  }
  .d-cmd-name { font-family: var(--font-mono); font-size: 0.9rem; color: var(--purple); font-weight: 600; }
  .d-cmd-args { font-family: var(--font-mono); font-size: 0.78rem; color: var(--off); }
  .d-cmd-body { padding: 0.9rem 1.2rem; font-family: var(--font-mono); font-size: 0.78rem; color: var(--off); line-height: 1.75; }

  /* ── Steps ── */
  .d-steps { list-style: none; margin: 1rem 0 1.5rem; }
  .d-step-item {
    display: flex; gap: 1rem; padding: 0.85rem 0;
    border-bottom: 1px solid rgba(186,49,255,0.1);
    font-family: var(--font-mono); font-size: 0.8rem;
  }
  .d-step-item:last-child { border-bottom: none; }
  .d-step-n { font-family: var(--font-display); font-size: 1.1rem; font-weight: 158; font-variation-settings: "ELGR" 1.2, "ELSH" 2; color: var(--purple); min-width: 28px; }
  .d-step-body { flex: 1; }
  .d-step-title { color: var(--white); font-weight: 500; margin-bottom: 0.2rem; }
  .d-step-desc { color: var(--off); font-size: 0.75rem; line-height: 1.7; font-weight: 300; }

  /* ── Divider ── */
  .d-divider { border: none; border-top: 1px solid var(--purple-border); margin: 2.5rem 0; }

  /* ── Tag pill ── */
  .d-tag { display: inline-block; font-family: var(--font-mono); font-size: 0.62rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--purple); background: rgba(186,49,255,0.12); padding: 0.15rem 0.55rem; margin-bottom: 0.7rem; }

  @media (max-width: 800px) {
    .d-shell { grid-template-columns: 1fr; }
    .d-sidebar { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--purple-border); padding: 1rem 0; display: flex; flex-wrap: wrap; gap: 0; }
    .d-sidebar-group { display: flex; flex-wrap: wrap; }
    .d-sidebar-label { display: none; }
    .d-sidebar-link { padding: 0.4rem 1rem; font-size: 0.7rem; }
    .d-content { padding: 2rem 1.2rem 4rem; }
    .d-h1 { font-size: 2.6rem; }
  }
`;

const FONT_LINKS = [
  "https://fonts.googleapis.com/css2?family=Handjet:wght,ELGR,ELSH@158,1.2,2&family=Inter:wght@300;400;500&display=swap"
];

const NAV_ITEMS = [
  { to: "/docs/quickstart", label: "Quickstart" },
  { to: "/docs/commands",   label: "CLI Reference" },
  { to: "/docs/github",     label: "GitHub" },
  { to: "/docs/docker",     label: "Docker" },
  { to: "/docs/networking", label: "Networking & TLS" },
  { to: "/docs/envvars",    label: "Env Variables" },
];

export default function DocsLayout() {
  const navigate = useNavigate();

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = DOCS_CSS;
    document.head.appendChild(style);

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_LINKS[0];
    document.head.appendChild(link);

    return () => {
      document.head.removeChild(style);
      document.head.removeChild(link);
    };
  }, []);

  return (
    <>
      <header className="d-topbar">
        <a href="/" className="d-topbar-logo">ORBIT</a>
        <span className="d-topbar-sep">/</span>
        <span className="d-topbar-section">Docs</span>
        <a href="/" className="d-topbar-back">← Back to home</a>
      </header>
      <div className="d-shell">
        <nav className="d-sidebar">
          <div className="d-sidebar-group">
            <div className="d-sidebar-label">Getting started</div>
            {NAV_ITEMS.slice(0,1).map(({ to, label }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `d-sidebar-link${isActive ? " active" : ""}`}>{label}</NavLink>
            ))}
          </div>
          <div className="d-sidebar-group">
            <div className="d-sidebar-label">Reference</div>
            {NAV_ITEMS.slice(1).map(({ to, label }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `d-sidebar-link${isActive ? " active" : ""}`}>{label}</NavLink>
            ))}
          </div>
        </nav>
        <main className="d-content">
          <Outlet />
        </main>
      </div>
    </>
  );
}
