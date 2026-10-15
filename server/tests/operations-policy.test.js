import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validPhone, hasMarketingConsent, campaignLimit, hasAllTags } from '../src/services/operations-policy.js';
test('phone validates full DDI and rejects incomplete values',()=>{
 assert.equal(validPhone('55 (41) 99999-9999'),true);
 assert.equal(validPhone('5541999999999'),true);
 assert.equal(validPhone('123'),false);
 assert.equal(validPhone(''),false);
});
test('marketing consent requires an affirmative boolean',()=>{
 assert.equal(hasMarketingConsent({custom_fields:{whatsapp_marketing_opt_in:true}}),true);
 assert.equal(hasMarketingConsent({custom_fields:{whatsapp_marketing_opt_in:'true'}}),false);
 assert.equal(hasMarketingConsent({custom_fields:{}}),false);
 assert.equal(hasMarketingConsent(null),false);
});
test('campaign daily limit never exceeds 30',()=>{
 assert.equal(campaignLimit(500),30);
 assert.equal(campaignLimit(0),1);
});
test('segment requires all selected tags',()=>{
 assert.equal(hasAllTags(['a','b','c'],['a','b']),true);
 assert.equal(hasAllTags(['a'],['a','b']),false);
});
