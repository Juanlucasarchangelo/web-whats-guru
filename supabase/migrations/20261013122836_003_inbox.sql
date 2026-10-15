/*
# Converso CRM - Inbox: Conversations, Messages, Notes, Quick Replies, Attachments

## New Tables
1. conversations - Chat conversations across channels
2. conversation_tags - Junction table for conversation-tag relationship
3. messages - Individual messages within conversations
4. internal_notes - Internal agent-only notes on conversations
5. quick_replies - Reusable canned responses
6. attachments - File attachments for messages

## Security
- RLS on all tables, scoped via org_members membership check
*/

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject text,
  unread_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_org_id ON conversations(org_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(org_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(org_id, assigned_to);

CREATE TABLE IF NOT EXISTS conversation_tags (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, tag_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sender_type text NOT NULL DEFAULT 'contact',
  sender_id uuid,
  body text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'sent',
  is_internal boolean NOT NULL DEFAULT false,
  is_bot boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_org_id ON messages(org_id);

CREATE TABLE IF NOT EXISTS internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_conversation_id ON internal_notes(conversation_id);

CREATE TABLE IF NOT EXISTS quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shortcut text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  file_size integer,
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Helper: org membership check pattern used in all policies below
-- EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = <table>.org_id AND org_members.user_id = auth.uid())

-- Conversations
DROP POLICY IF EXISTS "select_conversations" ON conversations;
CREATE POLICY "select_conversations" ON conversations FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = conversations.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_conversations" ON conversations;
CREATE POLICY "insert_conversations" ON conversations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = conversations.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_conversations" ON conversations;
CREATE POLICY "update_conversations" ON conversations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = conversations.org_id AND org_members.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = conversations.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_conversations" ON conversations;
CREATE POLICY "delete_conversations" ON conversations FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = conversations.org_id AND org_members.user_id = auth.uid())
  );

-- Conversation tags
DROP POLICY IF EXISTS "select_conv_tags" ON conversation_tags;
CREATE POLICY "select_conv_tags" ON conversation_tags FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members om JOIN conversations c ON c.org_id = om.org_id WHERE c.id = conversation_tags.conversation_id AND om.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_conv_tags" ON conversation_tags;
CREATE POLICY "insert_conv_tags" ON conversation_tags FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members om JOIN conversations c ON c.org_id = om.org_id WHERE c.id = conversation_tags.conversation_id AND om.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_conv_tags" ON conversation_tags;
CREATE POLICY "delete_conv_tags" ON conversation_tags FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members om JOIN conversations c ON c.org_id = om.org_id WHERE c.id = conversation_tags.conversation_id AND om.user_id = auth.uid())
  );

-- Messages
DROP POLICY IF EXISTS "select_messages" ON messages;
CREATE POLICY "select_messages" ON messages FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = messages.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_messages" ON messages;
CREATE POLICY "insert_messages" ON messages FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = messages.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_messages" ON messages;
CREATE POLICY "update_messages" ON messages FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = messages.org_id AND org_members.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = messages.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_messages" ON messages;
CREATE POLICY "delete_messages" ON messages FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = messages.org_id AND org_members.user_id = auth.uid())
  );

-- Internal notes
DROP POLICY IF EXISTS "select_notes" ON internal_notes;
CREATE POLICY "select_notes" ON internal_notes FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = internal_notes.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_notes" ON internal_notes;
CREATE POLICY "insert_notes" ON internal_notes FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = internal_notes.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_notes" ON internal_notes;
CREATE POLICY "update_notes" ON internal_notes FOR UPDATE
  TO authenticated USING (auth.uid() = author_id) WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = internal_notes.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_notes" ON internal_notes;
CREATE POLICY "delete_notes" ON internal_notes FOR DELETE
  TO authenticated USING (auth.uid() = author_id);

-- Quick replies
DROP POLICY IF EXISTS "select_quick_replies" ON quick_replies;
CREATE POLICY "select_quick_replies" ON quick_replies FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = quick_replies.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_quick_replies" ON quick_replies;
CREATE POLICY "insert_quick_replies" ON quick_replies FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = quick_replies.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_quick_replies" ON quick_replies;
CREATE POLICY "update_quick_replies" ON quick_replies FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = quick_replies.org_id AND org_members.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = quick_replies.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_quick_replies" ON quick_replies;
CREATE POLICY "delete_quick_replies" ON quick_replies FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = quick_replies.org_id AND org_members.user_id = auth.uid())
  );

-- Attachments
DROP POLICY IF EXISTS "select_attachments" ON attachments;
CREATE POLICY "select_attachments" ON attachments FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = attachments.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_attachments" ON attachments;
CREATE POLICY "insert_attachments" ON attachments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = attachments.org_id AND org_members.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_attachments" ON attachments;
CREATE POLICY "delete_attachments" ON attachments FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = attachments.org_id AND org_members.user_id = auth.uid())
  );
