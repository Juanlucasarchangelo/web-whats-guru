/*
# Converso CRM - Chatbots, Automations, Campaigns, Schedules

## New Tables
1. chatbots - Visual flow bots with nodes (message, question, condition, delay, tag, assign, webhook, close)
2. automations - Automation rules with triggers and actions
3. campaigns - Broadcast campaigns with segmentation, scheduling, consent, limits
4. campaign_recipients - Per-recipient tracking for campaigns
5. schedules - Scheduled messages and reminders
6. audit_logs - Audit trail of user actions
7. integrations - Integration configs (WhatsApp, AI provider, etc.)

## Security
- RLS on all tables, scoped via org_members membership check
*/

CREATE TABLE IF NOT EXISTS chatbots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  flow jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  trigger_channel text,
  trigger_keyword text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  message text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  segment_tags text[] NOT NULL DEFAULT '{}',
  segment_stage text,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  consent_required boolean NOT NULL DEFAULT true,
  daily_limit integer NOT NULL DEFAULT 100,
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_id ON campaign_recipients(campaign_id);

CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text,
  scheduled_at timestamptz NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'pending',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_org_id ON schedules(org_id);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(org_id, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'disconnected',
  last_connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, type)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  source text NOT NULL,
  event_type text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_org_id ON webhook_events(org_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);

-- User profiles (extends auth.users with display info)
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  avatar_url text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on all new tables
ALTER TABLE chatbots ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Chatbots
DROP POLICY IF EXISTS "select_chatbots" ON chatbots;
CREATE POLICY "select_chatbots" ON chatbots FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = chatbots.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_chatbots" ON chatbots;
CREATE POLICY "insert_chatbots" ON chatbots FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = chatbots.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_chatbots" ON chatbots;
CREATE POLICY "update_chatbots" ON chatbots FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = chatbots.org_id AND org_members.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = chatbots.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_chatbots" ON chatbots;
CREATE POLICY "delete_chatbots" ON chatbots FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = chatbots.org_id AND org_members.user_id = auth.uid()));

-- Automations
DROP POLICY IF EXISTS "select_automations" ON automations;
CREATE POLICY "select_automations" ON automations FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = automations.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_automations" ON automations;
CREATE POLICY "insert_automations" ON automations FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = automations.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_automations" ON automations;
CREATE POLICY "update_automations" ON automations FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = automations.org_id AND org_members.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = automations.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_automations" ON automations;
CREATE POLICY "delete_automations" ON automations FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = automations.org_id AND org_members.user_id = auth.uid()));

-- Campaigns
DROP POLICY IF EXISTS "select_campaigns" ON campaigns;
CREATE POLICY "select_campaigns" ON campaigns FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = campaigns.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_campaigns" ON campaigns;
CREATE POLICY "insert_campaigns" ON campaigns FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = campaigns.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_campaigns" ON campaigns;
CREATE POLICY "update_campaigns" ON campaigns FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = campaigns.org_id AND org_members.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = campaigns.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_campaigns" ON campaigns;
CREATE POLICY "delete_campaigns" ON campaigns FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = campaigns.org_id AND org_members.user_id = auth.uid()));

-- Campaign recipients
DROP POLICY IF EXISTS "select_campaign_recipients" ON campaign_recipients;
CREATE POLICY "select_campaign_recipients" ON campaign_recipients FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members om JOIN campaigns c ON c.org_id = om.org_id WHERE c.id = campaign_recipients.campaign_id AND om.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_campaign_recipients" ON campaign_recipients;
CREATE POLICY "insert_campaign_recipients" ON campaign_recipients FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM org_members om JOIN campaigns c ON c.org_id = om.org_id WHERE c.id = campaign_recipients.campaign_id AND om.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_campaign_recipients" ON campaign_recipients;
CREATE POLICY "update_campaign_recipients" ON campaign_recipients FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members om JOIN campaigns c ON c.org_id = om.org_id WHERE c.id = campaign_recipients.campaign_id AND om.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members om JOIN campaigns c ON c.org_id = om.org_id WHERE c.id = campaign_recipients.campaign_id AND om.user_id = auth.uid()));

-- Schedules
DROP POLICY IF EXISTS "select_schedules" ON schedules;
CREATE POLICY "select_schedules" ON schedules FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = schedules.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_schedules" ON schedules;
CREATE POLICY "insert_schedules" ON schedules FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = schedules.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_schedules" ON schedules;
CREATE POLICY "update_schedules" ON schedules FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = schedules.org_id AND org_members.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = schedules.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_schedules" ON schedules;
CREATE POLICY "delete_schedules" ON schedules FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = schedules.org_id AND org_members.user_id = auth.uid()));

-- Audit logs (read-only for members, insert for all members, no update/delete)
DROP POLICY IF EXISTS "select_audit_logs" ON audit_logs;
CREATE POLICY "select_audit_logs" ON audit_logs FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = audit_logs.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_audit_logs" ON audit_logs;
CREATE POLICY "insert_audit_logs" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = audit_logs.org_id AND org_members.user_id = auth.uid()));

-- Integrations
DROP POLICY IF EXISTS "select_integrations" ON integrations;
CREATE POLICY "select_integrations" ON integrations FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = integrations.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_integrations" ON integrations;
CREATE POLICY "insert_integrations" ON integrations FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = integrations.org_id AND org_members.user_id = auth.uid() AND org_members.role IN ('owner', 'admin')));
DROP POLICY IF EXISTS "update_integrations" ON integrations;
CREATE POLICY "update_integrations" ON integrations FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = integrations.org_id AND org_members.user_id = auth.uid() AND org_members.role IN ('owner', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = integrations.org_id AND org_members.user_id = auth.uid() AND org_members.role IN ('owner', 'admin')));
DROP POLICY IF EXISTS "delete_integrations" ON integrations;
CREATE POLICY "delete_integrations" ON integrations FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = integrations.org_id AND org_members.user_id = auth.uid() AND org_members.role IN ('owner', 'admin')));

-- Webhook events (only insert for authenticated with org membership; select for members)
DROP POLICY IF EXISTS "select_webhook_events" ON webhook_events;
CREATE POLICY "select_webhook_events" ON webhook_events FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = webhook_events.org_id AND org_members.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_webhook_events" ON webhook_events;
CREATE POLICY "insert_webhook_events" ON webhook_events FOR INSERT
  TO authenticated WITH CHECK (webhook_events.org_id IS NOT NULL AND EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = webhook_events.org_id AND org_members.user_id = auth.uid()));

-- User profiles (users can only see/update their own profile)
DROP POLICY IF EXISTS "select_own_profile" ON user_profiles;
CREATE POLICY "select_own_profile" ON user_profiles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_profile" ON user_profiles;
CREATE POLICY "insert_own_profile" ON user_profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_profile" ON user_profiles;
CREATE POLICY "update_own_profile" ON user_profiles FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
