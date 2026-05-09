// Contact form handler — works as both:
//   - a Vercel serverless function (auto-detected via the api/ folder)
//   - an Express route handler (imported by server.js for local dev)
//
// Pipeline:
//   1. Validate input (incl. honeypot)
//   2. Insert into Supabase (primary store) — fail the request if this fails
//   3. Send confirmation email via Resend (best-effort, don't block on failure)
//   4. Stamp the Resend message ID back onto the row so inbound replies can be
//      matched to a submission via the In-Reply-To header
//   5. Append to Google Sheets (best-effort archive)
const crypto = require('crypto');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_TAB = process.env.GOOGLE_SHEETS_TAB || 'Contacts';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_CONTACT_TABLE || 'contact_submissions';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || '';

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

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

let resendClient = null;
function getResend() {
  if (resendClient) return resendClient;
  if (!RESEND_API_KEY) return null;
  resendClient = new Resend(RESEND_API_KEY);
  return resendClient;
}

// Append-only interaction log. Failures are warned but never block the
// user-facing flow — interactions are observability, not correctness.
async function logInteraction({ submissionId, kind, subject = null, emailId = null, metadata = null }) {
  try {
    const { error } = await getSupabase()
      .from('contact_interactions')
      .insert({
        submission_id: submissionId,
        kind,
        subject,
        email_id: emailId,
        metadata,
      });
    if (error) console.warn(`[contact] Could not log interaction "${kind}":`, error.message || error);
  } catch (err) {
    console.warn(`[contact] Could not log interaction "${kind}":`, err?.message || err);
  }
}

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const v = Array.isArray(fwd) ? fwd[0] : fwd;
    return v.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildConfirmationEmail({ name, message }) {
  const safeName = htmlEscape(name);
  const safeMessage = htmlEscape(message).replace(/\n/g, '<br>');

  const subject = 'Your note has reached the atelier';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4ecd8;font-family:Georgia,'Times New Roman',serif;color:#1a1410;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4ecd8;">
  <tr>
    <td align="center" style="padding:48px 16px;">
      <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;width:100%;background:#fbf6e8;border:1px solid rgba(26,20,16,0.08);">
        <tr>
          <td style="padding:48px 48px 40px 48px;">
            <p style="margin:0 0 28px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.32em;text-transform:uppercase;color:rgba(26,20,16,0.55);">
              <span style="color:#A6794A;">N&deg; 02</span>
              &nbsp;&middot;&nbsp;
              A note <em style="font-family:Georgia,serif;font-style:italic;">received</em>
            </p>
            <h1 style="margin:0 0 24px 0;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.2;letter-spacing:-0.01em;font-weight:400;color:#1a1410;">
              Dear ${safeName},
            </h1>
            <p style="margin:0 0 18px 0;font-size:15px;line-height:1.75;">
              Your note has reached the atelier. We&rsquo;ve kept it safely.
            </p>
            <p style="margin:0 0 32px 0;font-size:15px;line-height:1.75;">
              We answer every message by hand &mdash; usually within two working days. If anything else comes to mind in the meantime &mdash; a question, a thought, a follow-up image &mdash; simply <strong>reply to this email</strong>. It comes straight to us.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 36px 0;width:100%;">
              <tr>
                <td style="border-left:2px solid #E6B979;padding:4px 0 4px 18px;">
                  <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:rgba(26,20,16,0.55);">
                    Your message
                  </p>
                  <p style="margin:10px 0 0 0;font-size:14px;line-height:1.75;color:rgba(26,20,16,0.82);font-style:italic;">
                    ${safeMessage}
                  </p>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 6px 0;font-size:14px;line-height:1.7;">With care,</p>
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:18px;font-style:italic;color:#1a1410;">
              The Atelier
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:24px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:rgba(26,20,16,0.45);">
        Just hit reply &mdash; we read every word.
      </p>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = `Dear ${name},

Your note has reached the atelier. We've kept it safely.

We answer every message by hand — usually within two working days. If anything else comes to mind in the meantime — a question, a thought, a follow-up image — simply reply to this email. It comes straight to us.

Your message:
"${message}"

With care,
The Atelier

—
Just hit reply — we read every word.`;

  return { subject, html, text };
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
    const newsletter = body.newsletter === true || body.newsletter === 'true' || body.newsletter === 'on';

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (body.company) {
      return res.status(200).json({ ok: true });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[contact] Supabase env vars missing — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
      return res.status(503).json({ error: 'Server is not configured to accept submissions yet.' });
    }

    const ip = getIp(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);

    // 1) Insert into Supabase. We need the row ID back so we can stamp the
    // Resend message ID onto it after sending the confirmation email.
    // unsubscribe_token: opaque per-row id used in unsubscribe links.
    const unsubscribeToken = crypto.randomUUID().replace(/-/g, '');

    const { data: inserted, error: supabaseError } = await getSupabase()
      .from(SUPABASE_TABLE)
      .insert({
        name,
        email,
        message,
        newsletter,
        ip,
        user_agent: userAgent,
        unsubscribe_token: unsubscribeToken,
      })
      .select('id')
      .single();

    if (supabaseError || !inserted) {
      console.error('[contact] Supabase insert failed:', supabaseError?.message || supabaseError);
      return res.status(500).json({ error: 'Could not save your message. Please try again.' });
    }

    const submissionId = inserted.id;
    await logInteraction({
      submissionId,
      kind: 'submission_received',
      metadata: { newsletter, ip, user_agent: userAgent },
    });

    // 2) Send confirmation email (best-effort). Don't block the user-facing
    // success response on failure — Supabase has the message either way.
    const resend = getResend();
    if (resend) {
      try {
        const { subject, html, text } = buildConfirmationEmail({ name, message });
        const sendArgs = {
          from: RESEND_FROM,
          to: email,
          subject,
          html,
          text,
          headers: { 'X-Submission-Id': String(submissionId) },
        };
        if (RESEND_REPLY_TO) sendArgs.replyTo = RESEND_REPLY_TO;

        const { data: emailData, error: emailError } = await resend.emails.send(sendArgs);
        if (emailError) {
          console.warn('[contact] Resend send failed (non-fatal):', emailError.message || emailError);
          await logInteraction({
            submissionId,
            kind: 'confirmation_failed',
            subject,
            metadata: { error: String(emailError.message || emailError) },
          });
        } else if (emailData?.id) {
          // 3) Stamp the email ID onto the row so inbound replies can be
          // matched via the In-Reply-To header. Tolerated to fail (e.g. if the
          // confirmation_email_id column hasn't been added yet) — submission
          // still succeeded, just won't auto-track replies for this row.
          const { error: updateError } = await getSupabase()
            .from(SUPABASE_TABLE)
            .update({ confirmation_email_id: emailData.id })
            .eq('id', submissionId);
          if (updateError) {
            console.warn('[contact] Could not stamp confirmation_email_id (non-fatal):', updateError.message || updateError);
          }
          await logInteraction({
            submissionId,
            kind: 'confirmation_sent',
            subject,
            emailId: emailData.id,
          });
        }
      } catch (err) {
        console.warn('[contact] Confirmation email errored (non-fatal):', err?.message || err);
        await logInteraction({
          submissionId,
          kind: 'confirmation_failed',
          metadata: { error: String(err?.message || err) },
        });
      }
    }

    // 4) Best-effort: Google Sheets archive
    if (SHEET_ID && SA_EMAIL && SA_KEY) {
      const row = [
        new Date().toISOString(),
        name,
        email,
        message,
        newsletter ? 'yes' : 'no',
        ip,
        userAgent,
      ];
      try {
        await getSheets().spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_TAB}!A:G`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [row] },
        });
      } catch (err) {
        const detail = err?.response?.data?.error || err?.message || err;
        console.warn('[contact] Sheets archive failed (non-fatal):', detail);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    const detail = err?.response?.data?.error || err?.message || err;
    console.error('[contact] Unexpected error:', detail);
    return res.status(500).json({ error: 'Could not save your message. Please try again.' });
  }
};