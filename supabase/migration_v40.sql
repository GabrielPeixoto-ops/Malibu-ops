-- migration_v40: separate client-billed COF from crew COF
-- Allows charging a different Call Out Fee to the client than what the crew receives.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_cof_override boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_cof_hours    numeric;
