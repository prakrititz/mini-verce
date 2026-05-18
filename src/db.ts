import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data.sqlite');

if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, '');
}

const db = new sqlite3.Database(DB_PATH);

export function run(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function get(sql: string, params: any[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function all(sql: string, params: any[] = []): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export async function initDB() {
  // ── Core tables ──────────────────────────────────────────────────────────

  // Phase 1: Real identity — email + bcrypt password, no more random UUIDs
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Phase 1: Persistent sessions (30-day expiry)
  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS projects (
      id             TEXT PRIMARY KEY,
      name           TEXT UNIQUE NOT NULL,
      path           TEXT NOT NULL,
      repository_url TEXT,
      custom_domain  TEXT,
      owner_id       TEXT REFERENCES users(id),
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS deployments (
      id           TEXT PRIMARY KEY,
      project_id   TEXT,
      status       TEXT,
      container_id TEXT,
      port         INTEGER,
      env          TEXT DEFAULT 'production',
      url          TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS env_vars (
      id         TEXT PRIMARY KEY,
      project_id TEXT,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      is_secret  BOOLEAN DEFAULT 0,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      UNIQUE(project_id, key)
    )
  `);

  // ── Safe migrations for pre-existing databases ────────────────────────────
  const migrations = [
    "ALTER TABLE deployments ADD COLUMN env TEXT DEFAULT 'production'",
    "ALTER TABLE deployments ADD COLUMN url TEXT",
    "ALTER TABLE projects ADD COLUMN custom_domain TEXT",
    // Phase 1: identity columns on legacy users table
    "ALTER TABLE users ADD COLUMN email TEXT",
    "ALTER TABLE users ADD COLUMN password_hash TEXT",
    // Phase 2: project ownership
    "ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id)",
  ];

  for (const sql of migrations) {
    try { await run(sql); } catch (_) {}
  }

  // Purge expired sessions on every startup
  try {
    await run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
  } catch (_) {}
}
