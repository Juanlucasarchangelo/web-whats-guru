/** Pure date automation contract. No database or external dependencies. */
import { createHash } from 'node:crypto';
export const EVENT_TYPES = ['customer_birthday','child_birthday','invoice_renewal'];
const idOK = /^[\w.:@-]{1,128}$/;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x)===Object.prototype;
function validDate(y,m,d) {
  const t = new Date(Date.UTC(y,m-1,d));
  return t.getUTCFullYear()===y && t.getUTCMonth()===m-1 && t.getUTCDate()===d;
}
export function parseDay(raw, {allowDayMonth=false}={}) {
  if (typeof raw!=='string') return null;
  const s=raw.trim();let y,m,d;
  let a=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if(a) {y=Number(a[1]);m=Number(a[2]);d=Number(a[3]);}
  else {a=/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/.exec(s);
    if(a) {d=Number(a[1]);m=Number(a[2]);y=a[3]?Number(a[3]):2000;}
    else {a=allowDayMonth?/^(\d{2})-(\d{2})$/.exec(s):null;
      if(!a)return null; m=Number(a[1]);d=Number(a[2]);y=2000;}
  }
  if(y<1900||y>2200||!validDate(y,m,d))return null;
  return {year:y,month:m,day:d,full:/^\d{4}-/.test(s)||/\/\d{4}$/.test(s)};
}
export function localDate(now=new Date(),timezone='America/Sao_Paulo') {
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const n=k=>Number(p.find(x=>x.type===k)?.value);
  return {year:n('year'),month:n('month'),day:n('day'),hour:n('hour'),minute:n('minute')};
}
function iso({year,month,day}) {return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
function plusDays(today,days) {const t=new Date(Date.UTC(today.year,today.month-1,today.day+days));return {year:t.getUTCFullYear(),month:t.getUTCMonth()+1,day:t.getUTCDate()};}
function anniversary(d,today) {return d && d.month===today.month && d.day===today.day;}
const safeStr=(s,max=160)=>String(s??'').trim().slice(0,max);
export function normalizeCustomers(data) {
  const entries=Array.isArray(data?.clientes)?data.clientes:data?.records;
  if(!Array.isArray(entries)||entries.length>1000)throw Error('n8n deve retornar clientes ou records (0 a 1000 registros).');
  const seen=new Set();
  return entries.map((row,i)=>{
    if(!plain(row))throw Error(`Cliente ${i+1} inválido.`);
    const id=safeStr(row.id_externo,128),name=safeStr(row.nome),phone=String(row.telefone||'').replace(/\D/g,'');
    if(!idOK.test(id)||!name||!/^[0-9]{10,15}$/.test(phone))throw Error(`Cliente ${i+1}: id_externo, nome ou telefone inválido.`);
    if(seen.has(id))throw Error(`ID duplicado: ${id}`);seen.add(id);
    const children=Array.isArray(row.filhos)?row.filhos:[];
    const invoices=Array.isArray(row.faturas)?row.faturas:[];
    if(children.length>30||invoices.length>100)throw Error(`Cliente ${i+1}: listas grandes demais.`);
    for(const [type,items] of [['filhos',children],['faturas',invoices]])for(const o of items){if(!plain(o)||!idOK.test(safeStr(o.id_externo??o.id,128)))throw Error(`Cliente ${i+1}: ${type} requer ID estável.`);}
    return {id,nome:name,telefone:phone,data_nascimento:row.data_nascimento,filhos:children,faturas:invoices,
      consentimento_whatsapp:row.consentimento_whatsapp===true};
  });
}
export function dueEvents(customers,trigger,today) {
  if(!EVENT_TYPES.includes(trigger.event_key))throw Error('Tipo de evento desconhecido.');
  const days=Number(trigger.days_before??0);
  if(!Number.isInteger(days)||days<0||days>365)throw Error('Antecedência inválida.');
  const target=plusDays(today,days); const out=[];
  for(const c of customers){
    if(!c.consentimento_whatsapp)continue;
    const make=(suffix,variables,occurrence)=>out.push({customer:c,unique:`${c.id}:${suffix}:${occurrence}`,variables,occurrence});
    if(trigger.event_key==='customer_birthday'){
      const date=parseDay(c.data_nascimento,{allowDayMonth:true});
      if(anniversary(date,today))make('birthday',{nome:c.nome},iso(today));
    }else if(trigger.event_key==='child_birthday'){
      for(const child of c.filhos){const date=parseDay(child.data_nascimento,{allowDayMonth:true});
        if(anniversary(date,today))make(`child:${child.id_externo??child.id}`,{nome:c.nome,nome_filho:safeStr(child.nome)},iso(today));}
    }else{
      for(const bill of c.faturas){const date=parseDay(bill.data_renovacao);
        if(date?.full&&iso(date)===iso(target))make(`invoice:${bill.id_externo??bill.id}:${days}`,{nome:c.nome,data_renovacao:iso(target),dias_antecedencia:String(days)},iso(target));}
    }
  }
  return out;
}
export function renderExternalMessage(template,variables) {
  return String(template||'').replace(/\{\{?\s*([a-z_]+)\s*\}?\}/gi,(full,key)=>Object.hasOwn(variables,key.toLowerCase())?String(variables[key.toLowerCase()]??''):full).trim();
}
export function deterministicId(parts){const h=createHash('sha256').update(JSON.stringify(parts)).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
