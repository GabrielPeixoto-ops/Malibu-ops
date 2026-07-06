-- migration_v38: drop FK constraint on jobs.subcontractor_rate_id
-- Rates are now stored in subcontractors.config.rateList (JSONB) with their own UUIDs.
-- The FK to subcontractor_rates was preventing those IDs from being saved.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_subcontractor_rate_id_fkey;
