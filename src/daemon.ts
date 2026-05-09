import express from 'express';
import { initDB } from './db';

const app = express();
const PORT = process.env.DAEMON_PORT || 4000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', daemon: 'mini-vercel' });
});

async function start() {
  await initDB();
  console.log('Database initialized.');

  app.listen(PORT, () => {
    console.log(`Daemon is running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
