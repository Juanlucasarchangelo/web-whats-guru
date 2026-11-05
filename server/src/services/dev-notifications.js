// Notificacao opcional via API HTTPS de e-mail. NUNCA expor a chave ao browser.
// Configure DEV_NOTIFICATION_EMAIL, RESEND_API_KEY e RESEND_FROM_EMAIL no ambiente do backend.
export async function notifyDevRequest({ email, fullName, createdAt }) {
  const to=process.env.DEV_NOTIFICATION_EMAIL?.trim();
  const from=process.env.RESEND_FROM_EMAIL?.trim();
  const key=process.env.RESEND_API_KEY?.trim();
  if (!to || !from || !key) {
    console.warn('[DEV] Novo cadastro pendente; notificacao de e-mail nao configurada.');
    return false;
  }
  const subject='FalaComigo: novo cadastro aguardando aprovacao';
  const text=[
    'Uma nova conta solicita aprovacao no FalaComigo.',
    `Nome: ${fullName}`,
    `E-mail: ${email}`,
    `Data: ${createdAt}`,
    'Abra o painel DEV para aprovar ou rejeitar. Nao responda a este e-mail.'
  ].join('\n');
  try {
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({from,to:[to],subject,text}),signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) {console.error('[DEV] E-mail recusado pelo provedor:',response.status);return false;}
    return true;
  } catch (error) {
    console.error('[DEV] E-mail indisponivel:',error?.message||'Falha de rede');
    return false;
  }
}
