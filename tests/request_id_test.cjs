'use strict';
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../web/request-id.js'), 'utf8');
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function generator(crypto) {
  const context = vm.createContext({ crypto });
  vm.runInContext("Math.random = () => { throw new Error('Insecure randomness must not be used'); };", context);
  vm.runInContext(source, context);
  return context.createRequestId;
}

test('uses native randomUUID with the Crypto receiver', () => {
  const expected = webcrypto.randomUUID();
  const crypto = {
    randomUUID() { assert.equal(this, crypto); return expected; },
    getRandomValues() { assert.fail('Fallback is unnecessary'); },
  };
  assert.equal(generator(crypto)(), expected);
});

test('HTTP context without randomUUID generates distinct UUID v4 request keys', () => {
  const crypto = {
    getRandomValues(bytes) { assert.equal(this, crypto); return webcrypto.getRandomValues(bytes); },
  };
  const generate = generator(crypto);
  const keys = Array.from({ length: 1000 }, () => generate());
  for (const key of keys) assert.match(key, uuidV4);
  assert.equal(new Set(keys).size, keys.length);
});

test('fallback preserves leading zeroes and sets UUID version and variant', () => {
  assert.equal(generator({ getRandomValues: (bytes) => bytes.fill(0) })(), '00000000-0000-4000-8000-000000000000');
  assert.equal(generator({ getRandomValues: (bytes) => bytes.fill(255) })(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('missing Web Crypto produces a readable error', () => {
  for (const crypto of [undefined, {}]) {
    assert.throws(generator(crypto), /Обнови браузер/);
  }
});

test('game loads the request key generator before the application', () => {
  const html = readFileSync(join(__dirname, '../web/index.html'), 'utf8');
  const scripts = Array.from(html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g));
  const helper = scripts.findIndex((script) => script[1] === '/request-id.js');
  const app = scripts.findIndex((script) => script[1] === '/app.js');
  assert.ok(helper >= 0 && app > helper);
  assert.match(scripts[helper][0], /\bdefer\b/);
  assert.match(scripts[app][0], /\bdefer\b/);
});
