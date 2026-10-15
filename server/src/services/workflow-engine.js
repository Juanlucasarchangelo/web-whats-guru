/**
 * Whats-Guru deterministic workflow executor. No extra tables or AI keys required.
 * Invoked only for genuinely new Evolution inbound messages; manual history recovery
 * never starts a bot for old messages. Persisted state uses an isolated key in
 * contacts.custom_fields, and run audit uses the existing webhook_events table.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { sendEvolutionText } from './evolution.js';

const SESSION_KEY = '_whats_guru_chatbot_v1';
const MAX_STEPS = 18;
const MAX_ACTIONS = 10;
const locks = new Map();
const norm = s => String(s ?? '').trim().toLocaleLowerCase('pt-BR');
const validName = s => String(s ?? '').trim().slice(0, 160);

export function matchesKeyword(text, keyword) {
  const needle = norm(keyword);
  if (!needle) return false;
  return norm(text).includes(needle);
}
export function outsideHours(now, hours, timeZone = 'America/Sao_Paulo') {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(hours || '18:00-08:00').trim());
  if (!match) return false;
  const [, ah, am, bh, bm] = match.map(Number);
  if (ah > 23 || bh > 23 || am > 59 || bm > 59) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = key => Number(parts.find(p => p.type === key)?.value ?? 0);
  const t = part('hour') * 60 + part('minute');
  const a = ah * 60 + am; const b = bh * 60 + bm;
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

// One conversation at a time inside this process to avoid concurrent bot transitions.
async function serialized(id, fn) {
  const prior = locks.get(id) ?? Promise.resolve();
  const task = prior.catch(() => {}).then(fn);
  locks.set(id, task);
  try { return await task; } finally { if (locks.get(id) === task) locks.delete(id); }
}
async function context(orgId, conversationId) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, org_id: orgId, channel: 'whatsapp' } });
  if (!conversation || conversation.status === 'closed') return null;
  const contact = await prisma.contact.findFirst({ where: { id: conversation.contact_id, org_id: orgId } });
  if (!contact) return null;
  return { orgId, conversation, contact };
}
async function record(ctx, event, details = {}, error = null) {
  await prisma.webhookEvent.create({ data: {
    id: randomUUID(), org_id: ctx.orgId, source: 'workflow_engine', event_type: String(event).slice(0, 200),
    payload: { conversation_id: ctx.conversation.id, ...details }, processed: !error,
    ...(error ? { error: String(error.message || error).slice(0, 1500) } : { processed_at: new Date() }),
  } });
}
async function alreadyRan(orgId, key) {
  return Boolean(await prisma.webhookEvent.findFirst({ where: { org_id: orgId, source: 'workflow_engine', event_type: key, processed: true }, select: { id: true } }));
}
function render(text, ctx, answer = '') {
  return String(text || '').replace(/\{\{\s*(nome|telefone|resposta)\s*\}\}/gi, (_m, key) => {
    const values = { nome: ctx.contact.name, telefone: ctx.contact.phone, resposta: answer };
    return String(values[norm(key)] || '');
  });
}
async function send(ctx, text, answer = '') {
  const body = render(text, ctx, answer).trim();
  if (!body) throw Error('A mensagem do fluxo esta vazia.');
  if (body.length > 10000) throw Error('Mensagem excede 10 mil caracteres.');
  // The same production Evolution sender as the manual inbox.
  const message = await sendEvolutionText({ orgId: ctx.orgId, conversation: ctx.conversation, text: body, userId: null });
  await prisma.message.update({ where: { id: message.id }, data: { sender_type: 'bot', is_bot: true } });
  return message;
}
async function saveSession(ctx, data) {
  const fresh = await prisma.contact.findFirst({ where: { id: ctx.contact.id, org_id: ctx.orgId }, select: { custom_fields: true } });
  const base = fresh?.custom_fields && typeof fresh.custom_fields === 'object' && !Array.isArray(fresh.custom_fields) ? fresh.custom_fields : {};
  const updated = { ...base };
  const scopedKey = `${SESSION_KEY}_${ctx.conversation.id}`;
  if (data) updated[scopedKey] = data;
  else delete updated[scopedKey];
  delete updated[SESSION_KEY];
  await prisma.contact.update({ where: { id: ctx.contact.id }, data: { custom_fields: updated } });
  ctx.contact.custom_fields = updated;
}
function sessionOf(ctx) {
  const state = ctx.contact.custom_fields?.[`${SESSION_KEY}_${ctx.conversation.id}`] ?? ctx.contact.custom_fields?.[SESSION_KEY];
  return state && state.conversation_id === ctx.conversation.id ? state : null;
}
async function tag(ctx, name, notify = true) {
  const label = validName(name);
  if (!label) throw Error('Informe o nome da etiqueta.');
  let found = await prisma.tag.findFirst({ where: { org_id: ctx.orgId, name: label } });
  if (!found) {
    try { found = await prisma.tag.create({ data: { id: randomUUID(), org_id: ctx.orgId, name: label, color: '#3b82f6' } }); }
    catch (e) { if (e.code !== 'P2002') throw e; found = await prisma.tag.findFirst({ where: { org_id: ctx.orgId, name: label } }); }
  }
  const existing = await prisma.conversationTag.findUnique({ where: { conversation_id_tag_id: { conversation_id: ctx.conversation.id, tag_id: found.id } } });
  if (!existing) {
    await prisma.conversationTag.create({ data: { conversation_id: ctx.conversation.id, tag_id: found.id } });
    if (notify) await runMatching(ctx, { triggerType: 'tag_added', tag: label, token: `tag:${ctx.conversation.id}:${found.id}`, allowRecursive: false });
  }
}
async function assign(ctx, teamName) {
  const name = validName(teamName);
  const team = await prisma.team.findFirst({ where: { org_id: ctx.orgId, name } });
  if (!team) throw Error(`Time nao encontrado: ${name}. Cadastre-o primeiro na tela Equipe.`);
  const members = await prisma.teamMember.findMany({ where: { team_id: team.id }, select: { user_id: true } });
  const ids = members.map(m => m.user_id);
  const source = await prisma.integration.findFirst({where:{id:ctx.conversation.integration_id??'',org_id:ctx.orgId,type:'whatsapp'},select:{config:true}});
  const restrictions=Array.isArray(source?.config?.team_ids)?source.config.team_ids:[];
  if(restrictions.length && !restrictions.includes(team.id))throw Error(`O time ${name} nao tem permissao para atender este WhatsApp.`);
  const active = ids.length ? await prisma.orgMember.findFirst({ where: { org_id: ctx.orgId, user_id: { in: ids }, status: 'active' }, orderBy: { created_at: 'asc' } }) : null;
  if (!active) throw Error(`Time ${name} sem atendente ativo.`);
  await prisma.conversation.update({ where: { id: ctx.conversation.id }, data: { assigned_to: active.user_id } });
}
async function webhook(ctx, url, answer = '') {
  const parsed = new URL(String(url || ''));
  // An explicit allow-list prevents arbitrary stored URLs from reaching the
  // developer's private network or metadata endpoints (SSRF).
  const allow = String(process.env.AUTOMATION_WEBHOOK_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !allow.includes(parsed.hostname.toLowerCase())) {
    throw Error('Webhook bloqueado. Use HTTPS e inclua o hostname em AUTOMATION_WEBHOOK_ALLOWED_HOSTS no server/.env.');
  }
  const response = await fetch(parsed.toString(), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'whats_guru_workflow', conversation_id: ctx.conversation.id, contact_id: ctx.contact.id, answer }),
  });
  if (!response.ok) throw Error(`Webhook externo retornou HTTP ${response.status}.`);
}
async function action(ctx, item, answer = '') {
  switch (item?.type) {
    case 'send_message': return send(ctx, item.text, answer);
    case 'add_tag': return tag(ctx, item.tag);
    case 'assign_team': return assign(ctx, item.team);
    case 'call_webhook': return webhook(ctx, item.url, answer);
    default: throw Error(`Acao nao suportada: ${String(item?.type)}`);
  }
}
async function runMatching(ctx, { triggerType, text = '', tag: addedTag = '', isNew = false, token = '', allowRecursive = true, onlyRuleId = null }) {
  const automations = await prisma.automation.findMany({ where: { org_id: ctx.orgId, status: 'active' }, orderBy: { created_at: 'asc' } });
  let actions = 0;
  for (const rule of automations) {
    if (onlyRuleId && rule.id !== onlyRuleId) continue;
    const config = rule.trigger && typeof rule.trigger === 'object' ? rule.trigger : {};
    if (config.type !== triggerType) continue;
    if (triggerType === 'new_conversation' && !isNew) continue;
    if (triggerType === 'keyword' && !matchesKeyword(text, config.keyword)) continue;
    if (triggerType === 'out_of_hours' && !outsideHours(new Date(), config.hours)) continue;
    if (triggerType === 'tag_added' && norm(config.tag) !== norm(addedTag)) continue;
    const key = `automation:${rule.id}:${token}`;
    if (await alreadyRan(ctx.orgId, key)) continue;
    const steps = Array.isArray(rule.actions) ? rule.actions.slice(0, MAX_ACTIONS) : [];
    // A rule is not marked executed if there is a failure. Stop on the failure;
    // logs keep the error visible and prevent a false "sent" success message.
    try {
      for (const item of steps) {
        if (actions >= MAX_ACTIONS) throw Error('Limite de acoes por evento excedido.');
        if (item.type === 'add_tag' && !allowRecursive) await tag(ctx, item.tag, false);
        else await action(ctx, item, text);
        actions++;
      }
      await record(ctx, key, { rule_id: rule.id, actions: steps.length });
    } catch (error) {
      await record(ctx, key, { rule_id: rule.id, actions_attempted: actions }, error);
      console.error('[Workflow] Automacao falhou:', { orgId: ctx.orgId, rule: rule.id, message: error.message });
    }
  }
}
function nextNode(flow, from) {
  const edge = (flow.edges || []).find(e => e.from === from);
  return (flow.nodes || []).find(n => n.id === edge?.to);
}
function conditionValue(ctx, field, answer) {
  const values = { resposta: answer, answer, nome: ctx.contact.name, telefone: ctx.contact.phone };
  return norm(values[norm(field)] ?? '');
}
function meetsCondition(ctx, node, answer) {
  const left = conditionValue(ctx, node.data?.field, answer); const right = norm(node.data?.value);
  if (node.data?.operator === 'not_equals') return left !== right;
  if (node.data?.operator === 'contains') return Boolean(right) && left.includes(right);
  return left === right;
}
async function executeFlow(ctx, bot, fromId, answer = '') {
  const flow = bot.flow && typeof bot.flow === 'object' ? bot.flow : {};
  let current = nextNode(flow, fromId);
  for (let i = 0; current && i < MAX_STEPS; i++) {
    const node = current; const data = node.data || {};
    if (node.type === 'message') await send(ctx, data.text, answer);
    else if (node.type === 'question') {
      const opts = Array.isArray(data.options) ? data.options.filter(Boolean) : [];
      await send(ctx, `${data.text || 'Escolha uma opcao:'}${opts.length ? '\n' + opts.map((s, index) => `${index + 1}. ${s}`).join('\n') : ''}`, answer);
      await saveSession(ctx, { conversation_id: ctx.conversation.id, bot_id: bot.id, waiting_for: node.id, updated_at: new Date().toISOString() });
      return;
    } else if (node.type === 'condition' && !meetsCondition(ctx, node, answer)) {
      await saveSession(ctx, null); return;
    } else if (node.type === 'tag') await tag(ctx, data.tag);
    else if (node.type === 'assign') await assign(ctx, data.team);
    else if (node.type === 'webhook') await webhook(ctx, data.url, answer);
    else if (node.type === 'delay') {
      const count = Math.max(1, Math.min(Number(data.delay) || 1, 86400));
      const ms = count * ({ seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[data.delayUnit] || 60000);
      await saveSession(ctx, { conversation_id: ctx.conversation.id, bot_id: bot.id, resume_from: node.id, resume_at: new Date(Date.now() + ms).toISOString(), answer, updated_at: new Date().toISOString() });
      return;
    } else if (node.type === 'close') {
      if (data.text) await send(ctx, data.text, answer);
      await prisma.conversation.update({ where: { id: ctx.conversation.id }, data: { status: 'closed' } });
      await saveSession(ctx, null); return;
    } else if (node.type !== 'start') throw Error(`No nao suportado: ${node.type}`);
    current = nextNode(flow, node.id);
  }
  if (current) throw Error(`Chatbot excedeu limite de ${MAX_STEPS} nos por execucao.`);
  await saveSession(ctx, null);
}
async function handleBot(ctx, { text, isNew }) {
  const old = sessionOf(ctx);
  if (old) {
    const bot = await prisma.chatbot.findFirst({ where: { id: old.bot_id, org_id: ctx.orgId, status: 'active' } });
    if (!bot) { await saveSession(ctx, null); return; }
    if (old.resume_at) {
      // Incoming message during a timed delay doesn't prematurely resume the flow.
      return;
    }
    if (old.waiting_for) {
      if (['sair', 'cancelar', 'atendente', 'humano'].includes(norm(text))) {
        await saveSession(ctx, null);
        await record(ctx, `chatbot:handoff:${bot.id}`, { bot_id: bot.id, outcome: 'cancelled_by_customer' });
        return;
      }
      const question = (bot.flow?.nodes || []).find(n => n.id === old.waiting_for);
      const options = question?.data?.options || [];
      const choice = /^\d+$/.test(text.trim()) ? options[Number(text.trim()) - 1] : options.find(o => norm(o) === norm(text));
      // Free-text questions are allowed when there are no choices.
      if (options.length && !choice) {
        await send(ctx, `Por favor, escolha uma opcao de 1 a ${options.length}, ou digite *atendente* para encerrar o robô.`);
        return;
      }
      await saveSession(ctx, null);
      await executeFlow(ctx, bot, old.waiting_for, choice || text);
    }
    return;
  }
  const bots = await prisma.chatbot.findMany({ where: { org_id: ctx.orgId, status: 'active' }, orderBy: { created_at: 'asc' } });
  for (const bot of bots) {
    if (bot.trigger_channel && bot.trigger_channel !== 'whatsapp') continue;
    if (bot.trigger_keyword ? !matchesKeyword(text, bot.trigger_keyword) : !isNew) continue;
    const start = (bot.flow?.nodes || []).find(n => n.type === 'start');
    if (!start) { await record(ctx, 'chatbot:invalid', { bot_id: bot.id }, Error('Fluxo sem no inicial.')); continue; }
    await executeFlow(ctx, bot, start.id, text);
    await record(ctx, 'chatbot:started', { bot_id: bot.id, new_conversation: isNew });
    break; // Only one bot starts for an inbound message.
  }
}

/** Called only after a new inbound WhatsApp message has been saved successfully. */
export async function processIncomingWorkflows({ orgId, conversationId, text, isNew, messageId }) {
  return serialized(conversationId, async () => {
    const ctx = await context(orgId, conversationId);
    if (!ctx) return;
    // Dedupe handled by persisted Evolution provider-message ID in messages table.
    try {
      await runMatching(ctx, { triggerType: 'new_conversation', isNew, token: messageId, text });
      await runMatching(ctx, { triggerType: 'keyword', text, token: messageId });
      await runMatching(ctx, { triggerType: 'out_of_hours', text, token: messageId });
      await handleBot(ctx, { text, isNew });
    } catch (error) {
      await record(ctx, 'chatbot:processing_error', { message_id: messageId }, error);
      console.error('[Workflow] Erro no chatbot:', { conversationId, error: error.message });
    }
  });
}
/** Called when a staff member manually adds a conversation tag. */
export async function processTagAdded({ orgId, conversationId, tagName, tagId }) {
  return serialized(conversationId, async () => {
    const ctx = await context(orgId, conversationId); if (!ctx) return;
    await runMatching(ctx, { triggerType: 'tag_added', tag: tagName, token: `tag:${conversationId}:${tagId}` });
  });
}
let runningTick = false;
/** Scheduled rules and delayed bot nodes. Call from a single Node process only. */
export async function workflowTick() {
  if (runningTick) return;
  runningTick = true;
  try {
    const orgs = await prisma.organization.findMany({ where: { status: 'active' }, select: { id: true }, take: 100 });
    for (const org of orgs) {
      const rules = await prisma.automation.findMany({ where: { org_id: org.id, status: 'active' }, select: { id: true, trigger: true, updated_at: true } });
      const delays = await prisma.contact.findMany({ where: { org_id: org.id }, select: { id: true, custom_fields: true }, take: 2000 });
      for (const contact of delays) {
        const session = contact.custom_fields?.[SESSION_KEY];
        if (!session?.resume_at || Date.parse(session.resume_at) > Date.now()) continue;
        await serialized(session.conversation_id, async () => {
          const ctx = await context(org.id, session.conversation_id); if (!ctx) return;
          const current = sessionOf(ctx);
          if (!current?.resume_at || current.resume_at !== session.resume_at) return;
          const bot = await prisma.chatbot.findFirst({ where: { id: current.bot_id, org_id: org.id, status: 'active' } });
          try {
            await saveSession(ctx, null);
            if (bot) await executeFlow(ctx, bot, current.resume_from, current.answer || '');
          } catch (error) {
            await record(ctx, 'chatbot:delay_error', { bot_id: current.bot_id }, error);
          }
        });
      }
      for (const rule of rules) {
        if (rule.trigger?.type !== 'no_response') continue;
        const minutes = Number(rule.trigger?.timeout_minutes);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) continue;
        const cutoff = new Date(Date.now() - minutes * 60000);
        const conversations = await prisma.conversation.findMany({ where: { org_id: org.id, channel: 'whatsapp', status: { not: 'closed' }, last_message_at: { lte: cutoff } }, select: { id: true }, take: 100 });
        for (const row of conversations) {
          await serialized(row.id, async () => {
            const ctx = await context(org.id, row.id); if (!ctx) return;
            const last = await prisma.message.findFirst({ where: { org_id: org.id, conversation_id: row.id, is_internal: false }, orderBy: { created_at: 'desc' } });
            // Only customer-last messages count as "awaiting an agent". One firing per message.
            if (!last || last.sender_type !== 'contact' || last.created_at > cutoff) return;
            // Do not retroactively send an automation to customers who wrote before it was enabled.
            if (last.created_at < rule.updated_at) return;
            await runMatching(ctx, { triggerType: 'no_response', token: `unanswered:${last.id}`, onlyRuleId: rule.id });
          });
        }
      }
    }
  } finally { runningTick = false; }
}
