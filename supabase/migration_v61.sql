-- migration_v61: job "Needs Attention" flag + reporting support
--
-- Owner wants to be able to flag a job that needs attention or had an
-- issue (damage, dispute, etc.), visible on the Invoices page and the
-- new Reporting page. This is a simple, source-agnostic flag on the job
-- itself (works for Private/Subcontract/Contract jobs alike).
--
-- Diesel-price baseline for truck cost reporting is intentionally NOT a
-- new column: it is derived from the existing fleet_fuel_logs table
-- (avg cost/litre over the selected period), so no schema change is
-- needed for that part of the request.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS flagged boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS flag_note text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS flagged_at timestamptz;
