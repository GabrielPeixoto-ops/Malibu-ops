-- migration_v33: enable RLS and add authenticated policies for subcontractor_rates and contract_rates
-- These tables were created in v23 without RLS. v27 dropped the anon policy but never added authenticated.
-- This ensures authenticated users can SELECT/INSERT/UPDATE/DELETE regardless of how RLS was set up.

DO $$ BEGIN ALTER TABLE subcontractor_rates ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contract_rates ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN CREATE POLICY "auth full access" ON subcontractor_rates FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth full access" ON contract_rates FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
