-- v32 — Casual Workers registry + referral commissions
-- Covers v31 as well (cof_share + hours on job_casual_crew) in case it wasn't applied.

-- ── job_casual_crew: missing columns from v31 ─────────────────────────────────
ALTER TABLE job_casual_crew
  ADD COLUMN IF NOT EXISTS cof_share boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hours     numeric;

-- ── casual_workers: persistent registry of non-payroll workers ────────────────
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

-- ── job_casual_crew: link to casual_workers profile ───────────────────────────
ALTER TABLE job_casual_crew
  ADD COLUMN IF NOT EXISTS casual_worker_id uuid REFERENCES casual_workers(id);

CREATE INDEX IF NOT EXISTS job_casual_crew_casual_worker_id_idx ON job_casual_crew (casual_worker_id);
CREATE INDEX IF NOT EXISTS casual_workers_referrer_id_idx ON casual_workers (referrer_id);
