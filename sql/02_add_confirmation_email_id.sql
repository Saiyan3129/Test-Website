-- Adds the column we use to match a Resend inbound reply back to its original
-- contact submission. The reply's `In-Reply-To` header carries the message ID
-- that Resend assigned when we sent the confirmation, so we look up by that.
--
-- Run this in Supabase Dashboard → SQL Editor → New query → Run.

alter table public.contact_submissions
  add column if not exists confirmation_email_id text;

create index if not exists contact_submissions_confirmation_email_id_idx
  on public.contact_submissions (confirmation_email_id);