import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyEvolutionMedia } from '../src/services/evolution-media.js';
for (const [type, key, mime] of [
  ['image','imageMessage','image/jpeg'],
  ['video','videoMessage','video/mp4'],
  ['audio','audioMessage','audio/ogg'],
  ['document','documentMessage','application/pdf'],
  ['sticker','stickerMessage','image/webp'],
]) {
  test(`identifica ${type} sem legenda`, () => {
    const result = identifyEvolutionMedia({key:{id:'ABC',remoteJid:'5511999999999@s.whatsapp.net'},message:{[key]:{mimetype:mime,fileLength:'1024',mediaKey:'secret',base64:'SHOULD_NOT_STORE'}}});
    assert.equal(result.type,type);
    assert.equal(result.mime,mime);
    assert.equal(result.size,1024);
    assert.equal(result.message.key.id,'ABC');
    assert.ok(!JSON.stringify(result.message).includes('SHOULD_NOT_STORE'));
  });
}
test('desembrulha mensagens temporarias', () => {
  const result=identifyEvolutionMedia({message:{ephemeralMessage:{message:{imageMessage:{mimetype:'image/jpeg',caption:'teste'}}}}});
  assert.equal(result.caption,'teste');
});
test('ignora texto puro',()=>assert.equal(identifyEvolutionMedia({message:{conversation:'ola'}}),null));
test('PDF com legenda encapsulado no documentWithCaptionMessage', () => {
  const result = identifyEvolutionMedia({key:{id:'PDF1',remoteJid:'5511999999999@s.whatsapp.net'},message:{documentWithCaptionMessage:{message:{documentMessage:{fileName:'proposta.pdf',mimetype:'application/octet-stream',caption:'Segue proposta',fileLength:{low:800,high:0},mediaKey:'encrypted'}}}}});
  assert.equal(result.type, 'document');
  assert.equal(result.mime, 'application/pdf');
  assert.equal(result.name, 'proposta.pdf');
  assert.equal(result.caption, 'Segue proposta');
  assert.ok(result.message.message.documentMessage);
});
test('localizacao estatica e em tempo real, sem thumbnails', () => {
  for (const key of ['locationMessage','liveLocationMessage']) {
    const result = identifyEvolutionMedia({message:{[key]:{degreesLatitude:-23.55,degreesLongitude:-46.63,name:'Ponto de encontro',address:'Centro',jpegThumbnail:'private'}}});
    assert.equal(result.type,'location');
    assert.equal(result.message.location.latitude,-23.55);
    assert.equal(result.message.location.longitude,-46.63);
    assert.equal(result.message.location.live,key==='liveLocationMessage');
    assert.ok(!JSON.stringify(result.message).includes('private'));
  }
});
test('localizacao invalida nao e persistida',()=>assert.equal(identifyEvolutionMedia({message:{locationMessage:{degreesLatitude:200,degreesLongitude:10}}}),null));
