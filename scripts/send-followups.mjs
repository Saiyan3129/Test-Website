#!/usr/bin/env node
//
// Drip-campaign runner. Sends the next-due follow-up email to every contact
// who's eligible, then logs the send to contact_interactions.
//
// Eligibility:
//   - newsletter = true (they ticked the box on the form)
//   - newsletter_status in ('pending', 'subscribed')   (not unsubscribed/bounced)
//   - followup_step < TEMPLATES.length                  (still drips left)
//   - max(created_at, last_followup_sent_at) was >= INTERVAL_DAYS ago
//
// Usage:
//   node scripts/send-followups.mjs                  # send live
//   node scripts/send-followups.mjs --dry-run        # show plan, send nothing
//   node scripts/send-followups.mjs --days=0         # ignore the 5-day spacing
//   node scripts/send-followups.mjs --limit=10       # cap batch size
//   node scripts/send-followups.mjs --only=<email>   # restrict to one address
//
// Schedule it with Windows Task Scheduler, GitHub Actions, or a cloud cron.
// The script is idempotent per row: a successful send writes
// last_followup_sent_at + bumps followup_step before moving on, so a crash or
// re-run won't double-send to the same person on the same day.

import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// --- config ------------------------------------------------------------------
const INTERVAL_DAYS_DEFAULT = 5;
const BATCH_LIMIT_DEFAULT = 100;
const TABLE = process.env.SUPABASE_CONTACT_TABLE || 'contact_submissions';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || '';
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

// --- CLI flags ---------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name, fallback) => {
  const a = flag(name);
  if (!a) return fallback;
  const eq = a.indexOf('=');
  return eq >= 0 ? a.slice(eq + 1) : true;
};

const DRY_RUN = Boolean(flag('dry-run'));
const INTERVAL_DAYS = Number(flagValue('days', INTERVAL_DAYS_DEFAULT));
const BATCH_LIMIT = Number(flagValue('limit', BATCH_LIMIT_DEFAULT));
const ONLY_EMAIL = (flagValue('only', '') || '').toString().trim().toLowerCase();

// --- guards ------------------------------------------------------------------
function die(msg, code = 1) {
  console.error(`[followups] ${msg}`);
  process.exit(code);
}
if (!SUPABASE_URL || !SUPABASE_KEY) die('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env');
if (!RESEND_API_KEY) die('RESEND_API_KEY missing in env');
if (!Number.isFinite(INTERVAL_DAYS) || INTERVAL_DAYS < 0) die(`Invalid --days=${INTERVAL_DAYS}`);
if (!Number.isFinite(BATCH_LIMIT) || BATCH_LIMIT <= 0) die(`Invalid --limit=${BATCH_LIMIT}`);

// --- helpers -----------------------------------------------------------------
function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function nl2br(s) { return String(s).replace(/\n/g, '<br>'); }

