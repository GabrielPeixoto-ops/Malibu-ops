-- migration_v26: casual packing crew + configurable commission system

-- Casual / Packing Crew (non-registered workers)
CREATE TABLE IF NOT EXISTS job_casual_crew (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  rate_per_hour numeric NOT NULL DEFAULT 0,
  start_time text,
  finish_time text,
  created_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE job_casual_crew ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN CREATE POLICY "anon full access" ON job_casual_crew FOR ALL TO anon USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON job_casual_crew FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Commission types catalogue
CREATE TABLE IF NOT EXISTS commission_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  rate_per_hour numeric NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Per-job commission assignments
CREATE TABLE IF NOT EXISTS job_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  commission_type_id uuid REFERENCES commission_types(id),
  employee_id uuid REFERENCES employees(id),
  rate_per_hour numeric NOT NULL,
  hours numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE commission_types ENABLE ROW LEVEL SECURITY;
  ALTER TABLE job_commissions ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN CREATE POLICY "anon full access" ON commission_types FOR ALL TO anon USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON commission_types FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon full access" ON job_commissions FOR ALL TO anon USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON job_commissions FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
