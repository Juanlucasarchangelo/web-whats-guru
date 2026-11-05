// Notification uses backend-side Resend credentials. No auth token is included in the link.
const defaultDevUrl='https://falacomigo.importsbr.cloud/?page=devConsole&tab=pending';
export function devApprovalUrl() {
  const configured=process.env.DEV_PANEL_URL?.trim();
  if(!configured)return defaultDevUrl;
  try {
    const parsed=new URL(configured);
    if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)return defaultDevUrl;
    parsed.searchParams.set('page','devConsole');
    parsed.searchParams.set('tab','pending');
    return parsed.toString();
  } catch { return defaultDevUrl; }
}
const escapeHtml=(text)=>String(text??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export async function notifyDevRequest({ email, fullName, createdAt }) {
  const to=process.env.DEV_NOTIFICATION_EMAIL?.trim();
  const from=process.env.RESEND_FROM_EMAIL?.trim();
  const key=process.env.RESEND_API_KEY?.trim();
  if(!to||!from||!key){
    console.warn('[DEV] Novo cadastro pendente; notificacao de e-mail nao configurada.');
    return false;
  }
  const url=devApprovalUrl();
  const subject='FalaComigo: novo cadastro aguardando aprovacao';
  const text=[
    'Uma nova conta solicita aprovacao no FalaComigo.',
    `Nome: ${fullName}`,
    `E-mail: ${email}`,
    `Data: ${createdAt}`,
    `Acessar aprovacoes: ${url}`,
    'Entre com sua conta DEV para aprovar ou rejeitar. Nao responda a este e-mail.',
  ].join('\n');
  const html=`<!doctype html><html lang="pt-BR"><body style="margin:0;padding:28px;background:#f2f2f0;font-family:Arial,sans-serif;color:#1a1a1a"><div style="max-width:560px;margin:auto;background:white;border-radius:14px;padding:30px;border:1px solid #e5e7eb"><h1 style="font-size:22px;margin:0 0 16px">Novo cadastro aguardando aprovação</h1><p>Uma nova conta solicita acesso ao FalaComigo.</p><p><strong>Nome:</strong> ${escapeHtml(fullName)}<br><strong>E-mail:</strong> ${escapeHtml(email)}<br><strong>Data:</strong> ${escapeHtml(createdAt)}</p><p style="margin:30px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#ffc734;color:#1a1a1a;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir aprovações no FalaComigo</a></p><p style="font-size:12px;color:#6b7280">O acesso requer login DEV. Não responda a este e-mail.</p></div></body></html>`;
  try{
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({from,to:[to],subject,text,html}),signal:AbortSignal.timeout(10000),
    });
    if(!response.ok){console.error('[DEV] E-mail recusado pelo provedor:',response.status);return false;}
    return true;
  }catch(error){console.error('[DEV] E-mail indisponivel:',error?.message||'Falha de rede');return false;}
}
