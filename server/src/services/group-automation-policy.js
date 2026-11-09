/** Pure validation and clock helpers. No group is ever monitored implicitly. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validUuid = value => typeof value === 'string' && UUID.test(value);
export const groupRuleType = trigger => ['group_no_reply','group_daily_summary'].includes(trigger?.type);
export const validSummaryTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function groupTriggerError(trigger, actions) {
  if (!groupRuleType(trigger)) return null;
  if (!validUuid(trigger.group_id)) return 'Selecione o grupo a monitorar.';
  if (trigger.type === 'group_no_reply') {
    if (!Number.isInteger(trigger.timeout_minutes) || trigger.timeout_minutes < 1 || trigger.timeout_minutes > 10080)
      return 'Informe um intervalo de 1 a 10080 minutos.';
    if (!['group','us'].includes(trigger.waiting_for)) return 'Escolha quem deve responder: o grupo ou nossa equipe.';
    if (!Array.isArray(actions) || !actions.length || actions.length > 10) return 'Selecione de 1 a 10 ações.';
    for (const item of actions) {
      if (!item || !['send_message','add_tag','replace_tag','assign_team','call_webhook'].includes(item.type)) return 'Ação não permitida.';
      const field = {send_message:'text',add_tag:'tag',replace_tag:'tag',assign_team:'team',call_webhook:'url'}[item.type];
      if (typeof item[field] !== 'string' || !item[field].trim() || item[field].length > 3000) return 'Preencha os dados da ação.';
      if (item.type === 'replace_tag' && (typeof item.old_tag !== 'string' || !item.old_tag.trim() || item.old_tag.length > 160)) return 'Informe a etiqueta a substituir.';
    }
  } else {
    if (!validSummaryTime(trigger.time)) return 'Informe o horário do resumo (HH:mm).';
    if (!trigger.recipient || !['group','contact'].includes(trigger.recipient.kind)) return 'Selecione o grupo ou contato que receberá o resumo.';
    if (trigger.recipient.kind === 'group' && !validUuid(trigger.recipient.group_id)) return 'Selecione o grupo destinatário.';
    if (trigger.recipient.kind === 'contact' && (!validUuid(trigger.recipient.contact_id) || !validUuid(trigger.recipient.integration_id)))
      return 'Selecione o contato e a instância de envio.';
    if (!Array.isArray(actions) || actions.length !== 1 || actions[0]?.type !== 'ai_daily_summary')
      return 'Resumo diário requer somente a ação de resumo por IA.';
  }
  return null;
}
export function zonedDay(now = new Date(), zone = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const n = key => parts.find(p=>p.type===key)?.value;
  return { day:`${n('year')}-${n('month')}-${n('day')}`,clock:`${n('hour')}:${n('minute')}` };
}
/** Own message: waiting on group. Customer message: waiting on our team. */
export function awaitingSide(message) {
  if (!message || message.is_bot || message.is_internal) return null;
  return ['agent','bot'].includes(message.sender_type) ? 'group' : message.sender_type === 'contact' ? 'us' : null;
}
export function eligibleGroupSilence({last,trigger,updatedAt,now}) {
  const mins = Number(trigger?.timeout_minutes);
  return Boolean(last && awaitingSide(last) === trigger?.waiting_for &&
    Number.isInteger(mins) && mins >= 1 && mins <= 10080 &&
    // Regra criada/editada depois da ultima mensagem: contar a partir da ativacao,
    // sem disparar retroativamente e sem exigir uma nova mensagem do cliente.
    now.getTime()-Math.max(last.created_at.getTime(), updatedAt.getTime()) >= mins*60000);
}
/** Evolution may include every group participant in findContacts. Import only saved address-book entries. */
export function isSavedPersonalContact(record) {
  if (!record || record.isGroup === true || record.is_group === true || record.type === 'group') return false;
  const flags = [record.isSaved,record.isMyContact,record.contact?.isSaved].filter(v=>typeof v==='boolean');
  if (flags.includes(false)) return false;
  if (flags.includes(true)) return true;
  // Some Evolution installations omit isSaved: keep explicit address-book names,
  // never assume that pushName means the user saved this participant.
  return [record.name,record.savedName,record.contactName,record.fullName,record.contact?.name]
    .some(v=>typeof v==='string' && v.trim().length > 0);
}
