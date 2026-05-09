// Resend inbound webhook handler.
//
// Resend signs webhook requests with Svix (svix-id, svix-timestamp,
// svix-signature headers) using a shared secret you configure in the Resend
// dashboard. We verify the signature against the *raw* request body before
// trusting any payload — server.js mounts express.raw on this route so
// req.body is a Buffer.
//
// Matching strategy when an inbound email arrives:
//   1. Extract the In-Reply-To header (or References) from the inbound payload.
//      That value is the message ID of the email Resend sent — which we
//      stamped onto the contact_submissions row as confirmation_email_id.
//      A single lookup by that column gets us the row.
//   2. Fallback: match by sender's email address against the most recent
//      pending submission with that email. Less precise, but useful if the
//      reply chain header was stripped by an intermediate mail server.
//
// On match, we set reply_status = 'replied'. We never demote a row that's
// already in a terminal state (replied, archived, spam) — only pending rows
// are touched.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_CONTACT_TABLE || 'contact_submissions';
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';

// Reject events older than this to limit replay window. Svix recommends 5 min.
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

// Svix signature verification.
// Header format: "v1,<base64sig> v1,<base64sig2> ..."  (space-separated)
// Signed payload: `${id}.${timestamp}.${rawBody}`
// Secret: "whsec_<base64>" — strip the "whsec_" prefix, then base64-decode.
function verifySvixSignature({ rawBody, headers, secret }) {
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatureHeader = headers['svix-signature'];

  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: 'missing svix headers' };
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: 'invalid timestamp' };
  }
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: `timestamp out of tolerance (${ageSeconds}s)` };
  }

  let secretBytes;
  try {
    secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  } catch {
    return { ok: false, reason: 'invalid secret format' };
  }

  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const signedPayload = `${id}.${timestamp}.${bodyStr}`;
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(signedPayload)
    .digest('base64');

  // Header may contain multiple "v1,sig" pairs. Compare each in constant time.
  const presented = signatureHeader
    .split(' ')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1,'))
    .map((p) => p.slice(3));

  if (presented.length === 0) {
    return { ok: false, reason: 'no v1 signature' };
  }

  for (const candidate of presented) {
    let candidateBuf;
    let expectedBuf;
    try {
      candidateBuf = Buffer.from(candidate, 'base64');
      expectedBuf = Buffer.from(expected, 'base64');
    } catch {
      continue;
    }
    if (candidateBuf.length === expectedBuf.length && crypto.timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'signature mismatch' };
}

// Pull the In-Reply-To message ID from an inbound payload. Resend's exact
// shape may evolve; we look in the obvious places and then scan headers.
function extractInReplyTo(eventData) {
  if (!eventData || typeof eventData !== 'object') return null;

  // Common shapes
  const direct = eventData.in_reply_to || eventData.inReplyTo;
  if (typeof direct === 'string' && direct) return cleanMessageId(direct);

  const headers = eventData.headers;
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (!h || typeof h !== 'object') continue;
      const name = String(h.name || h.key || '').toLowerCase();
      if (name === 'in-reply-to' && typeof h.value === 'string') {
        return cleanMessageId(h.value);
      }
    }
  } else if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'in-reply-to' && typeof v === 'string') {
        return cleanMessageId(v);
      }
    }
  }

  // References header — last entry is usually the immediate parent
  const references = headers?.['references'] || headers?.References;
  if (typeof references === 'string') {
    const ids = references.split(/\s+/).map(cleanMessageId).filter(Boolean);
    if (ids.length) return ids[ids.length - 1];
  }

  return null;
}

function cleanMessageId(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Strip surrounding angle brackets: "<abc@host>" -> "abc@host"
  return trimmed.replace(/^<|>$/g, '');
}

function extractSenderEmail(eventData) {
  if (!eventData || typeof eventData !== 'object') return null;
  const from = eventData.from;
  if (!from) return null;
  if (typeof from === 'string') {
    // "Name <email@host>" or just "email@host"
    const match = from.match(/<([^>]+)>/);
    return match ? match[1].trim() : from.trim();
  }
  if (Array.isArray(from) && from[0]) {
    return from[0].email || from[0].address || null;
  }
  if (typeof from === 'object') {
    return from.email || from.address || null;
  }
  return null;
}

