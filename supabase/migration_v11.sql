-- Customer phone / secondary contact
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_contact_name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_contact_phone text;

-- Payment fields (for paid status)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_date date;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_methods text[] NOT NULL DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_cash_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_transfer_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_card_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_collected_by text;

-- Cancellation fields
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS minimum_charge_applied boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS minimum_charge_amount numeric NOT NULL DEFAULT 0;
