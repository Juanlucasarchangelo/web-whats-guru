import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

type IntegrationRecord = {
  id: string;
  org_id: string;
  config: Record<string, unknown>;
};

type CredentialRecord = {
  verify_token: string;
  app_secret: string | null;
};

function response(body: string, status = 200, contentType = "application/json"): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": contentType },
  });
}

function json(data: Record<string, unknown>, status = 200): Response {
  return response(JSON.stringify(data), status);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signatureMatches(rawBody: string, signature: string | null, appSecret: string | null): Promise<boolean> {
  if (!appSecret) return true;
  if (!signature?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = bytesToHex(new Uint8Array(digest));
  const received = signature.slice(7);
  if (expected.length !== received.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  return difference === 0;
}

async function findWhatsAppIntegration(phoneNumberId: string): Promise<IntegrationRecord | null> {
  const { data } = await supabase
    .from("integrations")
    .select("id, org_id, config")
    .eq("type", "whatsapp")
    .eq("status", "connected");

  const match = (data ?? []).find((integration) => {
    const config = integration.config as Record<string, unknown>;
    return config.phone_number_id === phoneNumberId;
  });

  return (match as IntegrationRecord | undefined) ?? null;
}

async function processIncomingMessages(
  orgId: string,
  messages: Array<Record<string, unknown>>,
  contacts: Array<Record<string, unknown>>,
): Promise<void> {
  for (const message of messages) {
    const phone = typeof message.from === "string" ? message.from : "";
    if (!phone) continue;

    const contactData = contacts.find((contact) => contact.wa_id === phone);
    const profile = contactData?.profile as Record<string, unknown> | undefined;
    const contactName = typeof profile?.name === "string" ? profile.name : phone;

    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    let contactId = existingContact?.id as string | undefined;
    if (!contactId) {
      const { data: newContact, error: contactError } = await supabase
        .from("contacts")
        .insert({ org_id: orgId, name: contactName, phone, is_demo: false })
        .select("id")
        .maybeSingle();
      if (contactError || !newContact) throw new Error("contact_create_failed");
      contactId = newContact.id as string;
    }

    const { data: existingConversation } = await supabase
      .from("conversations")
      .select("id, unread_count")
      .eq("org_id", orgId)
      .eq("contact_id", contactId)
      .in("status", ["open", "pending"])
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversationId = existingConversation?.id as string | undefined;
    let unreadCount = Number(existingConversation?.unread_count ?? 0);
    if (!conversationId) {
      const { data: newConversation, error: conversationError } = await supabase
        .from("conversations")
        .insert({ org_id: orgId, contact_id: contactId, channel: "whatsapp", status: "open", unread_count: 1 })
        .select("id")
        .maybeSingle();
      if (conversationError || !newConversation) throw new Error("conversation_create_failed");
      conversationId = newConversation.id as string;
      unreadCount = 1;
    }

    const messageType = typeof message.type === "string" ? message.type : "unknown";
    const messageContent = message.text as Record<string, unknown> | undefined;
    const body = typeof messageContent?.body === "string" ? messageContent.body : `[${messageType}]`;

    const { error: messageError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      org_id: orgId,
      sender_type: "contact",
      body,
      channel: "whatsapp",
      status: "delivered",
      is_internal: false,
      is_bot: false,
    });
    if (messageError) throw new Error("message_create_failed");

    await supabase
      .from("conversations")
      .update({ unread_count: unreadCount + 1, last_message_at: new Date().toISOString(), status: "open" })
      .eq("id", conversationId);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      const query = new URL(req.url).searchParams;
      const mode = query.get("hub.mode");
      const verifyToken = query.get("hub.verify_token");
      const challenge = query.get("hub.challenge");

      if (mode !== "subscribe" || !verifyToken || !challenge) {
        return response("Not found", 404, "text/plain");
      }

      const { data: credentials } = await supabase
        .from("integration_credentials")
        .select("verify_token")
        .eq("verify_token", verifyToken)
        .limit(1)
        .maybeSingle();

      return credentials ? response(challenge, 200, "text/plain") : response("Forbidden", 403, "text/plain");
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const rawBody = await req.text();
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (body.object !== "whatsapp_business_account") return json({ error: "Unsupported webhook" }, 400);

    const entries = Array.isArray(body.entry) ? body.entry as Array<Record<string, unknown>> : [];
    const firstEntry = entries[0];
    const changes = Array.isArray(firstEntry?.changes) ? firstEntry.changes as Array<Record<string, unknown>> : [];
    const value = (changes[0]?.value ?? {}) as Record<string, unknown>;
    const metadata = (value.metadata ?? {}) as Record<string, unknown>;
    const phoneNumberId = typeof metadata.phone_number_id === "string" ? metadata.phone_number_id : "";
    if (!phoneNumberId) return json({ error: "Missing phone number" }, 400);

    const integration = await findWhatsAppIntegration(phoneNumberId);
    if (!integration) return json({ error: "Unknown WhatsApp number" }, 404);

    const { data: credentials } = await supabase
      .from("integration_credentials")
      .select("verify_token, app_secret")
      .eq("integration_id", integration.id)
      .maybeSingle();

    if (!credentials) return json({ error: "Integration credentials unavailable" }, 503);
    if (!(await signatureMatches(rawBody, req.headers.get("X-Hub-Signature-256"), (credentials as CredentialRecord).app_secret))) {
      return json({ error: "Invalid signature" }, 401);
    }

    const messages = Array.isArray(value.messages) ? value.messages as Array<Record<string, unknown>> : [];
    const contacts = Array.isArray(value.contacts) ? value.contacts as Array<Record<string, unknown>> : [];
    const messageIds = messages.map((message) => message.id).filter((id): id is string => typeof id === "string");
    const eventType = messageIds.length > 0 ? `message:${messageIds.join(",")}` : String(changes[0]?.field ?? "status");

    const { data: existingEvent } = await supabase
      .from("webhook_events")
      .select("id")
      .eq("org_id", integration.org_id)
      .eq("event_type", eventType)
      .limit(1)
      .maybeSingle();
    if (existingEvent) return json({ status: "duplicate" });

    const { data: eventRecord, error: storeError } = await supabase
      .from("webhook_events")
      .insert({
        org_id: integration.org_id,
        source: "whatsapp",
        event_type: eventType,
        payload: body,
        processed: false,
      })
      .select("id")
      .maybeSingle();
    if (storeError || !eventRecord) return json({ error: "Could not store webhook" }, 500);

    await processIncomingMessages(integration.org_id, messages, contacts);

    await supabase
      .from("webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("id", eventRecord.id);

    return json({ status: "ok", event_id: eventRecord.id });
  } catch (error) {
    console.error("Webhook handler error", error);
    return json({ error: "Internal error" }, 500);
  }
});
