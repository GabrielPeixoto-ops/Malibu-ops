-- migration_v42: contract job pricing support
-- contract_rate_custom_price: optional per-job rate override (supersedes contract_rates dropdown)
-- contract_client_name:       free-text client name (replaces contract_client_id FK for new saves)

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_rate_custom_price numeric;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_client_name text;
