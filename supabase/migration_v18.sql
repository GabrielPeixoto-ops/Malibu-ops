-- =============================================================================
-- Migration v18 — Comprehensive catch-up
-- Safe to run at any migration level: all statements use IF NOT EXISTS / DO guards.
-- Adds every column / table the application code expects that may be missing.
-- =============================================================================

-- ─── Enums ───────────────────────────────────────────────────────────────────

-- 'reviewed' status (added v2)
DO $$ BEGIN
  ALTER TYPE job_status_enum ADD VALUE IF NOT EXISTS 'reviewed' AFTER 'completed';
EXCEPTION WHEN others THEN NULL;
END $$;

-- job_source_enum (added v7)
DO $$ BEGIN
  CREATE TYPE job_source_enum AS ENUM ('private', 'contract', 'subcontract');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Tables that must exist before FK references ──────────────────────────────

CREATE TABLE IF NOT EXISTS contracts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  billing_type   text        NOT NULL DEFAULT 'ratecard',
  billing_config jsonb       NOT NULL DEFAULT '{}'::jsonb,
  google_review_bonus boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private_rates (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text    NOT NULL,
  trucks       int     NOT NULL DEFAULT 1,
  truck_size   text    NOT NULL DEFAULT 'small',
  men          int     NOT NULL DEFAULT 2,
  rate_per_hour numeric NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int     NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fleet (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text    NOT NULL,
  model              text,
  registration       text,
  size               text,
  cargo_capacity_cbm int,
  actuals_cbm        int,
  height_clearance   text,
  internal_height    text,
  tailgate           text,
  default_driver     text,
  selling_points     text,
  notes              text,
  tonnes             numeric,
  is_active          boolean DEFAULT true,
  created_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_catalog (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text    NOT NULL,
  sale_price numeric DEFAULT 0,
  cost_price numeric DEFAULT 0,
  is_active  boolean DEFAULT true,
  sort_order int     DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ─── jobs columns ─────────────────────────────────────────────────────────────

-- v2
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS extra_men_hours numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS break_minutes   numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cof_final       numeric(10,2);

-- v3
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_notes text;

-- v5
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_start_time  text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_finish_time text;

-- v6
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS extra_man_employee_id uuid REFERENCES employees(id);

-- v7
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source               job_source_enum NOT NULL DEFAULT 'subcontract';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_id          uuid REFERENCES contracts(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_client_id   uuid REFERENCES contract_clients(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_billing_config jsonb;

-- v8: allow subcontractor_id to be NULL for private/contract jobs
ALTER TABLE jobs ALTER COLUMN subcontractor_id DROP NOT NULL;

-- v10
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS google_review              boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS google_review_employee_ids uuid[]  NOT NULL DEFAULT '{}';

-- v11
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_date             date;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_methods          text[]  NOT NULL DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_cash_amount      numeric NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_transfer_amount  numeric NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_card_amount      numeric NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_collected_by     text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_reason      text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS minimum_charge_applied   boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS minimum_charge_amount    numeric NOT NULL DEFAULT 0;

-- v12
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_time time;

-- v13
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reference_number text;

-- v14
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_id          uuid REFERENCES private_rates(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_custom      boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_custom_desc  text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_custom_price numeric;

-- v15: drop private_add_gst (was briefly added and removed)
ALTER TABLE jobs DROP COLUMN IF EXISTS private_add_gst;

-- ─── job_crew columns ─────────────────────────────────────────────────────────

-- v4
ALTER TABLE job_crew ADD COLUMN IF NOT EXISTS start_time text;
ALTER TABLE job_crew ADD COLUMN IF NOT EXISTS end_time   text;

-- v12
ALTER TABLE job_crew ADD COLUMN IF NOT EXISTS cof_hours numeric NOT NULL DEFAULT 0.5;

-- ─── job_photos table + category column ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_photos (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url        text        NOT NULL,
  caption    text,
  category   text        NOT NULL DEFAULT 'completion',
  created_at timestamptz DEFAULT now()
);

-- ─── job_trucks table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_trucks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid REFERENCES jobs(id) ON DELETE CASCADE,
  fleet_id   uuid REFERENCES fleet(id),
  created_at timestamptz DEFAULT now()
);

-- ─── customers extra columns ──────────────────────────────────────────────────

ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone                    text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_contact_name   text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_contact_phone  text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_type             text  DEFAULT 'ratecard';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_config           jsonb DEFAULT '{}'::jsonb;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS google_review_bonus      boolean NOT NULL DEFAULT false;

-- ─── subcontractors extra columns ─────────────────────────────────────────────

ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS google_review_bonus boolean NOT NULL DEFAULT false;

-- ─── contracts extra columns ──────────────────────────────────────────────────

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS google_review_bonus boolean NOT NULL DEFAULT false;

-- ─── RLS for new tables (permissive — matches existing app pattern) ────────────

DO $$ BEGIN
  ALTER TABLE contracts       ENABLE ROW LEVEL SECURITY;
  ALTER TABLE contract_clients ENABLE ROW LEVEL SECURITY;
  ALTER TABLE private_rates   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE fleet           ENABLE ROW LEVEL SECURITY;
  ALTER TABLE material_catalog ENABLE ROW LEVEL SECURITY;
  ALTER TABLE job_trucks      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE job_photos      ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN CREATE POLICY "anon full access" ON contracts        FOR ALL TO anon          USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON contracts        FOR ALL TO authenticated  USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon full access" ON contract_clients FOR ALL TO anon          USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON contract_clients FOR ALL TO authenticated  USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon full access" ON private_rates    FOR ALL TO anon          USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON private_rates    FOR ALL TO authenticated  USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon full access" ON fleet            FOR ALL TO anon          USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON fleet            FOR ALL TO authenticated  USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon full access" ON material_catalog FOR ALL TO anon          USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON material_catalog FOR ALL TO authenticated  USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon full access" ON job_trucks       FOR ALL TO anon          USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON job_trucks       FOR ALL TO authenticated  USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon full access" ON job_photos       FOR ALL TO anon          USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON job_photos       FOR ALL TO authenticated  USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
