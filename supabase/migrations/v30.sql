-- v30 — Xero integration
-- Applied manually on 2026-06-29.
-- Tables: xero_tokens
-- Columns: invoices.xero_invoice_id, invoices.xero_invoice_url

-- ── xero_tokens ───────────────────────────────────────────────────────────────
-- Single-row system table accessed only from server-side API routes.
-- No RLS — anon key can read/write because this is server-side only.
create table if not exists xero_tokens (
  id            int         primary key default 1 check (id = 1),
  access_token  text        not null,     -- AES-256-GCM encrypted
  refresh_token text        not null,     -- AES-256-GCM encrypted
  expires_at    timestamptz not null,
  tenant_id     text        not null default '',
  tenant_name   text,
  updated_at    timestamptz not null default now()
);

-- ── Add Xero fields to invoices ───────────────────────────────────────────────
alter table invoices
  add column if not exists xero_invoice_id  text,
  add column if not exists xero_invoice_url text;

create index if not exists invoices_xero_invoice_id_idx
  on invoices (xero_invoice_id)
  where xero_invoice_id is not null;
