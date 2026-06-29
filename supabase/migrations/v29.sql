-- v29 — Invoice system
-- Applied manually on 2026-06-29.
-- Tables: invoice_sequences, invoices, invoice_jobs
-- Trigger: auto-increment invoice number on insert
-- RLS policies + indexes

-- ── invoice_sequences ─────────────────────────────────────────────────────────
-- Tracks the last sequence number per (type, entity_id) pair so each
-- entity/category gets its own independent numbering series.
create table if not exists invoice_sequences (
  entity_type  text    not null,
  entity_id    text    not null default '',
  last_seq     integer not null default 0,
  primary key (entity_type, entity_id)
);

alter table invoice_sequences enable row level security;

create policy "invoice_sequences: authenticated read"
  on invoice_sequences for select
  using (auth.role() = 'authenticated');

create policy "invoice_sequences: authenticated write"
  on invoice_sequences for all
  using (auth.role() = 'authenticated');

-- ── invoices ──────────────────────────────────────────────────────────────────
create table if not exists invoices (
  id             uuid        primary key default gen_random_uuid(),
  invoice_number text        not null,
  type           text        not null check (type in ('subcontractor', 'b2b_client', 'tmaat')),
  entity_id      text,
  entity_name    text        not null,
  period_from    date        not null,
  period_to      date        not null,
  status         text        not null default 'draft'
                             check (status in ('draft', 'sent', 'paid')),
  total_amount   numeric(12,2) not null default 0,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table invoices enable row level security;

create policy "invoices: authenticated read"
  on invoices for select
  using (auth.role() = 'authenticated');

create policy "invoices: authenticated all"
  on invoices for all
  using (auth.role() = 'authenticated');

create index if not exists invoices_type_idx        on invoices (type);
create index if not exists invoices_entity_id_idx   on invoices (entity_id);
create index if not exists invoices_period_from_idx on invoices (period_from);
create index if not exists invoices_status_idx      on invoices (status);
create index if not exists invoices_created_at_idx  on invoices (created_at desc);

-- ── invoice_jobs ──────────────────────────────────────────────────────────────
-- Junction: which jobs are included in each invoice, and the billed amount.
create table if not exists invoice_jobs (
  id         uuid        primary key default gen_random_uuid(),
  invoice_id uuid        not null references invoices(id) on delete cascade,
  job_id     uuid        not null references jobs(id)     on delete restrict,
  amount     numeric(12,2) not null default 0,
  unique (invoice_id, job_id)
);

alter table invoice_jobs enable row level security;

create policy "invoice_jobs: authenticated read"
  on invoice_jobs for select
  using (auth.role() = 'authenticated');

create policy "invoice_jobs: authenticated all"
  on invoice_jobs for all
  using (auth.role() = 'authenticated');

create index if not exists invoice_jobs_invoice_id_idx on invoice_jobs (invoice_id);
create index if not exists invoice_jobs_job_id_idx     on invoice_jobs (job_id);

-- ── Trigger: keep updated_at current ─────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger invoices_set_updated_at
  before update on invoices
  for each row execute function set_updated_at();

-- ── Trigger: generate invoice_number on insert ────────────────────────────────
-- Atomically increments the sequence for (type, entity_id) and builds a
-- human-readable number: INV-SUB-2026-0001 / INV-B2B-2026-0001 / INV-TMAAT-2026-0001
create or replace function generate_invoice_number()
returns trigger language plpgsql as $$
declare
  v_seq    integer;
  v_prefix text;
begin
  insert into invoice_sequences (entity_type, entity_id, last_seq)
  values (new.type, coalesce(new.entity_id, ''), 1)
  on conflict (entity_type, entity_id)
  do update set last_seq = invoice_sequences.last_seq + 1
  returning last_seq into v_seq;

  v_prefix := case new.type
    when 'subcontractor' then 'INV-SUB'
    when 'b2b_client'    then 'INV-B2B'
    when 'tmaat'         then 'INV-TMAAT'
    else                      'INV'
  end;

  new.invoice_number :=
    v_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 4, '0');

  return new;
end;
$$;

create trigger invoices_generate_number
  before insert on invoices
  for each row
  when (new.invoice_number is null or new.invoice_number = '')
  execute function generate_invoice_number();
