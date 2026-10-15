import { Router } from 'express';
import { wrap } from '../http.js';
import { whatsappConfig, safeCompare, checkSignature, processWhatsAppWebhook } from '../services/whatsapp.js';

export function whatsappWebhookRouter() {
  const router=Router();
  router.get('/',(req,res)=>{
    const c=whatsappConfig();
    const valid=c.configured && req.query['hub.mode']==='subscribe' &&
      safeCompare(req.query['hub.verify_token'],c.verifyToken);
    if(!valid) return res.status(403).send('Forbidden');
    res.type('text/plain').status(200).send(String(req.query['hub.challenge'] ?? ''));
  });
  router.post('/',wrap(async(req,res)=>{
    const c=whatsappConfig();
    const payload=req.body;
    if(!Buffer.isBuffer(payload) || !checkSignature(payload,req.get('X-Hub-Signature-256'),c.appSecret)){
      return res.status(403).json({error:'Assinatura WhatsApp invalida.'});
    }
    let data;
    try {data=JSON.parse(payload.toString('utf8'));}
    catch {return res.status(400).json({error:'JSON invalido.'});}
    await processWhatsAppWebhook(data);
    return res.sendStatus(200);
  }));
  return router;
}
