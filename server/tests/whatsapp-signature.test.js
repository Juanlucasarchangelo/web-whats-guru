import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { checkSignature, safeCompare } from '../src/services/whatsapp.js';

test('WhatsApp webhook requires valid HMAC signature',()=>{
 const b=Buffer.from('{"entry":[]}');
 const sig='sha256='+createHmac('sha256','test-app-secret').update(b).digest('hex');
 assert.equal(checkSignature(b,sig,'test-app-secret'),true);
 assert.equal(checkSignature(Buffer.from('tampered'),sig,'test-app-secret'),false);
 assert.equal(checkSignature(b,'','test-app-secret'),false);
});
test('verify token comparison',()=>{
 assert.equal(safeCompare('abc123','abc123'),true);
 assert.equal(safeCompare('abc','abcd'),false);
 assert.equal(safeCompare('',''),false);
});
