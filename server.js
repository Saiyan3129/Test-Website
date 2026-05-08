// Local dev server. Production deploys on Vercel use api/contact.js directly
// (auto-detected as a serverless function) plus static file serving from root.
const express = require('express');
const path = require('path');
require('dotenv').config();

const contactHandler = require('./api/contact');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const SHEETS_READY = Boolean(
  process.env.GOOGLE_SHEETS_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY
);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

// Per-IP rate limit (local-only — Vercel serverless can't share state across invocations.
// For production rate limiting, add Vercel KV / Upstash Redis.)
const rate = new Map();
app.use('/api/contact', (req, res, next) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const win = 10 * 60 * 1000;
  const arr = (rate.get(ip) || []).filter((t) => now - t < win);
  if (arr.length >= 5) {
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  }
  arr.push(now);
  rate.set(ip, arr);
  next();
});

app.post('/api/contact', (req, res) => contactHandler(req, res));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, sheets: SHEETS_READY });
});

app.use(
  express.static(ROOT, {
    index: 'index.html',
    extensions: ['html'],
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store');
    },
  })
);

app.use((_req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Google Sheets: ${SHEETS_READY ? 'configured ✓' : 'NOT CONFIGURED — see .env.example'}`);
});