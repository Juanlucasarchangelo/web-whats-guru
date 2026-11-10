import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { groupJid, groupMetadata, groupSender } from '../src/services/evolution-groups-policy.js';
import { identifyEvolutionMedia } from '../src/services/evolution-media.js';
import { saveMedia, safeMediaFilename } from '../src/services/nas-storage.js';
import { originalMediaFilename } from '../src/services/evolution-media-file-policy.js';
import { groupArchiveFilename } from '../src/services/evolution-group-media-naming.js';

test('detecta grupo apenas por JID de grupo, nunca telefone ou lista', () => {
  assert.equal(groupJid('120363295648424210@g.us'), '120363295648424210@g.us');
  assert.equal(groupJid('5511999999999@s.whatsapp.net'), null);
  assert.equal(groupJid('status@broadcast'), null);
  assert.equal(groupJid('../outro@g.us'), null);
});

test('extrai grupo do formato oficial Evolution e preserva participantes', () => {
  const g = groupMetadata({ id: '120363295648424210@g.us', subject:'Projeto & Clientes',
    desc:'Comunicacao do projeto', size:27 });
  assert.equal(g.subject, 'Projeto & Clientes');
  assert.equal(g.participant_count, 27);
  assert.equal(g.description, 'Comunicacao do projeto');
  assert.equal(groupMetadata({ id: '5511999999999@s.whatsapp.net', name:'Pessoa' }), null);
});

test('autor do grupo identifica participante sem confundir com group remoteJid', () => {
  assert.deepEqual(groupSender({ key:{remoteJid:'120363295648424210@g.us',
    participant:'5511999999999@s.whatsapp.net'},pushName:'Cláudia' }), {
    jid:'5511999999999@s.whatsapp.net',name:'Cláudia',
  });
});

test('mensagem de grupo preserva participant ao armazenar mídia recuperável', () => {
  const item={key:{id:'MSG123',remoteJid:'120363295648424210@g.us',
    participant:'5511999999999@s.whatsapp.net',fromMe:false},
    message:{documentMessage:{fileName:'Planejamento.xlsx',mimetype:'application/octet-stream',fileLength:100}}};
  const media=identifyEvolutionMedia(item);
  assert.equal(media.name,'Planejamento.xlsx');
  assert.equal(media.mime,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(media.message.key.participant,'5511999999999@s.whatsapp.net');
});

test('preserva nome original, remove caminhos enviados remotamente e diferencia homônimos', async () => {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'fc-nas-test-'));
  const before=process.env.FALACOMIGO_STORAGE_PATH;
  process.env.FALACOMIGO_STORAGE_PATH=folder;
  try {
    const input={instance:'WhatsApp Juan',groupId:'120363295648424210@g.us',contact:'Grupo Teste',
      filename:'09-11-2026 - contrato final.pdf',buffer:Buffer.from('a')};
    const first=await saveMedia(input);
    const second=await saveMedia({...input,buffer:Buffer.from('b')});
    assert.equal(first.filename,'09-11-2026 - contrato final.pdf');
    assert.equal(second.filename,'09-11-2026 - contrato final (2).pdf');
    assert.ok(!first.relativePath.split(path.sep).includes('Grupos'), 'Grupos não pode ser pasta intermediária');
    assert.equal(path.dirname(first.relativePath), path.join('WhatsApp Juan', 'Grupo Teste'));
    assert.ok(!first.relativePath.includes('120363295648424210@g.us'));
    assert.ok(!first.relativePath.includes('09-11-2026 - Grupo Teste')); 
    assert.equal((await fs.readFile(first.fullPath)).toString(),'a');
    assert.equal((await fs.readFile(second.fullPath)).toString(),'b');
  } finally {
    if(before===undefined)delete process.env.FALACOMIGO_STORAGE_PATH;
    else process.env.FALACOMIGO_STORAGE_PATH=before;
    await fs.rm(folder,{recursive:true,force:true});
  }
});

test('nome recebido do WhatsApp mantém significado; vídeo sem filename usa fallback descritivo', () => {
  assert.equal(safeMediaFilename('C:\\pasta\\clientes\\video teste.mp4'),'video teste.mp4');
  assert.equal(originalMediaFilename({media_name:'Proposta Cliente.pdf',media_type:'document',
    created_at:'2026-11-09T12:00:00Z'}),'Proposta Cliente.pdf');
  assert.equal(originalMediaFilename({media_name:null,media_type:'video',media_mime:'video/mp4',
    created_at:'2026-11-09T12:00:00Z'}),'video_2026-11-09T12-00-00.mp4');
});

test('nomes dos anexos de grupo: data de São Paulo, autor para áudio e nome original para arquivo', () => {
  const created_at='2026-11-10T04:15:00Z';
  assert.equal(groupArchiveFilename({created_at,media_type:'audio',media_mime:'audio/ogg',
    group_sender_name:'Júlio',group_sender_jid:'5511999999999@s.whatsapp.net'}), '10-11-2026 - Júlio.ogg');
  assert.equal(groupArchiveFilename({created_at,media_type:'audio',media_mime:'audio/ogg',
    sender_type:'agent'}), '10-11-2026 - Nossa equipe.ogg');
  assert.equal(groupArchiveFilename({created_at,media_type:'document',media_name:'Comprovante.pdf'}),
    '10-11-2026 - Comprovante.pdf');
  assert.equal(groupArchiveFilename({created_at,media_type:'image',media_name:'Foto da obra.jpg'}),
    '10-11-2026 - Foto da obra.jpg');
});

test('anexos de dias diferentes do mesmo grupo ficam na mesma pasta', async () => {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'fc-group-folder-test-'));
  const previous=process.env.FALACOMIGO_STORAGE_PATH;
  process.env.FALACOMIGO_STORAGE_PATH=folder;
  try {
    const common={instance:'WhatsApp Juan',groupId:'123@g.us',contact:'Torre B - Angra dos reis'};
    const a=await saveMedia({...common,filename:'09-11-2026 - planilha.xlsx',buffer:Buffer.from('1')});
    const b=await saveMedia({...common,filename:'10-11-2026 - Júlio.ogg',buffer:Buffer.from('2')});
    assert.equal(path.dirname(a.relativePath), path.dirname(b.relativePath));
    assert.equal(path.dirname(a.relativePath),path.join('WhatsApp Juan','Torre B - Angra dos reis'));
  } finally {
    if(previous===undefined)delete process.env.FALACOMIGO_STORAGE_PATH;
    else process.env.FALACOMIGO_STORAGE_PATH=previous;
    await fs.rm(folder,{recursive:true,force:true});
  }
});
