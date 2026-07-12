-- migration_v43: heavy item support
-- heavy_item on job_crew / job_casual_crew: per-person +0.5h payroll bonus
-- heavy_item_charge on jobs: optional client charge (inc. GST, treated like client expenses)

ALTER TABLE job_crew ADD COLUMN IF NOT EXISTS heavy_item boolean DEFAULT false;
ALTER TABLE job_casual_crew ADD COLUMN IF NOT EXISTS heavy_item boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS heavy_item_charge numeric;
