-- migration_v60: universal Fixed Price (flat $) override for jobs
--
-- Previously "Fixed Rate" only existed for Private jobs (private_rate_fixed*
-- columns, migration_v56). This adds an equivalent, but client-type-agnostic,
-- override that works for Private, Subcontract, and Contract jobs alike: when
-- fixed_price is true, fixed_price_amount becomes the job's entire base
-- revenue, replacing whatever the selected rate/ratecard/formula/percent-split
-- would otherwise have computed. Crew payroll is completely unaffected.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fixed_price boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fixed_price_desc text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fixed_price_amount numeric;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fixed_price_gst_exclusive boolean DEFAULT false;
