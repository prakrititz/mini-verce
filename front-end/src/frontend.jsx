import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShaderGradientCanvas, ShaderGradient } from "@shadergradient/react";

// ─── Fonts via @import in a style tag injected once ───────────────────────────
const FontLoader = () => {
  useEffect(() => {
    const googlePreconnect = document.createElement("link");
    googlePreconnect.rel = "preconnect";
    googlePreconnect.href = "https://fonts.googleapis.com";

    const gstaticPreconnect = document.createElement("link");
    gstaticPreconnect.rel = "preconnect";
    gstaticPreconnect.href = "https://fonts.gstatic.com";
    gstaticPreconnect.crossOrigin = "anonymous";

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Handjet:wght,ELGR,ELSH@158,1.2,2&display=swap";
    document.head.appendChild(googlePreconnect);
    document.head.appendChild(gstaticPreconnect);
    document.head.appendChild(link);

    return () => {
      document.head.removeChild(googlePreconnect);
      document.head.removeChild(gstaticPreconnect);
      document.head.removeChild(link);
    };
  }, []);
  return null;
};

// ─── CSS injected globally ────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --purple: #e76fff;
    --purple-dim: rgba(186, 49, 255, 0.52);
    --purple-border: rgba(123, 255, 109, 0);
    --white: #f0eaf8;
    --off: #b8a8d0;
    --muted: #beff7e;
    --bg: #000010;
    --surface: rgba(255, 4, 4, 0.57);
    --font-display: 'Handjet', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    --page-x: clamp(1rem, 5vw, 4rem);
  }
  html { scroll-behavior: smooth; min-width: 320px; max-width:100%; overflow-x:hidden; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  body { width:100%; max-width:100%; background: var(--bg); color: var(--white); overflow-x: hidden; cursor: none; }
  #root, main { width:100%; max-width:100vw; overflow-x:hidden; }
  body, button { font-synthesis-weight: none; }
  button, a { font: inherit; }
  button { max-width:100%; min-width:0; }
  #orbit-cursor {
    position: fixed; top:0; left:0; width:11px; height:11px;
    background: var(--purple); border-radius: 50%;
    pointer-events: none; z-index: 9999;
    mix-blend-mode: screen; transition: transform 0.08s;
  }
  /* grain */
  #orbit-grain {
    position: fixed; inset:0; pointer-events:none; z-index:3; opacity:0.35;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E");
  }
  /* NAV */
  .o-nav {
    display:flex; align-items:center; justify-content:space-between; gap:1.4rem;
    width:100%; max-width:100vw;
    padding: 1.1rem var(--page-x);
    border-bottom: 1px solid var(--purple-border);
    backdrop-filter: blur(18px);
    position: sticky; top:0; z-index:100;
    background: rgba(0,0,16,0.72);
    font-family: var(--font-mono);
  }
  .o-nav > * { min-width:0; }
  .o-logo {
    font-family: var(--font-display); font-size:1.75rem; font-weight:158;
    font-variation-settings:"ELGR" 1.2, "ELSH" 2;
    letter-spacing:0; color: var(--white);
    text-decoration:none;
  }
  .o-logo em { color: var(--purple); font-style:normal; }
  .o-links { display:flex; gap:2.5rem; list-style:none; min-width:0; }
  .o-links a {
    color: var(--muted); text-decoration:none;
    font-size:0.72rem; letter-spacing:0.1em; text-transform:uppercase;
    transition: color 0.2s;
  }
  .o-links a:hover { color: var(--white); }
  .o-cta {
    background: var(--purple); color:#fff; border:none; cursor:none;
    padding: 0.58rem 1.35rem;
    font-family: var(--font-mono); font-size:0.72rem; font-weight:500;
    letter-spacing:0.06em; text-transform:uppercase;
    clip-path: polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%);
    transition: background 0.2s, transform 0.15s;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }
  .o-cta:hover { background:#b020ff; transform:scale(1.05); }
  /* HERO */
  .o-hero {
    position:relative; min-height:calc(100svh - 70px);
    width:100%; max-width:100vw; overflow:hidden;
    display:flex; flex-direction:column; align-items:flex-start; justify-content:center;
    padding: 5rem var(--page-x) 4rem; z-index:2;
  }
  .o-badge {
    display:inline-flex; align-items:center; gap:0.5rem;
    font-family: var(--font-mono); font-size:0.68rem; letter-spacing:0.12em; text-transform:uppercase;
    color: var(--purple); border:1px solid var(--purple-border);
    padding: 0.3rem 0.85rem; margin-bottom:2rem;
    clip-path: polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%);
  }
  .o-badge-dot {
    width:6px; height:6px; background:var(--purple); border-radius:50%;
    animation: pulse 2s infinite;
  }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.35;transform:scale(0.6)} }
  .o-h1 {
    font-family: var(--font-display);
    font-size: 7.25rem; font-weight:158;
    font-variation-settings:"ELGR" 1.2, "ELSH" 2;
    line-height:0.8; letter-spacing:0; margin-bottom:1.5rem; max-width:780px;
    overflow-wrap:anywhere;
  }
  .o-h1 .ac { color: var(--purple); }
  .o-h1 .dm { color: var(--muted); }
  .o-sub {
    font-family: var(--font-mono); font-size:0.95rem; color:var(--off);
    width:min(100%, calc(100vw - (var(--page-x) * 2)), 500px); line-height:1.75; margin-bottom:2.5rem; font-weight:300;
    overflow-wrap:anywhere;
  }
  .o-actions { display:flex; gap:1rem; flex-wrap:wrap; }
  .o-btn-primary {
    background: var(--purple); color:#fff; border:none; cursor:none;
    padding: 0.82rem 2rem; font-family:var(--font-mono);
    font-size:0.8rem; font-weight:500; letter-spacing:0.04em;
    clip-path: polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%);
    transition: background 0.2s, transform 0.14s; position:relative; overflow:hidden;
    text-decoration:none; display:inline-flex; align-items:center;
  }
  .o-btn-primary:hover { background:#b020ff; transform:scale(1.03); }
  .o-btn-ghost {
    background:transparent; color:var(--off);
    border:1px solid rgba(186,49,255,0.35); cursor:none;
    padding:0.82rem 2rem; font-family:var(--font-mono);
    font-size:0.8rem; font-weight:400; letter-spacing:0.04em;
    transition: border-color 0.2s, color 0.2s;
    text-decoration:none; display:inline-flex; align-items:center;
  }
  .o-btn-ghost:hover { border-color:var(--purple); color:var(--white); }
  .o-stats {
    display:flex; flex-wrap:wrap; gap:2.5rem; margin-top:3.5rem; padding-top:2rem;
    border-top:1px solid rgba(186,49,255,0.15);
    font-family: var(--font-mono);
    width:min(100%, 760px);
  }
  .o-stat-num { font-family:var(--font-display); font-size:2.25rem; font-weight:158; font-variation-settings:"ELGR" 1.2, "ELSH" 2; }
  .o-stat-num em { color:var(--purple); font-style:normal; }
  .o-stat-lbl { font-size:0.65rem; color:var(--muted); letter-spacing:0.1em; text-transform:uppercase; margin-top:0.2rem; }
  /* SECTIONS */
  .o-sec { width:100%; max-width:100vw; overflow:hidden; padding:5rem var(--page-x); position:relative; z-index:2; }
  .o-sec-lbl { font-family:var(--font-mono); font-size:0.65rem; letter-spacing:0.16em; text-transform:uppercase; color:var(--purple); margin-bottom:0.9rem; }
  .o-sec-title { font-family:var(--font-display); font-size:3.75rem; font-weight:158; font-variation-settings:"ELGR" 1.2, "ELSH" 2; line-height:0.9; letter-spacing:0; margin-bottom:1.5rem; }
  /* TERMINAL */
  .o-term-wrap {
    width:min(100%, 860px); border:1px solid rgba(186,49,255,0.25);
    background:rgba(0,0,10,0.88); backdrop-filter:blur(22px);
    overflow:hidden; position:relative;
  }
  .o-term-wrap::before {
    content:''; position:absolute; top:0; left:0; right:0; height:1px;
    background:linear-gradient(90deg,transparent,var(--purple),transparent);
  }
  .o-term-bar {
    display:flex; align-items:center; gap:0.55rem;
    padding:0.7rem 1.1rem; border-bottom:1px solid rgba(186,49,255,0.15);
    background:rgba(146,0,219,0.07);
  }
  .dot-r { width:9px;height:9px;border-radius:50%;background:#ff5f57; }
  .dot-y { width:9px;height:9px;border-radius:50%;background:#febc2e; }
  .dot-g { width:9px;height:9px;border-radius:50%;background:#28c840; }
  .o-term-title { font-family:var(--font-mono); font-size:0.67rem; color:var(--muted); margin-left:auto; letter-spacing:0.09em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .o-term-body { padding:1.4rem 1.4rem 1.7rem; font-family:var(--font-mono); font-size:0.79rem; line-height:1.9; min-height:340px; overflow:auto; }
  .t-cmd { display:flex; gap:0.6rem; min-width:0; }
  .t-prompt { color:var(--purple); user-select:none; }
  .t-c { color:#c8e6ff; min-width:0; overflow-wrap:anywhere; }
  .t-out { color:var(--off); padding-left:1.3rem; font-weight:300; overflow-wrap:anywhere; }
  .t-ok { color:#50fa7b; padding-left:1.3rem; overflow-wrap:anywhere; }
  .t-info { color:#8be9fd; padding-left:1.3rem; overflow-wrap:anywhere; }
  .t-warn { color:#ffb86c; padding-left:1.3rem; overflow-wrap:anywhere; }
  .t-em { color:var(--purple); padding-left:1.3rem; font-weight:500; overflow-wrap:anywhere; }
  .t-blink { display:inline-block; width:8px; height:0.9em; background:var(--purple); vertical-align:middle; animation:blink 1s step-end infinite; }
  @keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
  /* TIMER BAR */
  .o-timer {
    display:inline-flex; align-items:center; gap:1.2rem; flex-wrap:wrap;
    margin:1rem 0 0; padding:0.75rem 1.2rem;
    font-family:var(--font-mono);
  }
  .o-timer-num { font-family:var(--font-display); font-size:2.5rem; font-weight:158; font-variation-settings:"ELGR" 1.2, "ELSH" 2; color:var(--purple); }
  .o-timer-lbl { font-size:0.65rem; color:var(--off); text-transform:uppercase; letter-spacing:0.1em; }
  /* HOW IT WORKS */
  .o-how-grid {
    display:grid; grid-template-columns:repeat(2, minmax(0, 1fr));
    border:1px solid rgba(186,49,255,0.2); margin-top:2.5rem;
  }
  .o-step {
    padding:2.5rem; border-right:1px solid rgba(186,49,255,0.15); border-bottom:1px solid rgba(186,49,255,0.15);
    position:relative; transition:background 0.3s;
  }
  .o-step:nth-child(2n) { border-right:none; }
  .o-step:nth-last-child(-n+2) { border-bottom:none; }
  .o-step:hover { background:rgba(146,0,219,0.08); }
  .o-step-n { font-family:var(--font-display); font-size:4.2rem; font-weight:158; font-variation-settings:"ELGR" 1.2, "ELSH" 2; color:rgba(146,0,219,0.12); position:absolute; top:1rem; right:1.4rem; line-height:1; }
  .o-step-ico { font-size:1.35rem; margin-bottom:0.9rem; }
  .o-step-title { font-family:var(--font-display); font-size:1.45rem; font-weight:158; font-variation-settings:"ELGR" 1.2, "ELSH" 2; margin-bottom:0.55rem; letter-spacing:0; }
  .o-step-desc { font-family:var(--font-mono); font-size:0.75rem; color:var(--off); line-height:1.8; font-weight:300; }
  .o-step-code { margin-top:1rem; padding:0.55rem 0.85rem; background:rgba(0,0,0,0.45); border-left:2px solid var(--purple); font-family:var(--font-mono); font-size:0.7rem; color:#c8e6ff; letter-spacing:0.02em; overflow-wrap:anywhere; }
  /* DOCS */
  .o-docs-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1.4rem; margin-top:2.5rem; }
  .o-doc {
    border:1px solid rgba(186,49,255,0.2); padding:1.7rem;
    position:relative; overflow:hidden; cursor:none;
    transition:border-color 0.25s, transform 0.25s; background:rgba(0,0,16,0.5);
    text-decoration:none; display:block; color:inherit;
  }
  .o-doc::before {
    content:''; position:absolute; inset:0;
    background:radial-gradient(circle at 0% 0%,rgba(146,0,219,0.14),transparent 65%);
    opacity:0; transition:opacity 0.3s;
  }
  .o-doc:hover { border-color:var(--purple); transform:translateY(-3px); }
  .o-doc:hover::before { opacity:1; }
  .o-doc-tag { font-family:var(--font-mono); font-size:0.6rem; letter-spacing:0.13em; text-transform:uppercase; color:var(--purple); margin-bottom:0.7rem; }
  .o-doc-title { font-family:var(--font-display); font-size:1.35rem; font-weight:158; font-variation-settings:"ELGR" 1.2, "ELSH" 2; margin-bottom:0.45rem; }
  .o-doc-desc { font-family:var(--font-mono); font-size:0.72rem; color:var(--off); line-height:1.75; font-weight:300; }
  .o-doc-arr { position:absolute; bottom:1.4rem; right:1.4rem; color:var(--purple); font-size:0.95rem; opacity:0; transform:translate(-4px,4px); transition:all 0.25s; }
  .o-doc:hover .o-doc-arr { opacity:1; transform:translate(0,0); }
  /* GET STARTED */
  .o-gs-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:4rem; align-items:start; margin-top:2.5rem; }
  .o-gs-list { list-style:none; }
  .o-gs-item { display:flex; gap:1rem; align-items:flex-start; padding:1.2rem 0; border-bottom:1px solid rgba(186,49,255,0.15); font-family:var(--font-mono); }
  .o-gs-item:last-child { border-bottom:none; }
  .o-gs-n { font-family:var(--font-display); font-size:1.05rem; font-weight:158; font-variation-settings:"ELGR" 1.2, "ELSH" 2; color:var(--purple); min-width:22px; padding-top:0.1rem; }
  .o-gs-strong { display:block; color:var(--white); font-weight:500; font-size:0.78rem; margin-bottom:0.3rem; }
  .o-gs-span { color:var(--off); font-size:0.73rem; font-weight:300; line-height:1.7; }
  .o-install { border:1px solid rgba(186,49,255,0.2); overflow:hidden; background:rgba(0,0,10,0.85); }
  .o-install-body { padding:1.4rem; }
  .o-install-cmd { font-family:var(--font-mono); font-size:0.78rem; color:#c8e6ff; line-height:2; overflow-wrap:anywhere; }
  .o-install-note { margin-top:1.4rem; padding-top:1.4rem; border-top:1px solid rgba(186,49,255,0.15); font-family:var(--font-mono); font-size:0.69rem; color:var(--muted); line-height:1.75; font-weight:300; }
  .o-install-note strong { color:var(--off); font-weight:500; }
  /* FOOTER */
  .o-footer {
    border-top:1px solid rgba(186,49,255,0.15); padding:2.5rem var(--page-x);
    width:100%; max-width:100vw; overflow:hidden;
    display:flex; align-items:center; justify-content:space-between; gap:1.5rem;
    font-family:var(--font-mono); font-size:0.68rem; color:var(--muted); letter-spacing:0.05em;
    position:relative; z-index:2;
  }
  .o-footer-logo { font-family:var(--font-display); font-weight:158; font-variation-settings:"ELGR" 1.2, "ELSH" 2; font-size:1.45rem; color:var(--white); }
  .o-footer-logo em { color:var(--purple); font-style:normal; }
  .o-footer-links { display:flex; gap:2rem; flex-wrap:wrap; justify-content:flex-end; }
  .o-footer-links a { color:var(--muted); text-decoration:none; transition:color 0.2s; }
  .o-footer-links a:hover { color:var(--white); }
  /* Reveal */
  .rev { opacity:0; transform:translateY(24px); transition:opacity 0.7s ease,transform 0.7s ease; }
  .rev.vis { opacity:1; transform:translateY(0); }

  @media (max-width: 1024px) {
    .o-nav { padding-top:1rem; padding-bottom:1rem; }
    .o-links { gap:1.4rem; }
    .o-h1 { font-size:5.8rem; }
    .o-sec-title { font-size:3.25rem; }
    .o-docs-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .o-gs-grid { gap:2.5rem; }
  }

  @media (max-width: 760px) {
    .o-nav {
      display:grid;
      grid-template-columns:minmax(0,1fr) auto;
      align-items:center;
      row-gap:0.9rem;
    }
    .o-links {
      grid-column:1 / -1;
      width:100%;
      gap:1rem;
      overflow-x:auto;
      padding-bottom:0.2rem;
      scrollbar-width:none;
    }
    .o-links::-webkit-scrollbar { display:none; }
    .o-links a { white-space:nowrap; font-size:0.68rem; }
    .o-cta { justify-self:end; max-width:100%; overflow:hidden; text-overflow:ellipsis; }
    .o-hero { min-height:auto; padding-top:4.5rem; }
    .o-badge { margin-bottom:1.5rem; max-width:100%; }
    .o-h1 { font-size:4.3rem; line-height:0.86; margin-bottom:1.25rem; }
    .o-sub { font-size:0.86rem; line-height:1.7; margin-bottom:2rem; }
    .o-actions { width:100%; }
    .o-btn-primary, .o-btn-ghost { flex:1 1 13rem; min-height:44px; padding-left:1.2rem; padding-right:1.2rem; }
    .o-stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1.4rem 1rem; margin-top:2.5rem; }
    .o-sec { padding-top:4rem; padding-bottom:4rem; }
    .o-sec-title { font-size:2.85rem; line-height:0.95; }
    .o-term-bar { padding-left:0.9rem; padding-right:0.9rem; }
    .o-term-body { min-height:280px; padding:1rem; font-size:0.72rem; line-height:1.85; }
    .o-timer { width:100%; padding-left:0; padding-right:0; }
    .o-how-grid, .o-docs-grid, .o-gs-grid { grid-template-columns:1fr; }
    .o-step { border-right:none; padding:2rem 1.25rem; }
    .o-step:nth-last-child(-n+2) { border-bottom:1px solid rgba(186,49,255,0.15); }
    .o-step:last-child { border-bottom:none; }
    .o-step-n { font-size:3.2rem; right:1rem; }
    .o-doc { padding:1.35rem; min-height:10.5rem; }
    .o-doc-arr { opacity:1; transform:none; }
    .o-gs-grid { gap:2rem; }
    .o-footer { flex-direction:column; align-items:flex-start; }
    .o-footer-links { justify-content:flex-start; gap:1.2rem; }
    #orbit-cursor, #orbit-ring { display:none; }
  }

  @media (max-width: 600px) {
    :root { --page-x: 1rem; }
    .o-nav { grid-template-columns:1fr; }
    .o-links { order:2; }
    .o-nav .o-cta { display:none; }
    .o-h1 { font-size:3.35rem; }
    .o-badge { font-size:0.62rem; line-height:1.5; padding:0.28rem 0.7rem; }
    .o-sub, .o-actions, .o-stats { width:min(100%, 22rem); }
    .o-actions { flex-direction:column; }
    .o-btn-primary, .o-btn-ghost { width:100%; flex-basis:auto; }
    .o-stats { grid-template-columns:1fr; }
    .o-stat-num { font-size:2rem; }
    .o-sec-title { font-size:2.35rem; }
    .o-term-title { max-width:11rem; }
    .o-term-body { min-height:250px; font-size:0.68rem; }
    .t-out, .t-ok, .t-info, .t-warn, .t-em { padding-left:0.7rem; }
    .o-timer { gap:0.8rem; }
    .o-timer-num { font-size:2rem; }
    .o-gs-item { gap:0.75rem; }
    .o-install-body { padding:1rem; }
    .o-install-cmd { font-size:0.68rem; line-height:1.9; }
    .o-install-note { font-size:0.66rem; }
    .o-footer { font-size:0.64rem; }
  }

  @media (hover:none), (pointer:coarse) {
    body { cursor:auto; }
    button, a, .o-doc { cursor:pointer; }
    #orbit-cursor, #orbit-ring { display:none; }
  }

  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior:auto; }
    *, *::before, *::after {
      animation-duration:0.001ms !important;
      animation-iteration-count:1 !important;
      transition-duration:0.001ms !important;
    }
  }
`;

// ─── Terminal lines — real orbit CLI workflow ──────────────────────────────────
const TERM_LINES = [
  { t: "cmd", s: "orbit start-daemon" },
  { t: "ok",  s: "✓ Daemon started on port 4000" },
  { t: "ok",  s: "✓ Caddy reverse proxy container running" },
  { t: "cmd", s: "orbit signup" },
  { t: "info",s: "Email: dev@example.com" },
  { t: "ok",  s: "✓ Account created. Session saved to ~/.orbit-auth.json" },
  { t: "cmd", s: "orbit github connect" },
  { t: "info",s: "Paste your GitHub PAT: ****" },
  { t: "ok",  s: "✓ Connected as @your-github-username" },
  { t: "cmd", s: "orbit import" },
  { t: "out", s: "Fetching your GitHub repositories..." },
  { t: "info",s: "? Select a repository to link: your-github-username/my-app (main)" },
  { t: "ok",  s: "✓ Project \"my-app\" linked" },
  { t: "ok",  s: "✓ Webhook registered on GitHub" },
  { t: "cmd", s: "orbit deploy" },
  { t: "out", s: "[orbit] Detecting stack... → Vite + React" },
  { t: "out", s: "[orbit] Generating multi-stage Dockerfile..." },
  { t: "out", s: "→ docker build -t my-app:a3f92c1 ." },
  { t: "out", s: "Step 1/8  FROM node:20-alpine AS builder" },
  { t: "out", s: "Step 5/8  RUN npm ci && npm run build" },
  { t: "out", s: "Step 8/8  COPY --from=builder /app/dist /usr/share/nginx/html" },
  { t: "ok",  s: "✓ Successfully built a3f92c1" },
  { t: "em",  s: "[orbit] Zero-downtime swap — reloading Caddy..." },
  { t: "ok",  s: "✓ my-app live at http://my-app.localhost:8080" },
  { t: "em",  s: "⬡ Deploy complete — 23s" },
];

// ─── Terminal component ───────────────────────────────────────────────────────
function Terminal() {
  const [lines, setLines] = useState([]);
  const [timerVal, setTimerVal] = useState(0);
  const [done, setDone] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let timerInt = null;

    async function run() {
      setLines([]); setTimerVal(0); setDone(false);
      let tv = 0;
      timerInt = setInterval(() => {
        tv += 0.1;
        if (!cancelled) setTimerVal(parseFloat(tv.toFixed(1)));
        if (tv >= 23) clearInterval(timerInt);
      }, 100);
      for (let i = 0; i < TERM_LINES.length; i++) {
        if (cancelled) return;
        // Vary delay: daemon/auth cmds slower, build steps faster
        const delay = i < 2 ? 350 : i < 8 ? 260 : i < 13 ? 200 : i < 20 ? 100 : 220;
        await new Promise(r => setTimeout(r, delay));
        setLines(prev => [...prev, TERM_LINES[i]]);
      }
      clearInterval(timerInt);
      if (!cancelled) { setTimerVal(23); setDone(true); }
      await new Promise(r => setTimeout(r, 6000));
      if (!cancelled) run();
    }
    run();
    return () => { cancelled = true; clearInterval(timerInt); };
  }, []);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  return (
    <div>
      <div className="o-term-wrap rev">
        <div className="o-term-bar">
          <div className="dot-r"/><div className="dot-y"/><div className="dot-g"/>
          <span className="o-term-title">orbit — zsh — 80×24</span>
        </div>
        <div className="o-term-body" ref={bodyRef}>
          {lines.map((l, i) =>
            l.t === "cmd"
              ? <div key={i} className="t-cmd"><span className="t-prompt">$</span><span className="t-c">{l.s}</span></div>
              : <div key={i} className={`t-${l.t}`}>{l.s}</div>
          )}
          {done && <div className="t-em"><span className="t-blink"/></div>}
        </div>
      </div>
      <div className="o-timer rev" style={{ marginTop: "1rem" }}>
        <div>
          <div className="o-timer-num" style={{ color: done ? "#50fa7b" : "var(--purple)" }}>
            {timerVal.toFixed(1)}s
          </div>
        </div>
        <div>
          <div className="o-timer-lbl">Deploy time</div>
        </div>
        {done && (
          <div style={{ marginLeft:"1rem", paddingLeft:"1.4rem", borderLeft:"1px solid rgba(186,49,255,0.2)" }}>
            <div style={{ fontFamily:"var(--font-mono)", fontSize:"0.65rem", color:"#50fa7b", fontWeight:500, letterSpacing:"0.08em", textTransform:"uppercase" }}>✓ Live</div>
            <div style={{ fontFamily:"var(--font-mono)", fontSize:"0.65rem", color:"var(--muted)", marginTop:"0.15rem" }}>my-app.localhost:8080</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function Orbit() {
  const cursorRef = useRef(null);
  const navigate = useNavigate();

  // Inject CSS once
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // Custom cursor
  useEffect(() => {
    const onMove = (e) => {
      if (cursorRef.current)
        cursorRef.current.style.transform = `translate(${e.clientX - 5}px,${e.clientY - 5}px)`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);



  // Scroll reveal
  useEffect(() => {
    const els = document.querySelectorAll(".rev");
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("vis"); });
    }, { threshold: 0.08 });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  });

  return (
    <>
      <FontLoader />
      {/* Custom cursor */}
      <div id="orbit-cursor" ref={cursorRef} />
      {/* Grain */}
      <div id="orbit-grain" />

      {/* ── ShaderGradient Background ── */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0 }}>
        <ShaderGradientCanvas
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          pixelDensity={1.6}
          fov={45}
        >
          <ShaderGradient
            animate="on"
            brightness={0.7}
            cAzimuthAngle={180}
            cDistance={3.6}
            cPolarAngle={90}
            cameraZoom={1}
            color1="#000000"
            color2="#9200db"
            color3="#000020"
            envPreset="dawn"
            grain="on"
            lightType="3d"
            positionX={-1.4}
            positionY={0}
            positionZ={0}
            rotationX={0}
            rotationY={10}
            rotationZ={50}
            type="plane"
            uAmplitude={1}
            uDensity={2.3}
            uFrequency={5.5}
            uSpeed={0.4}
            uStrength={1.1}
            shader="defaults"
          />
        </ShaderGradientCanvas>
      </div>

      {/* ── NAV ── */}
      <nav className="o-nav">
        <a href="/" className="o-logo">ORBIT</a>
        <ul className="o-links">
          <li><a href="#how">How it works</a></li>
          <li><a href="#docs">Docs</a></li>
          <li><a href="#start">Get started</a></li>
        </ul>
        <button className="o-cta" onClick={() => navigate("/docs/quickstart")}>Read the docs →</button>
      </nav>

      <main style={{ position: "relative", zIndex: 2 }}>
        {/* ── HERO ── */}
        <section className="o-hero">
          <div className="o-badge rev"><span className="o-badge-dot" />Self-hosted PaaS · Deploy in ~25s</div>
          <h1 className="o-h1 rev">
            Your device<br />
            <em className="ac">is the</em><br />
            <em className="dm">server.</em>
          </h1>
          <p className="o-sub rev">
            Connect GitHub. Push code. Orbit auto-detects your stack, builds a Docker image, and deploys it on your own machine — no cloud bills, no config files, no nonsense.
          </p>
          <div className="o-actions rev">
            <a href="#start" className="o-btn-primary">Get started →</a>
            <a href="/docs/quickstart" className="o-btn-ghost">Read the docs</a>
          </div>
          <div className="o-stats rev">
            {[["~25s","avg deploy time"],["0","config files needed"],["$0","cloud cost"]].map(([n,l])=>(
              <div key={l}>
                <div className="o-stat-num"><em>{n}</em></div>
                <div className="o-stat-lbl">{l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── TERMINAL ── */}
        <section className="o-sec" id="terminal">
          <p className="o-sec-lbl rev">// live deploy</p>
          <h2 className="o-sec-title rev">Watch it happen<br />in real time.</h2>
          <Terminal />
        </section>

        {/* ── HOW IT WORKS ── */}
        <section className="o-sec" id="how">
          <p className="o-sec-lbl rev">// architecture</p>
          <h2 className="o-sec-title rev">How Orbit works.</h2>
          <div className="o-how-grid rev">
            {[
              ["01","⬡","Start the daemon","Run orbit start-daemon once. It spawns a background Express control plane on port 4000 and ensures Caddy is running in Docker for reverse proxying.","orbit start-daemon"],
              ["02","⑂","Connect GitHub","orbit github connect links your PAT (AES-256 encrypted in SQLite). Then orbit import lists your repos and auto-registers a webhook — no manual dashboard wiring.","orbit github connect && orbit import"],
              ["03","⬡","Auto Docker build","On every push, Orbit detects your stack (Next.js, Vite, CRA, or Node), generates an optimised multi-stage Dockerfile if none exists, and containerises the build.","→ docker build -t my-app:a3f92c1 ."],
              ["04","◎","Zero-downtime swap","The new container starts on a free port. Orbit rewrites the Caddyfile and calls caddy reload — the old container is only stopped after the new one is healthy.","✓ my-app.localhost:8080 — live in 23s"],
            ].map(([n,ico,title,desc,code])=>(
              <div key={n} className="o-step">
                <div className="o-step-n">{n}</div>
                <div className="o-step-ico">{ico}</div>
                <div className="o-step-title">{title}</div>
                <div className="o-step-desc">{desc}</div>
                <div className="o-step-code">{code}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── DOCS ── */}
        <section className="o-sec" id="docs">
          <p className="o-sec-lbl rev">// documentation</p>
          <h2 className="o-sec-title rev">Everything you need.</h2>
          <div className="o-docs-grid rev">
            {[
              ["Quickstart","/docs/quickstart","Getting started","Install Orbit, start the daemon, create an account, and deploy your first project. Node.js ≥ 18 and Docker required."],
              ["CLI Reference","/docs/commands","All commands","Full reference for all 15+ orbit commands — start-daemon, signup, github connect, import, deploy, rollback, logs, env, domain, and more."],
              ["GitHub","/docs/github","Webhooks & import","How orbit github connect, orbit import, and automatic webhook registration work. PAT scopes, AES-256 encryption, push triggers."],
              ["Docker","/docs/docker","Auto-Dockerfile","Stack auto-detection for Next.js, Vite, CRA, and generic Node. Multi-stage builds, minivercel.json overrides, and image tagging by commit SHA."],
              ["Networking","/docs/networking","Caddy & TLS","How Orbit's built-in Caddy reverse proxy maps containers to *.localhost. Local CA trust, HTTPS, custom domains, and port management."],
              ["Env Vars","/docs/envvars","Secrets management","Store, update, and pull environment variables per project with orbit env. Variables are kept in SQLite and injected at deploy time."],
            ].map(([tag,href,title,desc])=>(
              <a key={title} href={href} className="o-doc">
                <div className="o-doc-tag">{tag}</div>
                <div className="o-doc-title">{title}</div>
                <div className="o-doc-desc">{desc}</div>
                <div className="o-doc-arr">↗</div>
              </a>
            ))}
          </div>
        </section>

        {/* ── GET STARTED ── */}
        <section className="o-sec" id="start">
          <p className="o-sec-lbl rev">// getting started</p>
          <h2 className="o-sec-title rev">Up in 25 seconds.</h2>
          <div className="o-gs-grid rev">
            <ul className="o-gs-list">
              {[
                ["01","Install & build","Clone the repo, npm install, npm run build, npm link — that's it. The orbit binary is now globally available."],
                ["02","Start the daemon","orbit start-daemon launches the background Express server and Caddy proxy. Run it once; it stays running."],
                ["03","Create account & connect GitHub","orbit signup creates your local account. orbit github connect links your PAT so Orbit can register webhooks automatically."],
                ["04","Import, deploy, ship","orbit import picks your repo and registers the webhook. orbit deploy triggers the first build. orbit list shows your live URL."],
              ].map(([n,strong,span])=>(
                <li key={n} className="o-gs-item">
                  <div className="o-gs-n">{n}</div>
                  <div><strong className="o-gs-strong">{strong}</strong><span className="o-gs-span">{span}</span></div>
                </li>
              ))}
            </ul>
            <div className="o-install">
              <div className="o-term-bar">
                <div className="dot-r"/><div className="dot-y"/><div className="dot-g"/>
                <span className="o-term-title">install</span>
              </div>
              <div className="o-install-body">
                <div className="o-install-cmd">
                  <span style={{color:"var(--purple)"}}>$</span> <span>git clone https://github.com/you/orbit && cd orbit</span><br/>
                  <span style={{color:"var(--purple)"}}>$</span> <span>npm install && npm run build && npm link</span><br/>
                  <span style={{color:"var(--muted)"}}>  # ✓ orbit binary linked globally</span><br/><br/>
                  <span style={{color:"var(--purple)"}}>$</span> <span>orbit start-daemon</span><br/>
                  <span style={{color:"#50fa7b"}}>  # ✓ daemon started on :4000</span><br/>
                  <span style={{color:"#50fa7b"}}>  # ✓ Caddy proxy running</span><br/><br/>
                  <span style={{color:"var(--purple)"}}>$</span> <span>orbit signup</span><br/>
                  <span style={{color:"#8be9fd"}}>  Email: dev@example.com</span><br/>
                  <span style={{color:"#50fa7b"}}>  # ✓ account created</span><br/><br/>
                  <span style={{color:"var(--purple)"}}>$</span> <span>orbit github connect</span><br/>
                  <span style={{color:"#8be9fd"}}>  # › Paste your GitHub PAT: ****</span><br/>
                  <span style={{color:"#50fa7b"}}>  # ✓ connected as @you</span><br/><br/>
                  <span style={{color:"var(--purple)"}}>$</span> <span>orbit import && orbit deploy</span><br/>
                  <span style={{color:"#50fa7b"}}>  # ✓ my-app live at my-app.localhost:8080</span>
                </div>
                <div className="o-install-note">
                  <strong>Requirements:</strong> Node.js ≥ 18 · Docker Desktop (or Docker Engine)<br/>
                  Orbit never phones home. All builds run locally. Your code never leaves your machine.
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ── */}
      <footer className="o-footer">
        <div className="o-footer-logo">ORBIT</div>
        <div>Your device. Your server. Your rules.</div>
        <div className="o-footer-links">
          <a href="/docs/quickstart">Docs</a>
          <a href="/docs/commands">CLI Reference</a>
          <a href="/docs/github">GitHub</a>
        </div>
      </footer>
    </>
  );
}
