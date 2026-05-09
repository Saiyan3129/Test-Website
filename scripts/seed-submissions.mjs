#!/usr/bin/env node
//
// Seeds the contact_submissions table with 20 realistic test rows for the
// admin dashboard. Inserts directly via the Supabase service-role client so
// the /api/contact pipeline (Resend, Sheets) does NOT fire — no test emails,
// no Sheets archive churn.
//
// Every test row's email ends with @arca-seed.test. To remove them all:
//
//   delete from public.contact_submissions where email like '%@arca-seed.test';
//
// Usage:
//   node scripts/seed-submissions.mjs              # insert
//   node scripts/seed-submissions.mjs --dry-run    # print plan, insert nothing
//   node scripts/seed-submissions.mjs --count=20   # custom row count
//   node scripts/seed-submissions.mjs --clean      # delete previous test rows first

import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const TABLE = process.env.SUPABASE_CONTACT_TABLE || 'contact_submissions';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SEED_DOMAIN = 'arca-seed.test';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CLEAN = args.includes('--clean');
const COUNT = (() => {
  const a = args.find((x) => x.startsWith('--count='));
  const n = a ? Number(a.split('=')[1]) : 20;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 20;
})();

const NAMES = [
  'Amelia Whitcombe',     'Theo Lindqvist',     'Saoirse Brennan',
  'Marcus Adeyemi',       'Iris Takahashi',     'Felix Romero',
  'Naima Bensaid',        'Oskar Holmberg',     'Elena Petrov',
  'Hugo Alarcón',         'Yumi Nakashima',     'Bertrand Vasseur',
  'Zara Devereux',        'Caleb Okonkwo',      'Aurelia Marchetti',
  'Sebastián Aguilar',    'Helena Voss',        'Nikolai Sorensen',
  'Priya Ramaswamy',      'Cosmo Whittaker',    'Genevieve Laurent',
  'Mateo Salazar',        'Astrid Halvorsen',   'Tobias Kiefer',
  'Lucia Esposito',
];

const MESSAGES = [
  "Saw the Dover Street window last Tuesday — is the suede penny still being cut in chestnut, or only the new oxblood?",
  "Could you confirm the pad density on the Atelier Studio insole? I walk a lot of city stone and the standard last bites at the heel by mile three.",
  "Coming through London the second week of next month — would I be able to book a fitting at the SoHo studio? Happy to come on a quiet afternoon.",
  "I bought a pair of the cream loafers in spring and the upper has creased beautifully. Do you ever do a polish service for returning customers?",
  "Question about lead times: ordering a bespoke pair this month, when would you reasonably expect a December delivery to be possible?",
  "Just wanted to say the press shoot in the rooftop courtyard issue was extraordinary. Whoever directed that — please pass on a small bow from me.",
  "Curious about widths beyond the standard last. I've been a 9.5 EE my whole life and most ateliers stop at E.",
  "Is the Burj Khalifa edition open to non-residents of the UAE, or is that strictly a regional release?",
  "I keep a small reference library of footwear documentation. Would the studio be open to a short interview about last-shaping for a private essay?",
  "My partner ordered the silver-tab loafer two seasons ago and the box was lost in transit. We have the order number — could someone help us replace the storage bag?",
  "On the wedding capsule — are the satin uppers polishable, or is it strictly a one-evening shoe?",
  "Hello, could you tell me whether the Tester device pairs with the new Apollo pads, or does it require the older mounting bracket?",
  "I attended the Seven Dials opening in October. Has there been any progress on the planned New York studio?",
  "Bit of a long shot — I'm sourcing materials for a commission and would love to know who supplies the cordwain you use for the Studio range.",
  "What is the warranty policy on the carbon-fibre soles? I've had mine three winters and the edge is starting to chip near the toe-spring.",
  "Genuine note of thanks. The shoes I bought for my father in 2014 still sit on his rack — he wore them to my wedding last weekend.",
  "Is there a way to be added to the list for the next archive sale? I've been watching for the brown reverse-calf chukka for two years.",
  "Question on care: would you recommend the saphir cream or the dubbin for the suede oxford in winter?",
  "Following up on order #4412 — the second shipping notification arrived but the package never came. Customer support said to write here.",
  "Hi, totally separate from any purchase — I'm a small atelier in Lisbon, would you ever consider a guest workshop visit?",
  "Spent twenty minutes admiring the goldwork on the Atelier Studio capsule lookbook. Stunning. Are prints of those photographs available?",
  "I might have entered my email wrong on a previous form — could you confirm if my note from last Friday came through?",
  "On the Sights collection — is the Burj edit limited to thirty pairs total or thirty per size?",
  "Do you offer half-sizes in the new Studio loafer? Mine sit between a 41 and a 42.",
  "The Dover Street tailor mentioned a bespoke programme launching in spring. Is there a list I can join?",
];

