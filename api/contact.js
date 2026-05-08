// Contact form handler — works as both:
//   - a Vercel serverless function (auto-detected via the api/ folder)
//   - an Express route handler (imported by server.js for local dev)
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_TAB = process.env.GOOGLE_SHEETS_TAB || 'Contacts';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

let sheetsClient = null;
function getSheets() {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const v = Array.isArray(fwd) ? fwd[0] : fwd;
    return v.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 5000);

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (body.company) {
      return res.status(200).json({ ok: true });
    }

    if (!SHEET_ID || !SA_EMAIL || !SA_KEY) {
      console.error('[contact] Sheets env vars missing — set GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY');
      return res.status(503).json({ error: 'Server is not configured to accept submissions yet.' });
    }

    const row = [
      new Date().toISOString(),
      name,
      email,
      message,
      getIp(req),
      String(req.headers['user-agent'] || '').slice(0, 300),
    ];

    await getSheets().spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    const detail = err?.response?.data?.error || err?.message || err;
    console.error('[contact] Sheets append failed:', detail);
    return res.status(500).json({ error: 'Could not save your message. Please try again.' });
  }
};