// Local dev server. Production deploys on Vercel use api/contact.js directly
// (auto-detected as a serverless function) plus static file serving from root.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const contactHandler = require('./api/contact');
const resendInboundHandler = require('./api/resend-inbound');
const unsubscribeHandler = require('./api/unsubscribe');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const SHEETS_READY = Boolean(
  process.env.GOOGLE_SHEETS_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY
);
const SUPABASE_READY = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const RESEND_READY = Boolean(process.env.RESEND_API_KEY);
const RESEND_INBOUND_READY = Boolean(process.env.RESEND_WEBHOOK_SECRET);
const ADMIN_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const ADMIN_SESSION_SECRET = process.env.DASHBOARD_SESSION_SECRET || '';
const ADMIN_READY = Boolean(ADMIN_PASSWORD && ADMIN_SESSION_SECRET);
const ADMIN_COOKIE = 'arca_admin';
const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_TABLE = process.env.SUPABASE_CONTACT_TABLE || 'contact_submissions';

const app = express();
app.set('trust proxy', 1);

// Resend inbound webhook needs the raw request body for Svix signature
// verification. This MUST be mounted before the global express.json() so the
// body isn't consumed and reparsed.
app.use('/api/resend-inbound', express.raw({ type: '*/*', limit: '512kb' }));

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
app.post('/api/resend-inbound', (req, res) => resendInboundHandler(req, res));
app.get('/api/unsubscribe', (req, res) => unsubscribeHandler(req, res));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    sheets: SHEETS_READY,
    supabase: SUPABASE_READY,
    resend_send: RESEND_READY,
    resend_inbound: RESEND_INBOUND_READY,
    admin: ADMIN_READY,
  });
});

// --- Admin dashboard ------------------------------------------------------
// Single shared password. Login returns an HTTP-only signed cookie; protected
// routes verify the cookie's HMAC. No DB-backed sessions — the secret rotates
// out anyone if compromised.
let adminSupabase = null;
function getAdminSupabase() {
  if (adminSupabase) return adminSupabase;
  adminSupabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return adminSupabase;
}

function signAdminSession(expiresAt) {
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${expiresAt}.${nonce}`;
  const sig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAdminSession(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!/^\d+$/.test(exp) || !/^[a-f0-9]+$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(sig)) return false;
  const expected = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(`${exp}.${nonce}`).digest('hex');
  let sigBuf;
  let expBuf;
  try {
    sigBuf = Buffer.from(sig, 'hex');
    expBuf = Buffer.from(expected, 'hex');
  } catch { return false; }
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  if (Number(exp) < Date.now()) return false;
  return true;
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_READY) {
    return res.status(503).json({ error: 'Admin auth is not configured on the server.' });
  }
  if (!verifyAdminSession(readCookie(req, ADMIN_COOKIE))) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Login throttle: 10 attempts per 10 minutes per IP.
const adminLoginRate = new Map();
app.use('/api/admin/login', (req, res, next) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const win = 10 * 60 * 1000;
  const arr = (adminLoginRate.get(ip) || []).filter((t) => now - t < win);
  if (arr.length >= 10) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  arr.push(now);
  adminLoginRate.set(ip, arr);
  next();
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_READY) {
    return res.status(503).json({ error: 'Admin auth is not configured on the server.' });
  }
  const submitted = String(req.body?.password || '');
  const expected = ADMIN_PASSWORD;
  // timing-safe compare with length-equalised buffers
  const a = Buffer.alloc(64);
  const b = Buffer.alloc(64);
  Buffer.from(submitted).copy(a, 0, 0, Math.min(64, Buffer.byteLength(submitted)));
  Buffer.from(expected).copy(b, 0, 0, Math.min(64, Buffer.byteLength(expected)));
  const match = crypto.timingSafeEqual(a, b) && submitted.length === expected.length;
  if (!match) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const expiresAt = Date.now() + ADMIN_SESSION_MAX_AGE_MS;
  const token = signAdminSession(expiresAt);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000)}${secure}`
  );
  return res.json({ ok: true });
});

app.post('/api/admin/logout', (_req, res) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
  return res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  if (!ADMIN_READY) return res.json({ authenticated: false, configured: false });
  return res.json({
    authenticated: verifyAdminSession(readCookie(req, ADMIN_COOKIE)),
    configured: true,
  });
});

app.get('/api/admin/submissions', requireAdmin, async (_req, res) => {
  if (!SUPABASE_READY) {
    return res.status(503).json({ error: 'Supabase is not configured.' });
  }
  try {
    const { data, error } = await getAdminSupabase()
      .from(ADMIN_TABLE)
      .select('id, created_at, name, email, message, newsletter, newsletter_status, reply_status, followup_step, last_followup_sent_at, ip, user_agent')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('[admin] submissions query failed:', error.message || error);
      return res.status(500).json({ error: error.message || 'Query failed' });
    }
    return res.json({ rows: data || [] });
  } catch (err) {
    console.error('[admin] submissions exception:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Query failed' });
  }
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
  console.log(`Supabase:        ${SUPABASE_READY ? 'configured ✓' : 'NOT CONFIGURED — see .env.example'}`);
  console.log(`Resend (send):   ${RESEND_READY ? 'configured ✓' : 'NOT CONFIGURED — see .env.example'}`);
  console.log(`Resend (inbound):${RESEND_INBOUND_READY ? ' configured ✓' : ' NOT CONFIGURED — needs domain + webhook'}`);
  console.log(`Google Sheets:   ${SHEETS_READY ? 'configured ✓' : 'NOT CONFIGURED — see .env.example'}`);
  console.log(`Admin dashboard: ${ADMIN_READY ? 'configured ✓' : 'NOT CONFIGURED — set DASHBOARD_PASSWORD + DASHBOARD_SESSION_SECRET'}`);
});