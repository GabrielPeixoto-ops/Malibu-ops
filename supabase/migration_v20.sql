-- migration_v20: contract expansion fields

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_company_name text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS payment_terms text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
