import sqlite3 from 'sqlite3';

import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data.sqlite');

// Ensure database file exists
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, '');
}

const db = new sqlite3.Database(DB_PATH);

export function run(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
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
  await run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      path TEXT NOT NULL,
      repository_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      status TEXT,
      container_id TEXT,
      port INTEGER,
      env TEXT DEFAULT 'production',
      url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )
  `);

  // Perform safe schema migrations if the table already existed without these columns
  try {
    await run("ALTER TABLE deployments ADD COLUMN env TEXT DEFAULT 'production'");
  } catch (_) {}

  try {
    await run("ALTER TABLE deployments ADD COLUMN url TEXT");
  } catch (_) {}

  try {
    await run("ALTER TABLE projects ADD COLUMN custom_domain TEXT");
  } catch (_) {}

  await run(`
    CREATE TABLE IF NOT EXISTS env_vars (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      is_secret BOOLEAN DEFAULT 0,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      UNIQUE(project_id, key)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL
    )
  `);
}
