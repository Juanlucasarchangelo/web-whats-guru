/*
# Converso CRM - Teams, Contacts, Tags

## New Tables
1. teams - Teams within an organization
2. team_members - User membership in teams
3. contacts - Customer/contact records with CRM stage
4. tags - Labels for contacts and conversations
5. contact_tags - Junction table for contact-tag relationship

## Security
- RLS on all tables, scoped via org_members membership check
*/

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  avatar_url text,
  crm_stage text NOT NULL DEFAULT 'lead',
  crm_value numeric(12,2) DEFAULT 0,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_org_id ON contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_contacts_crm_stage ON contacts(org_id, crm_stage);

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

-- RLS
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;

-- Teams policies
DROP POLICY IF EXISTS "select_teams" ON teams;
CREATE POLICY "select_teams" ON teams FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = teams.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_teams" ON teams;
CREATE POLICY "insert_teams" ON teams FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = teams.org_id AND org_members.user_id = auth.uid() AND org_members.role IN ('owner', 'admin'))
  );
DROP POLICY IF EXISTS "update_teams" ON teams;
CREATE POLICY "update_teams" ON teams FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = teams.org_id AND org_members.user_id = auth.uid() AND org_members.role IN ('owner', 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = teams.org_id AND org_members.user_id = auth.uid() AND org_members.role IN ('owner', 'admin'))
  );
DROP POLICY IF EXISTS "delete_teams" ON teams;
CREATE POLICY "delete_teams" ON teams FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = teams.org_id AND org_members.user_id = auth.uid() AND org_members.role IN ('owner', 'admin'))
  );

-- Team members policies
DROP POLICY IF EXISTS "select_team_members" ON team_members;
CREATE POLICY "select_team_members" ON team_members FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM teams t JOIN org_members om ON om.org_id = t.org_id WHERE t.id = team_members.team_id AND om.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_team_members" ON team_members;
CREATE POLICY "insert_team_members" ON team_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM teams t JOIN org_members om ON om.org_id = t.org_id WHERE t.id = team_members.team_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin'))
  );
DROP POLICY IF EXISTS "delete_team_members" ON team_members;
CREATE POLICY "delete_team_members" ON team_members FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM teams t JOIN org_members om ON om.org_id = t.org_id WHERE t.id = team_members.team_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin'))
  );

-- Contacts policies
DROP POLICY IF EXISTS "select_contacts" ON contacts;
CREATE POLICY "select_contacts" ON contacts FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = contacts.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_contacts" ON contacts;
CREATE POLICY "insert_contacts" ON contacts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = contacts.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_contacts" ON contacts;
CREATE POLICY "update_contacts" ON contacts FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = contacts.org_id AND org_members.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = contacts.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_contacts" ON contacts;
CREATE POLICY "delete_contacts" ON contacts FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = contacts.org_id AND org_members.user_id = auth.uid() AND org_members.role IN ('owner', 'admin', 'agent'))
  );

-- Tags policies
DROP POLICY IF EXISTS "select_tags" ON tags;
CREATE POLICY "select_tags" ON tags FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = tags.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_tags" ON tags;
CREATE POLICY "insert_tags" ON tags FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = tags.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_tags" ON tags;
CREATE POLICY "update_tags" ON tags FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = tags.org_id AND org_members.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = tags.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_tags" ON tags;
CREATE POLICY "delete_tags" ON tags FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = tags.org_id AND org_members.user_id = auth.uid())
  );

-- Contact tags policies
DROP POLICY IF EXISTS "select_contact_tags" ON contact_tags;
CREATE POLICY "select_contact_tags" ON contact_tags FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members om JOIN contacts c ON c.org_id = om.org_id WHERE c.id = contact_tags.contact_id AND om.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_contact_tags" ON contact_tags;
CREATE POLICY "insert_contact_tags" ON contact_tags FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members om JOIN contacts c ON c.org_id = om.org_id WHERE c.id = contact_tags.contact_id AND om.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_contact_tags" ON contact_tags;
CREATE POLICY "delete_contact_tags" ON contact_tags FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members om JOIN contacts c ON c.org_id = om.org_id WHERE c.id = contact_tags.contact_id AND om.user_id = auth.uid())
  );
