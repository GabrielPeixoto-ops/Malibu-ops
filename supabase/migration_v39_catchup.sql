-- =============================================================================
-- migration_v39_catchup — Full catch-up for all pending migrations
-- Safe to run even if some parts were already applied (IF NOT EXISTS / DO guards).
-- Applies: v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, plus override_revenue.
-- Order matters: casual_workers must exist before job_casual_crew.casual_worker_id FK,
-- and invoices before xero columns and invoice_jobs.
-- =============================================================================

-- ─── v32 first: casual_workers (needed by v37 FK on job_commissions) ─────────

CREATE TABLE IF NOT EXISTS casual_workers (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                         text        NOT NULL,
  rate_per_hour                numeric     NOT NULL DEFAULT 0,
  phone                        text,
  notes                        text,
  referrer_id                  uuid        REFERENCES employees(id),
  referrer_commission_per_hour numeric     NOT NULL DEFAULT 0,
  created_at                   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN ALTER TABLE casual_workers ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON casual_workers FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS casual_workers_referrer_id_idx ON casual_workers (referrer_id);

-- ─── v31 + v32: job_casual_crew missing columns ───────────────────────────────

ALTER TABLE job_casual_crew
  ADD COLUMN IF NOT EXISTS cof_share boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hours     numeric  NOT NULL DEFAULT 0;

ALTER TABLE job_casual_crew
  ADD COLUMN IF NOT EXISTS casual_worker_id uuid REFERENCES casual_workers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_casual_crew_casual_worker_id_idx ON job_casual_crew (casual_worker_id);

-- ─── v29: Invoice system ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoice_sequences (
  entity_type  text    NOT NULL,
  entity_id    text    NOT NULL DEFAULT '',
  last_seq     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id)
);

DO $$ BEGIN ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "invoice_sequences: authenticated read"  ON invoice_sequences FOR SELECT USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "invoice_sequences: authenticated write" ON invoice_sequences FOR ALL    USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS invoices (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text          NOT NULL,
  type           text          NOT NULL CHECK (type IN ('subcontractor', 'b2b_client', 'tmaat')),
  entity_id      text,
  entity_name    text          NOT NULL,
  period_from    date          NOT NULL,
  period_to      date          NOT NULL,
  status         text          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid')),
  total_amount   numeric(12,2) NOT NULL DEFAULT 0,
  notes          text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

DO $$ BEGIN ALTER TABLE invoices ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "invoices: authenticated read" ON invoices FOR SELECT USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "invoices: authenticated all"  ON invoices FOR ALL    USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS invoices_type_idx        ON invoices (type);
CREATE INDEX IF NOT EXISTS invoices_entity_id_idx   ON invoices (entity_id);
CREATE INDEX IF NOT EXISTS invoices_period_from_idx ON invoices (period_from);
CREATE INDEX IF NOT EXISTS invoices_status_idx      ON invoices (status);
CREATE INDEX IF NOT EXISTS invoices_created_at_idx  ON invoices (created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_jobs (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  job_id     uuid          NOT NULL REFERENCES jobs(id)     ON DELETE RESTRICT,
  amount     numeric(12,2) NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, job_id)
);

DO $$ BEGIN ALTER TABLE invoice_jobs ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "invoice_jobs: authenticated read" ON invoice_jobs FOR SELECT USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "invoice_jobs: authenticated all"  ON invoice_jobs FOR ALL    USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS invoice_jobs_invoice_id_idx ON invoice_jobs (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_jobs_job_id_idx     ON invoice_jobs (job_id);

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER invoices_set_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Trigger: generate invoice_number on insert
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_seq    integer;
  v_prefix text;
BEGIN
  INSERT INTO invoice_sequences (entity_type, entity_id, last_seq)
  VALUES (NEW.type, COALESCE(NEW.entity_id, ''), 1)
  ON CONFLICT (entity_type, entity_id)
  DO UPDATE SET last_seq = invoice_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_prefix := CASE NEW.type
    WHEN 'subcontractor' THEN 'INV-SUB'
    WHEN 'b2b_client'    THEN 'INV-B2B'
    WHEN 'tmaat'         THEN 'INV-TMAAT'
    ELSE                      'INV'
  END;

  NEW.invoice_number :=
    v_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 4, '0');

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER invoices_generate_number
    BEFORE INSERT ON invoices
    FOR EACH ROW
    WHEN (NEW.invoice_number IS NULL OR NEW.invoice_number = '')
    EXECUTE FUNCTION generate_invoice_number();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── v30: Xero integration ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS xero_tokens (
  id            int         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token  text        NOT NULL,
  refresh_token text        NOT NULL,
  expires_at    timestamptz NOT NULL,
  tenant_id     text        NOT NULL DEFAULT '',
  tenant_name   text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_id  text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_url text;

CREATE INDEX IF NOT EXISTS invoices_xero_invoice_id_idx
  ON invoices (xero_invoice_id)
  WHERE xero_invoice_id IS NOT NULL;

-- ─── v33: RLS for subcontractor_rates and contract_rates ─────────────────────

DO $$ BEGIN ALTER TABLE subcontractor_rates ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contract_rates      ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN CREATE POLICY "auth full access" ON subcontractor_rates FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON contract_rates      FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── v34 + v35: job_expenses ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_expenses (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid          NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description       text          NOT NULL,
  amount            decimal(10,2) NOT NULL,
  is_client_expense boolean       NOT NULL DEFAULT true,
  created_at        timestamptz   DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE job_expenses ADD COLUMN is_client_expense boolean NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN ALTER TABLE job_expenses ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage job_expenses"
    ON job_expenses FOR ALL TO authenticated
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── v36: paid_at on jobs ─────────────────────────────────────────────────────

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- ─── MISSING: override_revenue on jobs ───────────────────────────────────────
-- This column is referenced throughout the codebase (billing.ts, invoices page,
-- jobs page, calendar) but was never added in any migration file.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS override_revenue numeric;

-- ─── v37: casual_worker_id on job_commissions ────────────────────────────────
-- Requires casual_workers table (created above).

ALTER TABLE job_commissions
  ADD COLUMN IF NOT EXISTS casual_worker_id uuid REFERENCES casual_workers(id) ON DELETE SET NULL;

-- ─── v38: drop FK constraint on jobs.subcontractor_rate_id ───────────────────
-- Rates are stored in subcontractors.config.rateList (JSONB) with their own UUIDs.
-- The FK to subcontractor_rates was preventing those IDs from being saved.

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_subcontractor_rate_id_fkey;

-- ─── payment_due_date on jobs ─────────────────────────────────────────────────
-- Date by which client payment is expected (used for Invoice Later tracking).

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_due_date date;
