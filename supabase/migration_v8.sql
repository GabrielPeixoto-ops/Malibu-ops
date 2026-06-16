-- Migration v8 — run in Supabase SQL Editor
-- Allow subcontractor_id to be NULL for private/contract jobs

ALTER TABLE jobs ALTER COLUMN subcontractor_id DROP NOT NULL;
