-- v25: configurable entity colors for dashboard job cards

ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS color_hex text DEFAULT '#6B6660';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS color_hex text DEFAULT '#6B6660';

CREATE TABLE IF NOT EXISTS entity_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key text NOT NULL UNIQUE,
  color_hex text NOT NULL DEFAULT '#D4AF37',
  created_at timestamptz DEFAULT now()
);

INSERT INTO entity_colors (entity_key, color_hex)
VALUES ('private', '#D4AF37')
ON CONFLICT (entity_key) DO NOTHING;
