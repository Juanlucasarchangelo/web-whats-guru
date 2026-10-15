/*
# Converso CRM - Core: Organizations and Members

Creates the multi-tenant root tables. Both tables are created first,
then RLS and policies are applied so cross-references resolve.

## New Tables
1. organizations - Multi-tenant root, each represents a company
2. org_members - User membership in organizations with roles (owner/admin/agent)
*/

-- Create tables first (no policies yet)
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'agent',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

-- Now enable RLS and add policies (both tables exist)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_orgs" ON organizations;
CREATE POLICY "select_own_orgs" ON organizations FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = organizations.id AND org_members.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_orgs" ON organizations;
CREATE POLICY "insert_own_orgs" ON organizations FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_orgs" ON organizations;
CREATE POLICY "update_own_orgs" ON organizations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = organizations.id AND org_members.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = organizations.id AND org_members.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_orgs" ON organizations;
CREATE POLICY "delete_own_orgs" ON organizations FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "select_org_membership" ON org_members;
CREATE POLICY "select_org_membership" ON org_members FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_org_membership" ON org_members;
CREATE POLICY "insert_org_membership" ON org_members FOR INSERT
  TO authenticated WITH CHECK (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = org_members.org_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin'))
  );

DROP POLICY IF EXISTS "update_org_membership" ON org_members;
CREATE POLICY "update_org_membership" ON org_members FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = org_members.org_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = org_members.org_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin'))
  );

DROP POLICY IF EXISTS "delete_org_membership" ON org_members;
CREATE POLICY "delete_org_membership" ON org_members FOR DELETE
  TO authenticated USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = org_members.org_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin'))
  );