const REPLY_STATUSES = [
  'pending', 'pending', 'pending', 'pending', 'pending', 'pending',  // 6× pending
  'replied', 'replied', 'replied', 'replied', 'replied',             // 5× replied
  'archived', 'archived',                                            // 2× archived
  'spam',                                                            // 1× spam
];
const NEWSLETTER_STATUSES = ['pending', 'subscribed', 'subscribed', 'unsubscribed'];
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
];
const IPS = [
  '203.0.113.42', '198.51.100.17', '192.0.2.88', '203.0.113.196',
  '198.51.100.231', '192.0.2.4', '203.0.113.51', '198.51.100.7',
];

function pick(arr, i) { return arr[i % arr.length]; }
function pickRand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function emailFor(name, i) {
  const slug = name.toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, '.')
    .slice(0, 24);
  return `${slug}.${String(i + 1).padStart(2, '0')}@${SEED_DOMAIN}`;
}

function buildRow(i) {
  const name = pick(NAMES, i);
  const message = pick(MESSAGES, i);
  const newsletter = i % 3 !== 0; // ~2/3 opt in
  const reply_status = pick(REPLY_STATUSES, i);
  const newsletter_status = newsletter ? pick(NEWSLETTER_STATUSES, i + 1) : 'pending';
  // Spread created_at across the last ~21 days, freshest first
  const minutesAgo = i * (60 * 24) + Math.floor(Math.random() * 60 * 12);
  const created_at = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  const followup_step = newsletter && newsletter_status === 'subscribed' ? Math.floor(Math.random() * 3) : 0;
  const last_followup_sent_at = followup_step > 0
    ? new Date(Date.now() - (minutesAgo - 60 * 24) * 60 * 1000).toISOString()
    : null;
  return {
    name,
    email: emailFor(name, i),
    message,
    newsletter,
    newsletter_status,
    reply_status,
    followup_step,
    last_followup_sent_at,
    ip: pickRand(IPS),
    user_agent: pickRand(USER_AGENTS),
    unsubscribe_token: crypto.randomUUID().replace(/-/g, ''),
    created_at,
  };
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (CLEAN) {
    if (DRY_RUN) {
      console.log(`[dry-run] would delete rows where email like %@${SEED_DOMAIN}`);
    } else {
      const { error, count } = await supabase
        .from(TABLE)
        .delete({ count: 'exact' })
        .like('email', `%@${SEED_DOMAIN}`);
      if (error) { console.error('Clean failed:', error.message); process.exit(1); }
      console.log(`Removed ${count ?? 0} previous test row(s).`);
    }
  }

  const rows = Array.from({ length: COUNT }, (_, i) => buildRow(i));

  if (DRY_RUN) {
    console.log(`[dry-run] would insert ${rows.length} row(s) into ${TABLE}:`);
    for (const r of rows) {
      console.log(`  - ${r.name.padEnd(22)} ${r.email.padEnd(48)} ${r.reply_status.padEnd(8)} ${r.newsletter ? 'NL' : '  '} ${r.created_at}`);
    }
    return;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert(rows)
    .select('id, name, email, created_at');

  if (error) {
    console.error('Insert failed:', error.message || error);
    process.exit(1);
  }

  console.log(`Inserted ${data.length} test submission(s) into ${TABLE}.`);
  console.log(`Domain tag for cleanup: @${SEED_DOMAIN}`);
  console.log('Sample IDs:', data.slice(0, 5).map((r) => r.id).join(', '));
}

main().catch((err) => { console.error(err); process.exit(1); });