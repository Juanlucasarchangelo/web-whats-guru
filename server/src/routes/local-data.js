/**
 * Whitelisted, organization-scoped adapter for the existing React screens.
 * Not an unrestricted SQL/Prisma proxy: every table and write field is listed below.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { localFields } from './local-fields.js';
import { prisma } from '../db.js';
import { publicLocation } from '../services/evolution-media.js';
import { HttpError, wrap } from '../http.js';
import { conversationScope, requireConversation, requireAssigneeForChannel, admin } from '../services/channel-access.js';
import { processTagAdded } from '../services/workflow-engine.js';

const MODELS = {
  contacts: ['contact', 'name email phone avatar_url crm_stage crm_value custom_fields last_seen_at'],
  tags: ['tag', 'name color'],
  contact_tags: ['contactTag', 'contact_id tag_id'],
  conversations: ['conversation', 'contact_id channel status assigned_to subject unread_count last_message_at'],
  conversation_tags: ['conversationTag', 'conversation_id tag_id'],
  messages: ['message', 'conversation_id body is_internal'],
  internal_notes: ['internalNote', 'conversation_id body'],
  quick_replies: ['quickReply', 'shortcut title body'],
  chatbots: ['chatbot', 'name description flow status trigger_channel trigger_keyword'],
  automations: ['automation', 'name description trigger actions status'],
  campaigns: ['campaign', 'name message channel segment_tags segment_stage scheduled_at status consent_required daily_limit'],
  campaign_recipients: ['campaignRecipient', 'campaign_id contact_id status'],
  schedules: ['schedule', 'contact_id title message scheduled_at channel status'],
  teams: ['team', 'name description'],
  org_members: ['orgMember', 'role'],
  user_profiles: ['userProfile', 'full_name avatar_url phone'],
  integrations: ['integration', ''],
};
const ADMIN_WRITE = new Set(['teams', 'org_members', 'tags']);
const NO_WRITE = new Set(['integrations','teams','org_members','campaigns','campaign_recipients','schedules']);
const JOINS = {
  conversation_tags: ['conversation_id', 'conversation', 'org_id'],
  contact_tags: ['contact_id', 'contact', 'org_id'],
  campaign_recipients: ['campaign_id', 'campaign', 'org_id'],
};
const fields = localFields;
const allowed = (table) => {
  if (!Object.hasOwn(MODELS, table)) throw new HttpError(404, 'Tabela nao disponivel pela API.');
  return { model: MODELS[table][0], writable: new Set(MODELS[table][1].split(' ').filter(Boolean)) };
};
const admins = (req) => {
  if (!['owner', 'admin'].includes(req.role)) throw new HttpError(403, 'Somente administradores podem fazer esta operacao.');
};
function safeFilters(table, items) {
  if (!Array.isArray(items) || items.length > 15) throw new HttpError(400, 'Filtros invalidos.');
  const output = {};
  for (const item of items) {
    if (!item || typeof item !== 'object' || !Object.hasOwn(fields[table], item.field)) throw new HttpError(400, 'Campo de filtro invalido.');
    const { field, value, op } = item;
    if (field === 'org_id' || field === 'owner_id') continue; // never trust a client-specified tenant
    if (op === 'eq' || op === 'is') output[field] = value;
    else if (op === 'in' && Array.isArray(value) && value.length <= 500) output[field] = { in: value };
    else if (op === 'ilike' && typeof value === 'string' && value.length <= 128) {
      output[field] = { contains: value.replace(/^%|%$/g, '') };
    } else throw new HttpError(400, 'Operador de filtro nao permitido.');
  }
  return output;
}
async function scopedWhere(req, table, filters, tx = prisma) {
  const query = safeFilters(table, filters);
  if (Object.hasOwn(fields[table], 'org_id')) {
    if (admin(req)) return { ...query, org_id: req.orgId };
    if(table==='conversations') return {AND:[{...query,org_id:req.orgId},await conversationScope(req,tx)]};
    if(table==='messages'||table==='internal_notes') {
      const ids=(await tx.conversation.findMany({where:await conversationScope(req,tx),select:{id:true}})).map(r=>r.id);
      return {...query,org_id:req.orgId,conversation_id:{in:ids}};
    }
    return {...query,org_id:req.orgId};
  }
  if (table === 'user_profiles') {
    const memberIds = (await tx.orgMember.findMany({ where: { org_id: req.orgId, status: 'active' }, select: { user_id: true } })).map(m => m.user_id);
    const requested = query.user_id;
    const authorized = Array.isArray(requested?.in) ? memberIds.filter(id => requested.in.includes(id)) : typeof requested === 'string' ? memberIds.filter(id => id === requested) : memberIds;
    return { ...query, user_id: { in: authorized } };
  }
  if (table === 'org_members') return { ...query, org_id: req.orgId };
  if (table === 'contact_tags' || table === 'conversation_tags' || table === 'campaign_recipients') {
    const [foreign, foreignModel] = JOINS[table];
    const ids = (await tx[foreignModel].findMany({ where: table==='conversation_tags'?await conversationScope(req,tx):{ org_id: req.orgId }, select: { id: true }, take: 5000 })).map(r => r.id);
    const requested = query[foreign];
    const authorized = Array.isArray(requested?.in) ? ids.filter(id => requested.in.includes(id)) : requested && typeof requested === 'string' ? ids.filter(id => id === requested) : ids;
    return { ...query, [foreign]: { in: authorized } };
  }
  throw new HttpError(403, 'Tabela sem escopo permitido.');
}
function coerce(table, field, value) {
  const def = fields[table][field];
  if (!def) throw new HttpError(400, `Campo ${field} nao encontrado.`);
  if (value === null) { if (!def.isRequired) return null; throw new HttpError(400, `${field} nao pode ser nulo.`); }
  if (def.type === 'DateTime') { const dt = new Date(value); if (Number.isNaN(dt.getTime())) throw new HttpError(400, `Data invalida: ${field}`); return dt; }
  if (def.type === 'Json') { if (typeof value !== 'object') throw new HttpError(400, `JSON invalido: ${field}`); return value; }
  if (def.type === 'Decimal') { const n = Number(value); if (!Number.isFinite(n) || Math.abs(n) > 1e10) throw new HttpError(400, `Numero invalido: ${field}`); return n; }
  if (def.type === 'Int') { if (!Number.isInteger(value) || Math.abs(value) > 100000000) throw new HttpError(400, `Inteiro invalido: ${field}`); return value; }
  if (def.type === 'Boolean') { if (typeof value !== 'boolean') throw new HttpError(400, `Booleano invalido: ${field}`); return value; }
  if (typeof value !== 'string' || value.length > (field === 'body' || field === 'message' ? 20000 : 5000)) throw new HttpError(400, `Texto invalido: ${field}`);
  return value;
}
function cleanWrite(table, item, op) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, 'Dados invalidos.');
  const { writable } = allowed(table);
  const cleaned = {};
  for (const [key, value] of Object.entries(item)) {
    if (['id', 'created_by', 'created_at', 'updated_at', 'org_id', 'is_demo', 'sender_id', 'sender_type', 'status_count'].includes(key)) continue;
    if (!writable.has(key)) continue; // ignore migration-only client fields
    cleaned[key] = coerce(table, key, value);
  }
  if (op === 'update' && Object.keys(cleaned).length === 0) throw new HttpError(400, 'Nenhum campo permitido para editar.');
  return cleaned;
}
async function belongs(tx, model, id, orgId) {
  const item = await tx[model].findFirst({ where: { id, org_id: orgId }, select: { id: true } });
  if (!item) throw new HttpError(404, 'Referencia nao encontrada nesta empresa.');
}
async function validateReferences(tx, table, row, orgId) {
  if (row.contact_id) await belongs(tx, 'contact', row.contact_id, orgId);
  if (row.conversation_id) await belongs(tx, 'conversation', row.conversation_id, orgId);
  if (row.campaign_id) await belongs(tx, 'campaign', row.campaign_id, orgId);
  if (row.tag_id) await belongs(tx, 'tag', row.tag_id, orgId);
  if (row.assigned_to) {
    const member = await tx.orgMember.findFirst({ where: { org_id: orgId, user_id: row.assigned_to, status: 'active' } });
    if (!member) throw new HttpError(400, 'Agente nao pertence a empresa.');
  }
}
const FROZEN_FIELDS = {
  campaigns: new Set(['sent_count', 'delivered_count', 'read_count', 'failed_count', 'status']),
  campaign_recipients: new Set(['status']),
  schedules: new Set(['status']),
};
function enforce(table, item, op) {
  if (table === 'campaigns' && item.status && !['draft', 'scheduled'].includes(item.status)) {
    throw new HttpError(409, 'Envio de campanhas desativado: sem provedor de WhatsApp configurado.');
  }
  if (table === 'campaign_recipients' && item.status && item.status !== 'pending') {
    throw new HttpError(409, 'Nao e possivel marcar como enviada sem envio real.');
  }
  if (table === 'schedules' && item.status && !['pending','cancelled'].includes(item.status)) throw new HttpError(409, 'Disparo externo nao configurado.');
  if (table === 'messages') return; // validated separately
  if (table === 'org_members' && item.role && !['agent','admin'].includes(item.role)) throw new HttpError(403, 'Nao e permitido atribuir role owner.');
  if (table === 'chatbots' && item.status && !['draft','active','paused'].includes(item.status)) throw new HttpError(400, 'Status invalido.');
  if (table === 'automations' && item.status && !['active','paused'].includes(item.status)) throw new HttpError(400, 'Status invalido.');
  if (FROZEN_FIELDS[table] && op === 'update') {
    for (const field of FROZEN_FIELDS[table]) {
      if (field === 'status' && (table === 'schedules' || table === 'campaigns')) continue;
      if (field in item) throw new HttpError(409, 'Esta alteracao depende de uma integracao externa ainda nao habilitada.');
    }
  }
}
async function withJoins(req, table, rows, select) {
  if (!rows.length) return rows;
  if (table === 'conversations' && select.includes('contact:contacts(')) {
    const ids = rows.map(r => r.contact_id).filter(Boolean);
    const contacts = await prisma.contact.findMany({ where: { org_id: req.orgId, id: { in: ids } }, select: { id:true,name:true } });
    const byId = new Map(contacts.map(c=>[c.id,c]));
    return rows.map(r=>({ ...r, contact:byId.get(r.contact_id)||null }));
  }
  if (table === 'conversation_tags' && select.includes('tag:tags(')) {
    const tags = await prisma.tag.findMany({ where: { org_id: req.orgId, id: { in: rows.map(r => r.tag_id) } } });
    const mapping = new Map(tags.map(t => [t.id, t]));
    return rows.map(r => ({ ...r, tag: mapping.get(r.tag_id) || null }));
  }
  if ((table === 'schedules' || table === 'campaign_recipients') && select.includes('contact:contacts(')) {
    const contacts = await prisma.contact.findMany({ where: { org_id: req.orgId, id: { in: rows.map(r => r.contact_id).filter(Boolean) } }, select: { id:true, name:true } });
    const mapping = new Map(contacts.map(c => [c.id,c]));
    return rows.map(r => ({ ...r, contact: mapping.get(r.contact_id) || null }));
  }
  return rows;
}
function project(rows, select) {
  if (!select || select === '*' || select.includes(':') || select.includes('*')) return rows;
  const columns = select.split(',').map(s => s.trim());
  return rows.map(row => Object.fromEntries(columns.map(col => [col,row[col]])));
}
export function localDataRouter() {
  const router = Router();
  router.post('/query', wrap(async (req, res) => {
    const { table, filters = [], sort, limit = 100, select = '*' } = req.body || {};
    const { model } = allowed(table);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new HttpError(400, 'Limite invalido.');
    if (typeof select !== 'string' || select.length > 300) throw new HttpError(400, 'Selecao invalida.');
    const where = await scopedWhere(req, table, filters);
    const options = { where, take: limit };
    if (sort) {
      if (!Object.hasOwn(fields[table], sort.field)) throw new HttpError(400, 'Ordenacao invalida.');
      options.orderBy = { [sort.field]: sort.ascending ? 'asc' : 'desc' };
    }
    const [data, count] = await Promise.all([prisma[model].findMany(options), prisma[model].count({where})]);
    // Only safe tables can reach here; no password or credential tables in MODELS.
    const safeRows = table === 'integrations' ? data.map(({ config, ...rest }) => ({ ...rest, config: {} }))
      : table === 'messages' ? data.map(({ media_message, ...rest }) => ({ ...rest, media_location: rest.media_type === 'location' ? publicLocation(media_message) : null })) : data;
    res.json({ data: project(await withJoins(req, table, safeRows, select), select), count });
  }));
  router.post('/mutate', wrap(async (req, res) => {
    const { table, action, filters = [], values } = req.body || {};
    const { model } = allowed(table);
    if (!['insert','update','delete'].includes(action)) throw new HttpError(400, 'Acao invalida.');
    if(table==='conversations' && action==='insert')throw new HttpError(403,'Crie novas conversas pela API de conversas para selecionar o WhatsApp.');
    if (NO_WRITE.has(table)) throw new HttpError(403, 'Operacao nao permitida.');
    if (ADMIN_WRITE.has(table) || (table === 'contacts' && action === 'delete')) admins(req);
    if (table === 'org_members' && action === 'insert') throw new HttpError(403, 'Use a rota /api/team/members para incluir usuarios.');
    if (table === 'messages' && action !== 'insert') throw new HttpError(403, 'Mensagens nao podem ser editadas ou excluidas.');
    if (table === 'campaign_recipients' && action !== 'insert') throw new HttpError(403, 'Destinatarios nao podem ser alterados pelo cliente.');
    if (table === 'user_profiles' && action !== 'update') throw new HttpError(403, 'Perfil nao pode ser criado ou excluido aqui.');
    if (action !== 'insert' && (!Array.isArray(filters) || !filters.length || !filters.some(f => ['id', 'user_id', 'conversation_id', 'tag_id'].includes(f.field)))) {
      throw new HttpError(400, 'Alvo da alteracao precisa de identificador.');
    }
    const result = await prisma.$transaction(async tx => {
      if (action === 'insert') {
        const items = Array.isArray(values) ? values : [values];
        if (!items.length || items.length > 100) throw new HttpError(400, 'Quantidade de registros invalida.');
        const created = [];
        for (const raw of items) {
          const item = cleanWrite(table, raw, 'insert');
          enforce(table, item, 'insert');
          await validateReferences(tx, table, item, req.orgId);
          if(!admin(req) && item.conversation_id)await requireConversation(req,item.conversation_id,tx);
          if(!admin(req) && table==='conversation_tags')await requireConversation(req,item.conversation_id,tx);
          if (table === 'messages') {
            // Channel and agent are established server-side; no real WhatsApp sending.
            const conv = await tx.conversation.findFirst({ where: { id: item.conversation_id, org_id: req.orgId } });
            if (!conv) throw new HttpError(404, 'Conversa nao encontrada.');
            const msg = await tx.message.create({ data: {
              id:randomUUID(), org_id:req.orgId, conversation_id:conv.id, channel:conv.channel,
              body:item.body, is_internal: Boolean(item.is_internal), sender_type:'agent', sender_id:req.user.id, status:'local_only',
            }});
            await tx.conversation.update({ where: { id:conv.id }, data: { last_message_at:msg.created_at } });
            created.push(msg); continue;
          }
          const data = { ...item };
          if (Object.hasOwn(fields[table], 'id')) data.id = randomUUID();
          if (Object.hasOwn(fields[table], 'org_id')) data.org_id = req.orgId;
          if (Object.hasOwn(fields[table], 'created_by')) data.created_by = req.user.id;
          if (table === 'internal_notes') data.author_id = req.user.id;
          if (table === 'contacts' && data.custom_fields === undefined) data.custom_fields = {};
          if (table === 'contact_tags' || table === 'conversation_tags') {
            // A etiqueta pertence ao contato; as conversas apenas espelham a classificacao.
            const contactId = table === 'contact_tags' ? data.contact_id :
              (await tx.conversation.findFirst({where:{id:data.conversation_id,org_id:req.orgId},select:{contact_id:true}}))?.contact_id;
            if (!contactId) throw new HttpError(404, 'Contato da conversa nao encontrado.');
            await tx.contactTag.upsert({where:{contact_id_tag_id:{contact_id:contactId,tag_id:data.tag_id}},create:{contact_id:contactId,tag_id:data.tag_id},update:{}});
            const convs = await tx.conversation.findMany({where:{org_id:req.orgId,contact_id:contactId},select:{id:true}});
            for(const conv of convs) await tx.conversationTag.upsert({where:{conversation_id_tag_id:{conversation_id:conv.id,tag_id:data.tag_id}},create:{conversation_id:conv.id,tag_id:data.tag_id},update:{}});
            created.push(table==='contact_tags'?{contact_id:contactId,tag_id:data.tag_id}:{conversation_id:data.conversation_id,tag_id:data.tag_id});
          } else {
            if (table === 'campaign_recipients') {
              const existing = await tx.campaignRecipient.findFirst({ where:{ campaign_id:data.campaign_id, contact_id:data.contact_id } });
              if (existing) { created.push(existing); continue; }
            }
            created.push(await tx[model].create({ data }));
          }
        }
        return created;
      }
      const where = await scopedWhere(req, table, filters, tx);
      const found = await tx[model].findMany({ where, take: 100 });
      if (!found.length) return [];
      if (found.length >= 100) throw new HttpError(400, 'Operacao em massa nao autorizada.');
      if (table === 'org_members') {
        if (req.role !== 'owner') throw new HttpError(403, 'Somente o proprietario gerencia perfis.');
        if (found.some(r => r.role === 'owner')) throw new HttpError(403, 'Proprietario nao pode ser removido ou rebaixado.');
      }
      if (table === 'user_profiles' && found.some(r => r.user_id !== req.user.id)) throw new HttpError(403, 'So e permitido editar o proprio perfil.');
      if (action === 'delete') {
        if(table==='tags') {
          const ids=found.map(t=>t.id);
          await tx.conversationTag.deleteMany({where:{tag_id:{in:ids}}});
          await tx.contactTag.deleteMany({where:{tag_id:{in:ids}}});
        }
        if(table==='conversation_tags'||table==='contact_tags') {
          for(const link of found) {
            const contactId=table==='contact_tags'?link.contact_id:
              (await tx.conversation.findFirst({where:{id:link.conversation_id,org_id:req.orgId},select:{contact_id:true}}))?.contact_id;
            if(!contactId)continue;
            await tx.contactTag.deleteMany({where:{contact_id:contactId,tag_id:link.tag_id}});
            const ids=(await tx.conversation.findMany({where:{org_id:req.orgId,contact_id:contactId},select:{id:true}})).map(c=>c.id);
            await tx.conversationTag.deleteMany({where:{conversation_id:{in:ids},tag_id:link.tag_id}});
          }
          return found;
        }
        await tx[model].deleteMany({where}); return found;
      }
      const item = cleanWrite(table, values, 'update');
      enforce(table, item, 'update');
      await validateReferences(tx, table, item, req.orgId);
      if(table==='conversations' && item.assigned_to){for(const existing of found)await requireAssigneeForChannel(req.orgId,item.assigned_to,existing.integration_id,tx);}
      if(!admin(req)&&item.conversation_id)await requireConversation(req,item.conversation_id,tx);
      if (table === 'org_members' && !item.role) throw new HttpError(400,'Perfil nao informado.');
      await tx[model].updateMany({ where, data: item });
      // As regras de automacao usam nomes de etiquetas, nao IDs.
      // Ao renomear, mantemos os gatilhos/acoes existentes alinhados.
      if (table === 'tags' && item.name) {
        const rules = await tx.automation.findMany({where:{org_id:req.orgId}});
        for (const oldTag of found) {
          if (oldTag.name === item.name) continue;
          for (const rule of rules) {
            let changed = false;
            const trigger = structuredClone(rule.trigger);
            const actions = structuredClone(rule.actions);
            if (trigger && typeof trigger === 'object' && trigger.type === 'tag_added' && trigger.tag === oldTag.name) {trigger.tag=item.name;changed=true;}
            if (Array.isArray(actions)) for(const action of actions) if(action.type==='add_tag'&&action.tag===oldTag.name){action.tag=item.name;changed=true;}
            if(changed)await tx.automation.update({where:{id:rule.id},data:{trigger,actions}});
          }
        }
      }
      return tx[model].findMany({where, take:100});
    });
    res.json({ data: result });
    // Manual tagging triggers automations after the DB transaction commits.
    if (table === 'conversation_tags' && action === 'insert') {
      for (const link of result) {
        (async () => {
          const tag = await prisma.tag.findFirst({ where: { id: link.tag_id, org_id: req.orgId }, select: { name: true } });
          if (tag) await processTagAdded({ orgId: req.orgId, conversationId: link.conversation_id, tagName: tag.name, tagId: link.tag_id });
        })().catch(error => console.error('[Workflow] Gatilho de etiqueta falhou:', error.message));
      }
    }
  }));
  return router;
}
