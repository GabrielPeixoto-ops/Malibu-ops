-- migration_v21: subcontract service detail columns

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS subcontractor_service_type text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS subcontractor_trucks text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS subcontractor_crew_size int;
