-- =============================================================================
-- PostgreSQL Row Level Security (RLS) — defense-in-depth tenant isolation
-- =============================================================================
-- Column name note: Prisma uses camelCase, so the column is "tenantId"
-- (quoted in PostgreSQL).

-- Enable RLS on all tenant-owned tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'Tenant', 'Organization', 'Brand', 'Product', 'Customer', 'Audience',
      'Creative', 'Campaign', 'AdSet', 'Ad', 'Interaction', 'Connector',
      'RawRecord', 'Event', 'Edge', 'Experiment', 'CausalEstimate',
      'Recommendation', 'Decision', 'Approval', 'Workflow', 'WorkflowStep',
      'AgentRun', 'AgentToolCall', 'AuditLog', 'Policy', 'CapitalLedgerEntry',
      'GrowthExperiment', 'Prospect', 'Outreach', 'ContentAsset', 'DiagnosticRun'
    ])
  LOOP
    EXECUTE format('ALTER TABLE "%s" ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- Tenant table: allow reading all (needed for auth lookup)
-- Other tables: enforce "tenantId" = session variable
CREATE POLICY tenant_read_all ON "Tenant" FOR SELECT USING (true);

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'Organization', 'Brand', 'Product', 'Customer', 'Audience', 'Creative',
      'Campaign', 'AdSet', 'Ad', 'Interaction', 'Connector', 'RawRecord',
      'Event', 'Edge', 'Experiment', 'CausalEstimate', 'Recommendation',
      'Decision', 'Approval', 'Workflow', 'AgentRun',
      'AgentToolCall', 'AuditLog', 'Policy', 'CapitalLedgerEntry',
      'GrowthExperiment', 'Prospect', 'Outreach', 'ContentAsset', 'DiagnosticRun'
    ])
    -- Note: WorkflowStep excluded (no tenantId column — protected via FK to Workflow)
  LOOP
    EXECUTE format(
      'CREATE POLICY rls_%s ON "%s" FOR ALL USING ("tenantId" = current_setting(''app.tenant_id'', true)::text) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true)::text)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- User: nullable tenantId — allow all (auth handles isolation)
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_all ON "User" FOR ALL USING (true) WITH CHECK (true);

-- WaitlistEntry + SecretRef: no tenantId, admin-managed
ALTER TABLE "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY waitlist_admin ON "WaitlistEntry" FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE "SecretRef" ENABLE ROW LEVEL SECURITY;
CREATE POLICY secretref_admin ON "SecretRef" FOR ALL USING (true) WITH CHECK (true);
