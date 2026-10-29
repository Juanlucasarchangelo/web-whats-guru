export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: string;
  status: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
}

export interface UserProfile {
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  created_at: string;
}

export interface Contact {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  crm_stage: string;
  crm_value: number;
  custom_fields: Record<string, unknown>;
  last_seen_at: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  org_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  org_id: string;
  contact_id: string;
  channel: string;
  integration_id?: string | null;
  status: 'open' | 'pending' | 'closed';
  assigned_to: string | null;
  subject: string | null;
  unread_count: number;
  last_message_at: string;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  contact?: Contact;
  tags?: Tag[];
}

export interface Message {
  id: string;
  conversation_id: string;
  org_id: string;
  sender_type: 'contact' | 'agent' | 'bot';
  sender_id: string | null;
  body: string;
  channel: string;
  status: string;
  is_internal: boolean;
  is_bot: boolean;
  media_type?: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | null;
  media_mime?: string | null;
  media_name?: string | null;
  media_size?: number | null;
  media_location?: { latitude: number; longitude: number; name: string; address: string; live: boolean } | null;
  created_at: string;
}

export interface InternalNote {
  id: string;
  conversation_id: string;
  org_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface QuickReply {
  id: string;
  org_id: string;
  shortcut: string;
  title: string;
  body: string;
  created_by: string;
  created_at: string;
}

export interface Chatbot {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  flow: {
    nodes: FlowNode[];
    edges: FlowEdge[];
  };
  status: 'draft' | 'active' | 'paused';
  trigger_channel: string | null;
  trigger_keyword: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FlowNode {
  id: string;
  type: 'message' | 'question' | 'condition' | 'delay' | 'tag' | 'assign' | 'webhook' | 'close' | 'start';
  data: {
    text?: string;
    options?: string[];
    field?: string;
    operator?: string;
    value?: string;
    tag?: string;
    team?: string;
    url?: string;
    delay?: number;
    delayUnit?: string;
  };
  position: { x: number; y: number };
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface Automation {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  trigger: Record<string, unknown>;
  actions: Record<string, unknown>[];
  status: 'active' | 'paused';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  org_id: string;
  name: string;
  message: string;
  channel: string;
  segment_tags: string[];
  segment_stage: string | null;
  scheduled_at: string | null;
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'failed';
  consent_required: boolean;
  daily_limit: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  contact_id: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error: string | null;
  created_at: string;
  contact?: Contact;
}

export interface Schedule {
  id: string;
  org_id: string;
  contact_id: string | null;
  title: string;
  message: string | null;
  scheduled_at: string;
  channel: string;
  status: 'pending' | 'processing' | 'sent' | 'cancelled' | 'failed' | 'done';
  created_by: string;
  created_at: string;
  contact?: Contact;
}

export interface AuditLog {
  id: string;
  org_id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Integration {
  id: string;
  org_id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  status: 'connected' | 'disconnected' | 'demo' | 'error';
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  org_id: string | null;
  source: string;
  event_type: string | null;
  payload: Record<string, unknown>;
  processed: boolean;
  processed_at: string | null;
  error: string | null;
  received_at: string;
}
