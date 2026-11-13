/** Inbound JSON contract for n8n. Pure helpers are tested without a database. */
import { createHash, timingSafeEqual } from 'node:crypto';

export const EXTERNAL_EVENT_KEY = /^[a-z][a-z0-9_]{1,49}$/;
export const EXTERNAL_RECORD_LIMIT = 100;
const BAD_KEYS = new Set(['__proto__','prototype','constructor','token','senha','password','api_key','secret']);
const ID_PATTERN = /^[\w.:@-]{1,128}$/;

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}
export function validExternalToken(header, stored) {
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(String(header || ''));
  if (!match || !/^[a-f0-9]{64}$/i.test(String(stored || ''))) return false;
  return timingSafeEqual(Buffer.from(tokenHash(match[1]), 'hex'), Buffer.from(stored,'hex'));
}

function validCalendarDay(month,day) {
  const m=Number(month),d=Number(day);
  const date=new Date(Date.UTC(2000,m-1,d)); // Leap year supports 29 February.
  return date.getUTCMonth()===m-1 && date.getUTCDate()===d;
}
export function eventDate(raw, mode) {
  if (mode==='immediate') return null;
  const value=String(raw || '').trim();
  let day,month,year;
  let match=/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/.exec(value);
  if(match) {[,day,month,year]=match;}
  else {
    match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if(match) {year=match[1];month=match[2];day=match[3];}
    else {
      match=/^(\d{2})-(\d{2})$/.exec(value);
      if(match) {month=match[1];day=match[2];}
    }
  }
  if (!month || !day || !validCalendarDay(month,day)) throw Error('Data inválida: use DD/MM, DD/MM/AAAA ou AAAA-MM-DD.');
  if (mode==='annual') return `${month}-${day}`;
  if (!year || Number(year)<2000 || Number(year)>2100) throw Error('Para execução única, informe a data completa (AAAA-MM-DD).');
  const full=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
  if(full.getUTCFullYear()!==Number(year) || full.getUTCMonth()!==Number(month)-1 || full.getUTCDate()!==Number(day)) throw Error('Data inválida.');
  return `${year}-${month}-${day}`;
}
const plainObject=(o)=>o && typeof o==='object' && !Array.isArray(o) && Object.getPrototypeOf(o)===Object.prototype;
export function normalizeExternalBatch(payload, trigger) {
  if (!plainObject(payload) || !Array.isArray(payload.records) || payload.records.length<1 || payload.records.length>EXTERNAL_RECORD_LIMIT)
    throw Error(`Envie records com 1 a ${EXTERNAL_RECORD_LIMIT} registros.`);
  if (String(payload.event || '')!==trigger.event_key) throw Error('Evento não corresponde ao configurado na automação.');
  const recurrence=trigger.recurrence;
  if(!['annual','once','immediate'].includes(recurrence)) throw Error('Recorrência inválida na automação.');
  const records=payload.records.map((item,i)=>{
    if(!plainObject(item)) throw Error(`Registro ${i+1}: dados inválidos.`);
    const id=String(item.id_externo ?? '').trim();
    if(!ID_PATTERN.test(id)) throw Error(`Registro ${i+1}: id_externo inválido.`);
    const nome=String(item.nome ?? '').trim();
    if(!nome || nome.length>160) throw Error(`Registro ${i+1}: informe nome (até 160 caracteres).`);
    const telefone=String(item.telefone ?? '').replace(/\D/g,'');
    if(!/^\d{10,15}$/.test(telefone)) throw Error(`Registro ${i+1}: telefone deve conter 10 a 15 dígitos.`);
    const date=eventDate(item.data_evento ?? item.aniversario, recurrence);
    const data=Object.create(null);
    const keys=Object.keys(item);
    if(keys.length>30) throw Error(`Registro ${i+1}: máximo 30 campos.`);
    for(const key of keys) {
      if (!/^[a-zA-Z][\w]{0,49}$/.test(key) || BAD_KEYS.has(key.toLowerCase())) throw Error(`Registro ${i+1}: campo inválido.`);
      const value=item[key];
      if(value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw Error(`Registro ${i+1}: campo ${key} não é texto ou número.`);
      if(String(value ?? '').length>500) throw Error(`Registro ${i+1}: campo ${key} muito longo.`);
      data[key]=value;
    }
    return {external_id:id,display_name:nome,phone:telefone,event_date:date,payload:JSON.parse(JSON.stringify(data))};
  });
  if(new Set(records.map(x=>x.external_id)).size!==records.length) throw Error('O JSON contém id_externo repetido no mesmo lote.');
  return records;
}
