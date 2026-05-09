// GET /api/unsubscribe?t=<token>
//
// One-click unsubscribe from drip emails. The token is the row's
// unsubscribe_token (32-char hex), generated when the contact submission was
// created. Knowing the token is sufficient — it's a per-row opaque key.
//
// On success: sets newsletter_status = 'unsubscribed' and logs an
// 'unsubscribed' interaction. Renders a small confirmation page.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_CONTACT_TABLE || 'contact_submissions';

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ heading, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(heading)}</title>
<style>
  html,body{margin:0;padding:0;background:#f4ecd8;color:#1a1410;font-family:Georgia,'Times New Roman',serif;}
  .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;}
  .card{max-width:520px;width:100%;background:#fbf6e8;border:1px solid rgba(26,20,16,0.08);padding:48px;}
  .eyebrow{font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.32em;text-transform:uppercase;color:rgba(26,20,16,0.55);margin:0 0 24px 0;}
  h1{margin:0 0 18px 0;font-family:Georgia,serif;font-size:28px;font-weight:400;letter-spacing:-0.01em;line-height:1.25;}
  p{margin:0 0 14px 0;font-size:15px;line-height:1.7;}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <p class="eyebrow"><span style="color:#A6794A;">N&deg; 04</span> &middot; The Atelier</p>
      <h1>${htmlEscape(heading)}</h1>
      ${body}
    </div>
  </div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).type('text/plain').send('Method not allowed');
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).type('text/html').send(renderPage({
      heading: 'Not configured',
      body: '<p>This server is missing its database credentials and cannot process unsubscribe requests right now.</p>',
    }));
  }

  // Accept either ?t= (compact, used in drip links) or ?token= (verbose).
  const url = new URL(req.url || '/', 'http://localhost');
  const token = (url.searchParams.get('t') || url.searchParams.get('token') || '').trim();

  if (!token || token.length < 8) {
    return res.status(400).type('text/html').send(renderPage({
      heading: 'Invalid link',
      body: '<p>This unsubscribe link is missing or malformed. If you got here in error, you can safely close this tab.</p>',
    }));
  }

  const sb = getSupabase();

  const { data: row, error: findErr } = await sb
    .from(SUPABASE_TABLE)
    .select('id, email, newsletter_status')
    .eq('unsubscribe_token', token)
    .limit(1)
    .maybeSingle();

  if (findErr) {
    console.error('[unsubscribe] lookup failed:', findErr.message || findErr);
    return res.status(500).type('text/html').send(renderPage({
      heading: 'Something went wrong',
      body: '<p>We couldn’t process your request just now. Please try the link again in a moment.</p>',
    }));
  }

  if (!row) {
    return res.status(404).type('text/html').send(renderPage({
      heading: 'Link not recognized',
      body: '<p>This unsubscribe link doesn’t match anything on file. It may have already been used or expired.</p>',
    }));
  }

  // Already unsubscribed — render the confirmation page anyway.
  if (row.newsletter_status === 'unsubscribed') {
    return res.status(200).type('text/html').send(renderPage({
      heading: 'You’re already unsubscribed.',
      body: `<p>The address <strong>${htmlEscape(row.email)}</strong> won’t receive any further newsletter emails from us.</p>
             <p>If this was a mistake, just reply to any of our notes and we’ll add you back personally.</p>`,
    }));
  }

  const { error: updateErr } = await sb
    .from(SUPABASE_TABLE)
    .update({ newsletter_status: 'unsubscribed' })
    .eq('id', row.id);

  if (updateErr) {
    console.error('[unsubscribe] update failed:', updateErr.message || updateErr);
    return res.status(500).type('text/html').send(renderPage({
      heading: 'Something went wrong',
      body: '<p>We couldn’t complete your request just now. Please try the link again in a moment.</p>',
    }));
  }

  // Best-effort interaction log.
  try {
    await sb.from('contact_interactions').insert({
      submission_id: row.id,
      kind: 'unsubscribed',
      metadata: { via: 'link', user_agent: String(req.headers['user-agent'] || '').slice(0, 300) },
    });
  } catch (err) {
    console.warn('[unsubscribe] interaction log failed (non-fatal):', err?.message || err);
  }

  return res.status(200).type('text/html').send(renderPage({
    heading: 'You’ve been unsubscribed.',
    body: `<p>The address <strong>${htmlEscape(row.email)}</strong> has been removed from our newsletter.</p>
           <p>You may still receive a personal reply from us if your original message warranted one. If you’d prefer no further contact at all, simply tell us — we’ll honor it.</p>`,
  }));
};