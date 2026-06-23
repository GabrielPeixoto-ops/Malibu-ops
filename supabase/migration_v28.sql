-- migration_v28: contractor_job_id, gross_job_value, malibu_revenue, invoice config per subcontractor

-- Jobs: contractor reference + percentage billing fields
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contractor_job_id text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS gross_job_value decimal(10,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS malibu_revenue decimal(10,2);

-- Subcontractors: invoice configuration
ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS invoice_number_prefix text;
ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS next_invoice_number integer;
ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS invoice_frequency text DEFAULT 'weekly';
ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS invoice_due_days integer DEFAULT 7;

-- Set initial invoice numbers for known subcontractors
UPDATE subcontractors SET next_invoice_number = 3158 WHERE name = 'Giraffe';
UPDATE subcontractors SET next_invoice_number = 3159 WHERE name = 'Holloway';
UPDATE subcontractors SET next_invoice_number = 3284 WHERE name = 'Mayfair Removals';
UPDATE subcontractors SET next_invoice_number = 3002 WHERE name = 'Sort & Sell';
UPDATE subcontractors SET next_invoice_number = 2092 WHERE name = 'Four Pillars';
