-- migration_v45: rate blocks (crew/truck size changes mid-job) + extra man hourly client rate
--
-- job_rate_blocks: a Private/Contract job's day can be billed in multiple
-- segments at different rates (e.g. starts "2 Men & 1 Truck", becomes
-- "3 Men & 1 Truck", then "4 Men & 2 Trucks") instead of one flat rate for
-- the whole job. label/rate_per_hour are stored as resolved values (not just
-- a foreign key) so historical jobs keep showing the rate that was actually
-- charged even if the rate card changes later — same convention as
-- job_extra_men's free-text name/rate.
--
-- job_extra_men.client_rate_per_hour: the hourly rate charged to the client
-- for an extra man, so client_charge_amount can be computed as hours × rate
-- instead of a manually-typed flat guess.

CREATE TABLE IF NOT EXISTS job_rate_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  label text,
  rate_per_hour numeric NOT NULL DEFAULT 0,
  start_time text,
  finish_time text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE job_extra_men ADD COLUMN IF NOT EXISTS client_rate_per_hour numeric DEFAULT 0;
