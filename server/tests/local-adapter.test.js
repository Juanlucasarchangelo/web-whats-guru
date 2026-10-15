import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localFields } from '../src/routes/local-fields.js';
const route = readFileSync(new URL('../src/routes/local-data.js', import.meta.url),'utf8');
const client = readFileSync(new URL('../../src/lib/supabase.ts', import.meta.url),'utf8');
test('adapter local has strict list of models and never exposes credentials', () => {
  assert.ok(Object.hasOwn(localFields, 'contacts'));
  assert.ok(Object.hasOwn(localFields, 'campaigns'));
  assert.ok(!Object.hasOwn(localFields, 'integration_credentials'));
  assert.ok(!Object.hasOwn(localFields, 'users'));
  assert.match(route,/req\.orgId/);
  assert.match(route,/table === 'integrations' \? data\.map/);
});
test('front local adapter calls Express not Supabase cloud', () => {
  assert.match(client,/apiRequest\(/);
  assert.doesNotMatch(client,/createClient\(|supabase\.co|VITE_SUPABASE_URL/);
});
