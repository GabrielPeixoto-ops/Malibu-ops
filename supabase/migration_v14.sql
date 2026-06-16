-- Private rates table
CREATE TABLE IF NOT EXISTS private_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  trucks int NOT NULL DEFAULT 1,
  truck_size text NOT NULL DEFAULT 'small',
  men int NOT NULL DEFAULT 2,
  rate_per_hour numeric NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Job fields for private billing
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_id uuid REFERENCES private_rates(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_custom boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_custom_desc text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private_rate_custom_price numeric;
-- Seeds
DELETE FROM private_rates;
INSERT INTO private_rates (name, trucks, truck_size, men, rate_per_hour, sort_order) VALUES
  ('1 Small Truck + 2 Men', 1, 'small', 2, 160.00, 1),
  ('1 Small Truck + 3 Men', 1, 'small', 3, 200.00, 2),
  ('1 Large Truck + 2 Men', 1, 'large', 2, 190.00, 3),
  ('1 Large Truck + 3 Men', 1, 'large', 3, 230.00, 4),
  ('2 Small Trucks + 4 Men', 2, 'small', 4, 300.00, 5),
  ('2 Large Trucks + 4 Men', 2, 'large', 4, 360.00, 6),
  ('2 Large Trucks + 5 Men', 2, 'large', 5, 420.00, 7),
  ('3 Large Trucks + 6 Men', 3, 'large', 6, 550.00, 8);
