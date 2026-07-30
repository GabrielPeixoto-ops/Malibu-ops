-- migration_v56: Fixed Rate billing option for Private jobs
--
-- Office asked for a "Fixed Rate" option (e.g. "2 Packers (4 hours minimum) —
-- Fixed Rate") alongside the existing rate-card / custom-price options for
-- Private jobs. It's a single flat $ amount billed to the client for the
-- whole job, independent of hours worked. Mutually exclusive with
-- private_rate_id / private_rate_custom. Never touches crew payroll — crew
-- are still paid normally from their own start/end times; this only changes
-- what the client is billed.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_fixed boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_fixed_desc text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_fixed_price numeric;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_fixed_gst_exclusive boolean DEFAULT false;
