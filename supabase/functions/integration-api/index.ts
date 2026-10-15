import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(supabaseUrl, serviceRoleKey);

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUser(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) return null;
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user;
}

async function canManage(userId: string, orgId: string) {
  const { data } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return data?.role === "owner" || data?.role === "admin";
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (hostname === "localhost" || hostname === "::1" || hostname === "0.0.0.0" || hostname.startsWith("127.")) return null;
    if (hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("169.254.")) return null;
    if (hostname.startsWith("172.")) {
      const secondOctet = Number(hostname.split(".")[1]);
      if (secondOctet >= 16 && secondOctet <= 31) return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
    const user = await getUser(req);
    if (!user) return json({ error: "Não autorizado" }, 401);

    const body = await req.json() as Record<string, unknown>;
    const orgId = typeof body.org_id === "string" ? body.org_id : "";
    const type = typeof body.type === "string" ? body.type : "";
    if (!orgId || !(await canManage(user.id, orgId))) return json({ error: "Sem permissão para configurar esta integração" }, 403);
    if (type !== "ai_provider" && type !== "webhook") return json({ error: "Integração inválida" }, 400);

    const existing = await admin
      .from("integrations")
      .select("id")
      .eq("org_id", orgId)
      .eq("type", type)
      .maybeSingle();

    let integrationId = existing.data?.id as string | undefined;
    const now = new Date().toISOString();

    if (type === "ai_provider") {
      const provider = typeof body.provider === "string" ? body.provider : "openai";
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "gpt-4o-mini";
      const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
      if (provider !== "openai" || !apiKey || !apiKey.startsWith("sk-")) return json({ error: "Informe uma chave válida da OpenAI" }, 400);

      const validation = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!validation.ok) return json({ error: "A chave da OpenAI não foi aceita" }, 400);

      const saved = await admin.from("integrations").upsert({
        id: integrationId,
        org_id: orgId,
        type,
        name: "Provedor de IA",
        config: { provider, model, demo_mode: false },
        status: "connected",
        last_connected_at: now,
        updated_at: now,
      }, { onConflict: "org_id,type" }).select("id").maybeSingle();
      if (saved.error || !saved.data) return json({ error: "Não foi possível salvar o provedor de IA" }, 500);
      integrationId = saved.data.id;

      const credential = await admin.from("integration_credentials").upsert({
        integration_id: integrationId,
        org_id: orgId,
        access_token: apiKey,
        verify_token: crypto.randomUUID().replaceAll("-", ""),
        updated_at: now,
      }, { onConflict: "integration_id" });
      if (credential.error) return json({ error: "Não foi possível proteger a chave da OpenAI" }, 500);
      return json({ connected: true, provider, model });
    }

    const url = safeHttpsUrl(body.url);
    if (!url) return json({ error: "Informe uma URL HTTPS válida para o webhook" }, 400);
    const saved = await admin.from("integrations").upsert({
      id: integrationId,
      org_id: orgId,
      type,
      name: "Webhook",
      config: { url, demo_mode: false },
      status: "connected",
      last_connected_at: now,
      updated_at: now,
    }, { onConflict: "org_id,type" });
    if (saved.error) return json({ error: "Não foi possível salvar o webhook" }, 500);
    return json({ connected: true, url });
  } catch (error) {
    console.error("Integration API error", error);
    return json({ error: "Não foi possível concluir a configuração" }, 500);
  }
});