async function findSubmission({ inReplyTo, senderEmail }) {
  const sb = getSupabase();
  const cols = 'id, reply_status, newsletter, newsletter_status';

  if (inReplyTo) {
    const { data, error } = await sb
      .from(SUPABASE_TABLE)
      .select(cols)
      .eq('confirmation_email_id', inReplyTo)
      .limit(1)
      .maybeSingle();
    if (!error && data) return { ...data, matchedBy: 'in-reply-to' };
  }

  if (senderEmail) {
    const { data, error } = await sb
      .from(SUPABASE_TABLE)
      .select(cols)
      .eq('email', senderEmail)
      .eq('reply_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) return { ...data, matchedBy: 'sender-email' };
  }

  return null;
}

async function logInteraction({ submissionId, kind, subject = null, emailId = null, metadata = null }) {
  try {
    const { error } = await getSupabase()
      .from('contact_interactions')
      .insert({ submission_id: submissionId, kind, subject, email_id: emailId, metadata });
    if (error) console.warn(`[resend-inbound] Could not log interaction "${kind}":`, error.message || error);
  } catch (err) {
    console.warn(`[resend-inbound] Could not log interaction "${kind}":`, err?.message || err);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!RESEND_WEBHOOK_SECRET) {
    console.error('[resend-inbound] RESEND_WEBHOOK_SECRET not set — refusing to process webhook');
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[resend-inbound] Supabase env vars missing');
    return res.status(503).json({ error: 'Server not configured' });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const verification = verifySvixSignature({
    rawBody,
    headers: req.headers,
    secret: RESEND_WEBHOOK_SECRET,
  });
  if (!verification.ok) {
    console.warn('[resend-inbound] Signature verification failed:', verification.reason);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Resend sends many event types over the same webhook (delivered, opened,
  // bounced, etc.). We only act on inbound-received events. Names may vary by
  // Resend version — accept the most likely variants.
  const type = String(event?.type || '').toLowerCase();
  const isInbound =
    type === 'email.received' ||
    type === 'email.inbound' ||
    type === 'inbound.received';

  if (!isInbound) {
    // Acknowledge the webhook so Resend doesn't retry, but take no action.
    return res.status(200).json({ ok: true, ignored: type || 'unknown' });
  }

  const data = event.data || event;
  const inReplyTo = extractInReplyTo(data);
  const senderEmail = extractSenderEmail(data);
  const inboundSubject = (data && typeof data.subject === 'string') ? data.subject.slice(0, 200) : null;

  const match = await findSubmission({ inReplyTo, senderEmail });
  if (!match) {
    console.warn('[resend-inbound] No submission matched. inReplyTo=%s sender=%s', inReplyTo, senderEmail);
    return res.status(200).json({ ok: true, matched: false });
  }

  // Always log the reply, even if the row is already in a terminal state —
  // multiple replies are useful timeline data.
  await logInteraction({
    submissionId: match.id,
    kind: 'reply_received',
    subject: inboundSubject,
    metadata: { matched_by: match.matchedBy, sender: senderEmail, in_reply_to: inReplyTo },
  });

  // Promote reply_status: pending → replied (don't overwrite terminal states).
  if (match.reply_status === 'pending') {
    const { error: replyUpdateErr } = await getSupabase()
      .from(SUPABASE_TABLE)
      .update({ reply_status: 'replied' })
      .eq('id', match.id)
      .eq('reply_status', 'pending');
    if (replyUpdateErr) {
      console.error('[resend-inbound] reply_status update failed for id=%s:', match.id, replyUpdateErr.message || replyUpdateErr);
    }
  }

  // If they opted in on the form and haven't been confirmed yet, treat the
  // reply as confirmation (double opt-in pattern). pending → subscribed.
  // Don't touch unsubscribed/bounced.
  let newsletterPromoted = false;
  if (match.newsletter && match.newsletter_status === 'pending') {
    const { error: subUpdateErr } = await getSupabase()
      .from(SUPABASE_TABLE)
      .update({ newsletter_status: 'subscribed' })
      .eq('id', match.id)
      .eq('newsletter_status', 'pending');
    if (subUpdateErr) {
      console.error('[resend-inbound] newsletter_status update failed for id=%s:', match.id, subUpdateErr.message || subUpdateErr);
    } else {
      newsletterPromoted = true;
      await logInteraction({
        submissionId: match.id,
        kind: 'subscribed',
        metadata: { via: 'reply_to_confirmation' },
      });
    }
  }

  console.log(
    '[resend-inbound] Submission %s: reply logged, replyStatus=%s -> %s, newsletter=%s, status=%s%s',
    match.id,
    match.reply_status,
    match.reply_status === 'pending' ? 'replied' : match.reply_status,
    match.newsletter,
    match.newsletter_status,
    newsletterPromoted ? ' -> subscribed' : ''
  );

  return res.status(200).json({
    ok: true,
    matched: true,
    id: match.id,
    matchedBy: match.matchedBy,
    newsletterPromoted,
  });
};