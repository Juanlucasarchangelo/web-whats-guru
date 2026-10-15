import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';

const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');
const uuidFromMessage = (id) => {
  const h = createHash('sha256').update('whatsapp:' + id).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
};
export function whatsappConfig() {
  const c = {
    token: process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
    orgId: process.env.WHATSAPP_ORG_ID?.trim(),
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim(),
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim(),
    version: (process.env.WHATSAPP_API_VERSION || 'v26.0').trim(),
  };
  c.configured = Boolean(c.token && c.phoneId && c.orgId && c.verifyToken && c.appSecret);
  return c;
}
export function safeCompare(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
export function checkSignature(rawBody, signature, appSecret) {
  if (!appSecret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeCompare(signature, expected);
}
async function graphRequest(method, path, body) {
  const c = whatsappConfig();
  if (!c.configured) throw new HttpError(503, 'Configure WhatsApp Cloud API no server/.env.');
  if (!/^v\d+\.\d+$/.test(c.version) || !/^\d{5,30}$/.test(c.phoneId)) {
    throw new HttpError(503, 'Numero ID ou versao da Meta incorretos no .env.');
  }
  let response;
  try {
    response = await fetch(`https://graph.facebook.com/${c.version}/${c.phoneId}${path}`, {
      method, headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      ...(body ? {body:JSON.stringify(body)} : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new HttpError(502, 'Sem comunicacao com API da Meta. Verifique internet e rede.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Don't surface provider payloads or credentials through HTTP.
    throw new HttpError(502, `Meta recusou a operacao (codigo ${data?.error?.code ?? response.status}). Verifique token, permissao, numero e janela de atendimento.`);
  }
  return data;
}
export async function verifyPhoneWithMeta() {
  const c = whatsappConfig();
  const result = await graphRequest('GET', '?fields=display_phone_number,verified_name');
  return { connected: true, display_phone_number: result.display_phone_number ?? null, verified_name: result.verified_name ?? null,
    organization_id: c.orgId };
}
export async function sendTextToWhatsApp({ orgId, conversation, text, userId }) {
  const c = whatsappConfig();
  if (!c.configured || c.orgId !== orgId) throw new HttpError(503, 'WhatsApp nao configurado para esta organizacao. Abra Integracoes.');
  const contact = await prisma.contact.findFirst({where:{id:conversation.contact_id,org_id:orgId},select:{phone:true}});
  const to = onlyDigits(contact?.phone);
  if (to.length < 10 || to.length > 15) throw new HttpError(400, 'Contato sem telefone internacional valido (ex.: 5541999999999).');
  // WhatsApp only permits free text in the customer-service window.
  const lastInbound = await prisma.message.findFirst({where:{org_id:orgId,conversation_id:conversation.id,sender_type:'contact',
    created_at:{gte:new Date(Date.now() - 24*60*60*1000)}},orderBy:{created_at:'desc'},select:{id:true}});
  if (!lastInbound) throw new HttpError(409, 'Sem mensagem recebida nas ultimas 24h. Use um template aprovado na Meta para iniciar a conversa.');
  const result = await graphRequest('POST', '/messages', { messaging_product:'whatsapp', recipient_type:'individual',
    to, type:'text', text:{preview_url:false,body:text} });
  const providerId = result.messages?.[0]?.id;
  if (!providerId) throw new HttpError(502, 'Meta nao confirmou a aceitacao da mensagem.');
  const row = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({data:{id:randomUUID(),org_id:orgId,conversation_id:conversation.id,
      body:text,sender_type:'agent',sender_id:userId,channel:'whatsapp',status:'accepted',is_internal:false}});
    await tx.conversation.update({where:{id:conversation.id},data:{last_message_at:message.created_at}});
    await tx.webhookEvent.create({data:{id:randomUUID(),org_id:orgId,source:'whatsapp_outbound',event_type:'message_accepted',
      payload:{provider_message_id:providerId,local_message_id:message.id},processed:true,processed_at:new Date()}});
    return message;
  });
  return row;
}
export async function sendTemplate({orgId,conversation,name,language,userId}) {
  const c = whatsappConfig();
  if (!c.configured || c.orgId !== orgId) throw new HttpError(503,'WhatsApp nao configurado para esta organizacao.');
  const contact=await prisma.contact.findFirst({where:{id:conversation.contact_id,org_id:orgId},select:{phone:true}});
  const to=onlyDigits(contact?.phone);
  if(to.length<10 || to.length>15) throw new HttpError(400,'Telefone internacional invalido.');
  if(!/^[a-z0-9_]{1,128}$/.test(name) || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) throw new HttpError(400,'Nome ou idioma de template invalido.');
  const result=await graphRequest('POST','/messages',{messaging_product:'whatsapp',to,type:'template',template:{name,language:{code:language}}});
  const providerId=result.messages?.[0]?.id;
  if(!providerId) throw new HttpError(502,'Meta nao confirmou o template.');
  return prisma.$transaction(async tx=>{
    const msg=await tx.message.create({data:{id:randomUUID(),org_id:orgId,conversation_id:conversation.id,body:`[Template: ${name} (${language})]`,sender_type:'agent',sender_id:userId,channel:'whatsapp',status:'accepted'}});
    await tx.conversation.update({where:{id:conversation.id},data:{last_message_at:msg.created_at}});
    await tx.webhookEvent.create({data:{id:randomUUID(),org_id:orgId,source:'whatsapp_outbound',event_type:'template_accepted',payload:{provider_message_id:providerId,local_message_id:msg.id},processed:true,processed_at:new Date()}});
    return msg;
  });
}
export async function processWhatsAppWebhook(payload) {
  const c = whatsappConfig();
  if (!c.configured) throw new HttpError(503,'Webhook WhatsApp nao configurado.');
  if (payload?.object !== 'whatsapp_business_account') return;
  const org = await prisma.organization.findUnique({where:{id:c.orgId},select:{id:true}});
  if(!org) throw new HttpError(503,'WHATSAPP_ORG_ID nao existe no banco.');
  for(const entry of payload.entry ?? []) for(const change of entry.changes ?? []) {
    if(change.field !== 'messages' || change.value?.metadata?.phone_number_id !== c.phoneId) continue;
    const value=change.value;
    for(const incoming of value.messages ?? []) {
      if(incoming.type !== 'text' || !incoming.id || !incoming.from || typeof incoming.text?.body !== 'string') continue;
      const messageId=uuidFromMessage(incoming.id);
      if(await prisma.message.findUnique({where:{id:messageId},select:{id:true}})) continue;
      const digits=onlyDigits(incoming.from);
      if(digits.length < 10 || digits.length > 15) continue;
      const candidates=await prisma.contact.findMany({where:{org_id:c.orgId},select:{id:true,phone:true},take:2000,orderBy:{created_at:'desc'}});
      let contact=candidates.find(x=>onlyDigits(x.phone)===digits);
      if(!contact) {
        contact=await prisma.contact.create({data:{id:randomUUID(),org_id:c.orgId,name:value.contacts?.[0]?.profile?.name?.slice(0,150) || `WhatsApp ${digits}`,
          phone:`+${digits}`,custom_fields:{}}});
      }
      let conversation=await prisma.conversation.findFirst({where:{org_id:c.orgId,contact_id:contact.id,channel:'whatsapp',status:{not:'closed'}},orderBy:{last_message_at:'desc'}});
      if(!conversation) conversation=await prisma.conversation.create({data:{id:randomUUID(),org_id:c.orgId,contact_id:contact.id,channel:'whatsapp',status:'open'}});
      try {
        await prisma.$transaction(async tx=>{
          const createdAt=/^\d+$/.test(String(incoming.timestamp)) ? new Date(Number(incoming.timestamp)*1000) : new Date();
          await tx.message.create({data:{id:messageId,org_id:c.orgId,conversation_id:conversation.id,sender_type:'contact',body:incoming.text.body.slice(0,10000),channel:'whatsapp',status:'received',created_at:createdAt}});
          await tx.conversation.update({where:{id:conversation.id},data:{last_message_at:createdAt,unread_count:{increment:1}}});
        });
      } catch(err) { if(err.code !== 'P2002') throw err; }
    }
    for(const item of value.statuses ?? []) {
      if(!item.id || !['sent','delivered','read','failed'].includes(item.status)) continue;
      const mapping=await prisma.webhookEvent.findFirst({where:{org_id:c.orgId,source:'whatsapp_outbound',
        payload:{path:'$.provider_message_id',equals:item.id}},orderBy:{received_at:'desc'}});
      const localId=mapping?.payload?.local_message_id;
      if(localId) await prisma.message.updateMany({where:{id:localId,org_id:c.orgId},data:{status:item.status}});
    }
  }
}