// --- email layout ------------------------------------------------------------
// Shared cream-card shell — matches the editorial atelier brand.
function renderShell({ eyebrow, headline, paragraphs, footerNote, unsubscribeUrl }) {
  const safeUrl = htmlEscape(unsubscribeUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEscape(headline)}</title>
</head>
<body style="margin:0;padding:0;background:#f4ecd8;font-family:Georgia,'Times New Roman',serif;color:#1a1410;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4ecd8;">
  <tr>
    <td align="center" style="padding:48px 16px;">
      <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;width:100%;background:#fbf6e8;border:1px solid rgba(26,20,16,0.08);">
        <tr>
          <td style="padding:48px 48px 40px 48px;">
            <p style="margin:0 0 28px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.32em;text-transform:uppercase;color:rgba(26,20,16,0.55);">
              ${eyebrow}
            </p>
            <h1 style="margin:0 0 24px 0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.25;letter-spacing:-0.01em;font-weight:400;color:#1a1410;">
              ${htmlEscape(headline)}
            </h1>
            ${paragraphs.map((p) => `<p style="margin:0 0 18px 0;font-size:15px;line-height:1.75;">${p}</p>`).join('')}
            <p style="margin:28px 0 0 0;font-size:14px;line-height:1.7;">With care,</p>
            <p style="margin:4px 0 0 0;font-family:Georgia,serif;font-size:18px;font-style:italic;color:#1a1410;">The Atelier</p>
            ${footerNote ? `<p style="margin:32px 0 0 0;padding-top:24px;border-top:1px solid rgba(26,20,16,0.08);font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.65;color:rgba(26,20,16,0.55);">${footerNote}</p>` : ''}
          </td>
        </tr>
      </table>
      <p style="margin:18px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.18em;color:rgba(26,20,16,0.45);">
        Don't want these? <a href="${safeUrl}" style="color:rgba(26,20,16,0.7);text-decoration:underline;">Unsubscribe</a>.
      </p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// --- templates ---------------------------------------------------------------
// 3-step finite drip. Replace the placeholder copy with your actual product
// language, testimonials, and updates — the structure matches the brief
// (highlight value → testimonials → updates).
const TEMPLATES = [
  {
    key: 'value',
    subject: 'Why we keep our work small',
    build: ({ name, unsubscribeUrl }) => {
      const safeName = htmlEscape(name);
      const html = renderShell({
        eyebrow: '<span style="color:#A6794A;">N&deg; 03</span> &middot; <em style="font-family:Georgia,serif;font-style:italic;">A note on craft</em>',
        headline: `Dear ${safeName},`,
        paragraphs: [
          'Five days have passed since you wrote to us. We thought we&rsquo;d return the gesture &mdash; not with a sales note, but with a small admission of how we work.',
          'Everything we make is small-batch and finished by hand. That choice sets the tempo for everything else &mdash; the materials we&rsquo;re willing to use, the customers we can attend to, and the questions we&rsquo;re happy to answer.',
          '<strong>If anything you&rsquo;re looking for didn&rsquo;t feel quite right elsewhere</strong>, we&rsquo;d love to hear what you&rsquo;d want of it. Just reply to this email &mdash; the answer arrives at our desk, not a queue.',
        ],
        footerNote: 'You&rsquo;re receiving this because you wrote to the atelier and asked to hear from us occasionally.',
        unsubscribeUrl,
      });
      const text = `Dear ${name},

Five days have passed since you wrote to us. We thought we'd return the gesture — not with a sales note, but with a small admission of how we work.

Everything we make is small-batch and finished by hand. That choice sets the tempo for everything else — the materials we're willing to use, the customers we can attend to, and the questions we're happy to answer.

If anything you're looking for didn't feel quite right elsewhere, we'd love to hear what you'd want of it. Just reply to this email — the answer arrives at our desk, not a queue.

With care,
The Atelier

—
Don't want these? Unsubscribe: ${unsubscribeUrl}`;
      return { html, text };
    },
  },

  {
    key: 'testimonials',
    subject: 'A few words from the desks of others',
    build: ({ name, unsubscribeUrl }) => {
      const safeName = htmlEscape(name);
      const html = renderShell({
        eyebrow: '<span style="color:#A6794A;">N&deg; 04</span> &middot; <em style="font-family:Georgia,serif;font-style:italic;">From those who wrote back</em>',
        headline: `Dear ${safeName},`,
        paragraphs: [
          'When the atelier was new, we asked a handful of customers what made them stay. We&rsquo;ve kept their answers ever since.',
          // Replace these placeholder quotes with real testimonials. Keep them short and specific — generic praise reads as filler.
          '<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;width:100%;"><tr><td style="border-left:2px solid #E6B979;padding:6px 0 6px 18px;"><p style="margin:0;font-size:14px;line-height:1.75;font-style:italic;color:rgba(26,20,16,0.82);">&ldquo;[YOUR TESTIMONIAL HERE — a single sentence from a real customer is worth more than a page of marketing copy.]&rdquo;</p><p style="margin:8px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(26,20,16,0.5);">[Name, Role &middot; City]</p></td></tr></table>',
          '<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;width:100%;"><tr><td style="border-left:2px solid #E6B979;padding:6px 0 6px 18px;"><p style="margin:0;font-size:14px;line-height:1.75;font-style:italic;color:rgba(26,20,16,0.82);">&ldquo;[A SECOND TESTIMONIAL HERE — pick one that highlights a different facet (service, craft, durability).]&rdquo;</p><p style="margin:8px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(26,20,16,0.5);">[Name, Role &middot; City]</p></td></tr></table>',
          'If anything in those echoes back to what you were looking for, we&rsquo;d love to hear about it. <strong>Reply with a line or two</strong> &mdash; we read each one.',
        ],
        footerNote: 'You&rsquo;re receiving this because you wrote to the atelier and asked to hear from us occasionally.',
        unsubscribeUrl,
      });
      const text = `Dear ${name},

When the atelier was new, we asked a handful of customers what made them stay. We've kept their answers ever since.

"[YOUR TESTIMONIAL HERE — a single sentence from a real customer is worth more than a page of marketing copy.]"
— [Name, Role · City]

"[A SECOND TESTIMONIAL HERE — pick one that highlights a different facet (service, craft, durability).]"
— [Name, Role · City]

If anything in those echoes back to what you were looking for, we'd love to hear about it. Reply with a line or two — we read each one.

With care,
The Atelier

—
Don't want these? Unsubscribe: ${unsubscribeUrl}`;
      return { html, text };
    },
  },

  {
    key: 'updates',
    subject: 'Notes from the studio this month',
    build: ({ name, unsubscribeUrl }) => {
      const safeName = htmlEscape(name);
      const html = renderShell({
        eyebrow: '<span style="color:#A6794A;">N&deg; 05</span> &middot; <em style="font-family:Georgia,serif;font-style:italic;">Studio notes</em>',
        headline: `Dear ${safeName},`,
        paragraphs: [
          'A short dispatch from the desks this month. <em>Replace the bullets below with whatever&rsquo;s actually new at the atelier &mdash; a piece, a collaboration, a workshop, a behind-the-scenes detail.</em>',
          '&bull; <strong>[NEW PIECE / RELEASE]</strong> &mdash; one line about what it is and why it&rsquo;s worth a look.<br>&bull; <strong>[STUDIO MOMENT]</strong> &mdash; something happening behind the curtain (a process, a material, a person).<br>&bull; <strong>[INVITATION]</strong> &mdash; a workshop, a private viewing, an open call &mdash; anything that turns the relationship into a conversation.',
          'If any of it pulls at you, <strong>simply reply</strong> and we&rsquo;ll send more &mdash; details, photographs, the right person to talk to.',
        ],
        footerNote: 'You&rsquo;re receiving this because you wrote to the atelier and asked to hear from us occasionally.',
        unsubscribeUrl,
      });
      const text = `Dear ${name},

A short dispatch from the desks this month. (Replace these bullets with whatever's actually new at the atelier — a piece, a collaboration, a workshop, a behind-the-scenes detail.)

• [NEW PIECE / RELEASE] — one line about what it is and why it's worth a look.
• [STUDIO MOMENT] — something happening behind the curtain (a process, a material, a person).
• [INVITATION] — a workshop, a private viewing, an open call — anything that turns the relationship into a conversation.

If any of it pulls at you, simply reply and we'll send more — details, photographs, the right person to talk to.

With care,
The Atelier

—
Don't want these? Unsubscribe: ${unsubscribeUrl}`;
      return { html, text };
    },
  },
];

// --- main --------------------------------------------------------------------
async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const resend = new Resend(RESEND_API_KEY);

  const cutoffMs = Date.now() - INTERVAL_DAYS * 24 * 60 * 60 * 1000;

  // Wide candidate fetch — Supabase REST can't easily compute "max(created_at,
  // last_followup_sent_at) <= cutoff", so we filter the cooldown client-side.
  let q = supabase
    .from(TABLE)
    .select('id, name, email, newsletter, newsletter_status, followup_step, last_followup_sent_at, created_at, unsubscribe_token')
    .eq('newsletter', true)
    .in('newsletter_status', ['pending', 'subscribed'])
    .lt('followup_step', TEMPLATES.length)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT * 5); // pad for client-side cooldown filter

  if (ONLY_EMAIL) q = q.eq('email', ONLY_EMAIL);

  const { data: candidates, error } = await q;
  if (error) die(`Supabase query failed: ${error.message || error}`);

  const due = (candidates || []).filter((u) => {
    const ref = u.last_followup_sent_at || u.created_at;
    return ref && new Date(ref).getTime() <= cutoffMs;
  });

  const batch = due.slice(0, BATCH_LIMIT);

  console.log(
    `[followups] ${candidates?.length ?? 0} candidate(s); ${due.length} due (>=${INTERVAL_DAYS}d cooldown); processing ${batch.length}.`
  );
  if (DRY_RUN) console.log('[followups] DRY RUN — no emails will be sent.');

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const user of batch) {
    const step = user.followup_step ?? 0;
    const tpl = TEMPLATES[step];
    if (!tpl) {
      skipped++;
      continue;
    }

    // Ensure the row has an unsubscribe token; mint one lazily if missing
    // (older rows from before this migration won't have one).
    let token = user.unsubscribe_token;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, '');
      if (!DRY_RUN) {
        const { error: tokenErr } = await supabase
          .from(TABLE)
          .update({ unsubscribe_token: token })
          .eq('id', user.id);
        if (tokenErr) {
          console.warn(`[followups] id=${user.id} could not mint unsubscribe token: ${tokenErr.message || tokenErr}`);
        }
      }
    }
    const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?t=${encodeURIComponent(token)}`;

    const { html, text } = tpl.build({ name: user.name || 'there', unsubscribeUrl });
    const subject = tpl.subject;

    if (DRY_RUN) {
      console.log(`[followups] WOULD SEND id=${user.id} step=${step + 1}/${TEMPLATES.length} (${tpl.key}) -> ${user.email}  "${subject}"`);
      sent++;
      continue;
    }

    try {
      const sendArgs = {
        from: RESEND_FROM,
        to: user.email,
        subject,
        html,
        text,
        headers: {
          'X-Submission-Id': String(user.id),
          'X-Drip-Step': String(step + 1),
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };
      if (RESEND_REPLY_TO) sendArgs.replyTo = RESEND_REPLY_TO;

      const { data: emailData, error: sendErr } = await resend.emails.send(sendArgs);

      if (sendErr) {
        console.error(`[followups] id=${user.id} step=${step + 1} send failed: ${sendErr.message || sendErr}`);
        await supabase.from('contact_interactions').insert({
          submission_id: user.id,
          kind: 'followup_failed',
          subject,
          metadata: { step: step + 1, key: tpl.key, error: String(sendErr.message || sendErr) },
        });
        failed++;
        continue;
      }

      // Stamp the row immediately so a crash mid-batch doesn't double-send.
      const { error: bumpErr } = await supabase
        .from(TABLE)
        .update({
          followup_step: step + 1,
          last_followup_sent_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (bumpErr) {
        console.error(`[followups] id=${user.id} could not bump followup_step: ${bumpErr.message || bumpErr}`);
      }

      await supabase.from('contact_interactions').insert({
        submission_id: user.id,
        kind: 'followup_sent',
        subject,
        email_id: emailData?.id || null,
        metadata: { step: step + 1, key: tpl.key },
      });

      console.log(`[followups] sent id=${user.id} step=${step + 1}/${TEMPLATES.length} (${tpl.key}) -> ${user.email}  email_id=${emailData?.id}`);
      sent++;
    } catch (err) {
      console.error(`[followups] id=${user.id} unexpected error: ${err?.message || err}`);
      try {
        await supabase.from('contact_interactions').insert({
          submission_id: user.id,
          kind: 'followup_failed',
          subject,
          metadata: { step: step + 1, key: tpl.key, error: String(err?.message || err) },
        });
      } catch { /* swallow */ }
      failed++;
    }
  }

  console.log(`[followups] done. sent=${sent} failed=${failed} skipped=${skipped}`);
}

main().catch((err) => {
  console.error('[followups] fatal:', err?.stack || err);
  process.exit(1);
});