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

async function getAuthenticatedUser(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) return null;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

async function canManageIntegration(userId: string, orgId: string): Promise<boolean> {
  const { data } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  return data?.role === "owner" || data?.role === "admin";
}

function validateProviderUrl(value: string): string | null {
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

async function validateMetaPhone(phoneNumberId: string, accessToken: string) {
  const fields = "id,display_phone_number,verified_name,quality_rating";
  const response = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
  );

  if (!response.ok) return null;
  const data = await response.json();
  if (!data || data.id !== phoneNumberId) return null;
  return data as {
    id: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return json({ error: "Não autorizado" }, 401);

    const body = await req.json();
    const orgId = typeof body?.org_id === "string" ? body.org_id : "";
    if (!orgId || !(await canManageIntegration(user.id, orgId))) {
      return json({ error: "Sem permissão para configurar esta integração" }, 403);
    }

    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "connect_unofficial" && req.method === "POST") {
      const providerUrl = typeof body?.provider_url === "string" ? validateProviderUrl(body.provider_url) : null;
      const instanceName = typeof body?.instance_name === "string" ? body.instance_name.trim() : "";
      const apiKey = typeof body?.api_key === "string" ? body.api_key.trim() : "";

      if (!providerUrl || !instanceName || !apiKey || !/^[a-zA-Z0-9_-]{2,60}$/.test(instanceName)) {
        return json({ error: "Informe uma URL HTTPS, nome de instância válido e API Key" }, 400);
      }

      const createResponse = await fetch(`${providerUrl}/instance/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true }),
      });

      let providerData = await createResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (!createResponse.ok) {
        const connectResponse = await fetch(`${providerUrl}/instance/connect/${encodeURIComponent(instanceName)}`, {
          headers: { apikey: apiKey },
        });
        providerData = await connectResponse.json().catch(() => ({})) as Record<string, unknown>;
        if (!connectResponse.ok) return json({ error: "Não foi possível iniciar a conexão com o provedor" }, 502);
      }

      const qrCode = typeof providerData.base64 === "string"
        ? providerData.base64
        : typeof (providerData.qrcode as Record<string, unknown> | undefined)?.base64 === "string"
        ? (providerData.qrcode as Record<string, unknown>).base64 as string
        : "";
      if (!qrCode) return json({ error: "O provedor não retornou um QR Code" }, 502);

      const verifyToken = crypto.randomUUID().replaceAll("-", "");
      const { data: integration, error: integrationError } = await admin
        .from("integrations")
        .upsert({
          org_id: orgId,
          type: "whatsapp",
          name: "WhatsApp Business Platform",
          config: { connection_mode: "unofficial", provider: "evolution_api", provider_url: providerUrl, instance_name: instanceName, qr_code: qrCode, demo_mode: false },
          status: "connected",
          last_connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "org_id,type" })
        .select("id")
        .maybeSingle();

      if (integrationError || !integration) return json({ error: "Não foi possível salvar a conexão" }, 500);

      const { error: credentialError } = await admin
        .from("integration_credentials")
        .upsert({ integration_id: integration.id, org_id: orgId, access_token: apiKey, verify_token: verifyToken, updated_at: new Date().toISOString() }, { onConflict: "integration_id" });
      if (credentialError) return json({ error: "Não foi possível proteger as credenciais" }, 500);

      return json({ connected: false, qr_code: qrCode });
    }

    if (action === "connect" && req.method === "POST") {
      const phoneNumberId = typeof body?.phone_number_id === "string" ? body.phone_number_id.trim() : "";
      const businessAccountId = typeof body?.business_account_id === "string" ? body.business_account_id.trim() : "";
      const accessToken = typeof body?.access_token === "string" ? body.access_token.trim() : "";

      if (!phoneNumberId || !businessAccountId || !accessToken) {
        return json({ error: "Preencha os dados obrigatórios da Meta" }, 400);
      }

      const metaPhone = await validateMetaPhone(phoneNumberId, accessToken);
      if (!metaPhone) {
        return json({ error: "Não foi possível validar este número na Meta" }, 400);
      }

      const appSecret = typeof body?.app_secret === "string" && body.app_secret.trim() ? body.app_secret.trim() : null;
      const verifyToken = crypto.randomUUID().replaceAll("-", "");
      const config = {
        phone_number_id: phoneNumberId,
        business_account_id: businessAccountId,
        display_phone_number: metaPhone.display_phone_number ?? "",
        verified_name: metaPhone.verified_name ?? "",
        quality_rating: metaPhone.quality_rating ?? "",
        webhook_verify_token: verifyToken,
        demo_mode: false,
      };

      const { data: integration, error: integrationError } = await admin
        .from("integrations")
        .upsert({
          org_id: orgId,
          type: "whatsapp",
          name: "WhatsApp Business Platform",
          config,
          status: "connected",
          last_connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "org_id,type" })
        .select("id")
        .maybeSingle();

      if (integrationError || !integration) {
        console.error("Failed to save WhatsApp integration", integrationError?.message);
        return json({ error: "Não foi possível salvar a conexão" }, 500);
      }

      const { error: credentialError } = await admin
        .from("integration_credentials")
        .upsert({
          integration_id: integration.id,
          org_id: orgId,
          access_token: accessToken,
          verify_token: verifyToken,
          app_secret: appSecret,
          updated_at: new Date().toISOString(),
        }, { onConflict: "integration_id" });

      if (credentialError) {
        console.error("Failed to save WhatsApp credentials", credentialError.message);
        return json({ error: "Não foi possível proteger as credenciais" }, 500);
      }

      return json({
        connected: true,
        display_phone_number: metaPhone.display_phone_number ?? "",
        verified_name: metaPhone.verified_name ?? "",
        webhook_verify_token: verifyToken,
      });
    }

    if (action === "disconnect" && req.method === "POST") {
      const { data: integration } = await admin
        .from("integrations")
        .select("id, config")
        .eq("org_id", orgId)
        .eq("type", "whatsapp")
        .maybeSingle();

      if (integration) {
        await admin.from("integration_credentials").delete().eq("integration_id", integration.id);
        const config = { ...(integration.config as Record<string, unknown>), demo_mode: false };
        delete config.webhook_verify_token;
        await admin
          .from("integrations")
          .update({ status: "disconnected", config, updated_at: new Date().toISOString() })
          .eq("id", integration.id);
      }

      return json({ disconnected: true });
    }

    return json({ error: "Rota não encontrada" }, 404);
  } catch (error) {
    console.error("WhatsApp API error", error);
    return json({ error: "Não foi possível concluir a operação" }, 500);
  }
});
