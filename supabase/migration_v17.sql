CREATE TABLE IF NOT EXISTS material_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sale_price numeric DEFAULT 0,
  cost_price numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

INSERT INTO material_catalog (name, sale_price, sort_order) VALUES
  ('Small Box',            5.50,  1),
  ('Medium Box',           6.00,  2),
  ('Large Box',            6.50,  3),
  ('Port-a-robe',         30.00,  4),
  ('Tape',                 2.50,  5),
  ('Shrink Wrap',         30.00,  6),
  ('Butcher Paper 15kg',  65.00,  7),
  ('Bubble Wrap 750x25m', 49.00,  8)
ON CONFLICT DO NOTHING;
