-- Migration v19 — Fleet real data + Employees expanded fields

-- ─── Clear test fleet data (only rows added in the last day) ─────────────────
DELETE FROM fleet WHERE created_at > now() - interval '1 day';

-- ─── Insert real Malibu fleet ─────────────────────────────────────────────────
INSERT INTO fleet (name, model, registration, size, cargo_capacity_cbm, actuals_cbm, height_clearance, internal_height, tailgate, tonnes, selling_points, is_active)
VALUES
  ('Truck 1', 'HINO 300 617',                  'CM39SK', 'large', 40, 33, '3.7M', '2.6M', 'RAMP', 8,   'SOLD AS 4.5T, 6T AND 8T',          true),
  ('Truck 2', 'MITSUBISHI FUSO CANTER 2013',   'DE26GK', 'large', 35, 29, '3.5M', '2.5M', 'RAMP', 6,   'SOLD AS 4.5T AND 6T',               true),
  ('Truck 3', 'ISUZU NPR 250 2006',            'AJ90YT', 'large', 30, 26, '3.2M', '2.3M', 'TGL',  6,   'SOLD AS 4.5T AND 6T',               true),
  ('Truck 4', 'MITSUBISHI FUSO CANTER 2010',   'DB51FF', 'small', 25, 22, '3.2M', '2.3M', 'TGL',  4.5, 'SOLD AS 3T AND 4.5T',               true),
  ('Truck 5', 'MITSUBISHI FUSO CANTER 2011',   'DJ73UN', 'small', 20, 18, '3.0M', '2.1M', 'TGL',  3,   'SOLD AS 3T',                        true),
  ('Truck 6', 'HINO 300 616',                  'DK50UP', 'small', 20, 16, '3.0M', '2.0M', 'TGL',  3,   'SOLD AS 3T — TMAAT BRANDED',        true)
ON CONFLICT DO NOTHING;

-- ─── Employees expanded fields ────────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS age                         int;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_type                   text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS english_level               text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone_type                  text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_status           text DEFAULT 'full_time';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email                       text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone                       text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS drivers_license             text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS drivers_license_expiry      date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS passport                    text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name      text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone     text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_relation  text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS document_url                text;

-- ─── Storage bucket for employee documents ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-docs', 'employee-docs', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "auth upload employee-docs"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'employee-docs');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth read employee-docs"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'employee-docs');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth delete employee-docs"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'employee-docs');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
