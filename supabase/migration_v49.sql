-- migration_v49: per-subcontractor "round up to 15-min block" toggle
--
-- subcontractors.round_up_hours: when true (default, existing behaviour for
-- every subcontractor), worked hours are rounded UP to the next 15-minute
-- block everywhere they're computed (job summary, Individual Crew Hours,
-- payroll, invoices, dashboard). When false, hours are used as plain decimal
-- (rounded to 2 decimal places only, e.g. 5h48m -> 5.80h) with no block
-- rounding — this matches TMAAT's own portal, which reports exact decimal
-- hours rather than rounding up. Set to false for TMAAT / TMAAT TT so our
-- crew payroll and reported hours reconcile with what TMAAT's system shows,
-- instead of overstating hours (and therefore payroll cost) on their jobs.

ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS round_up_hours boolean NOT NULL DEFAULT true;

UPDATE subcontractors SET round_up_hours = false WHERE name ilike '%tmaat%';
