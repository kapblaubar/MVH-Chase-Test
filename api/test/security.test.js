'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUrl, getAccessToken } = require('../src/chase');
const { containsPanLikeValue, luhn, redact } = require('../src/security');
const { customerRecord, parseStorageConnection } = require('../src/records');

test('detects a Luhn-valid PAN candidate', () => {
  assert.equal(luhn('4111 1111 1111 1111'), true);
  assert.equal(containsPanLikeValue({ value: '4111-1111-1111-1111' }), true);
});

test('does not reject ordinary identifiers', () => {
  assert.equal(containsPanLikeValue({ paymentId: '1234567890' }), false);
});

test('redacts sensitive fields and PAN-like strings', () => {
  assert.deepEqual(redact({ accessToken: 'abc', note: 'card 4111111111111111' }), {
    accessToken: '[REDACTED]',
    note: 'card [REDACTED-PAN]'
  });
});

test('buildUrl accepts only allow-listed history query keys', () => {
  const url = buildUrl('https://example.test/root', '/payments', new Map([
    ['requestIdentifier', 'request-123'],
    ['token', 'leak'],
    ['limit', '10']
  ]));
  assert.equal(url.href, 'https://example.test/root/payments?requestIdentifier=request-123');
});

test('buildUrl rejects an absolute endpoint override', () => {
  assert.throws(() => buildUrl('https://example.test', 'https://evil.test/'), /relative/);
});

test('OAuth exchanges client credentials without putting them in the URL', async () => {
  let request;
  const token = await getAccessToken({
    CHASE_TOKEN_URL: 'https://identity.example.test/token',
    CHASE_CLIENT_ID: 'client-id',
    CHASE_CLIENT_SECRET: 'client-secret',
    CHASE_OAUTH_SCOPE: 'test-scope'
  }, async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, json: async () => ({ access_token: 'generated-token', expires_in: 3600 }) };
  });
  assert.equal(token, 'generated-token');
  assert.equal(request.url, 'https://identity.example.test/token');
  assert.match(String(request.options.body), /client_id=client-id/);
  assert.match(String(request.options.body), /client_secret=client-secret/);
});

test('storage record excludes payment credentials', () => {
  const record = customerRecord({
    amount: 7500,
    currency: 'USD',
    paymentMethodType: { card: { accountNumber: '4012000033330026' } },
    accountHolder: { firstName: 'Test', lastName: 'Payer', email: 'test@example.test' }
  }, { headers: new Headers({ 'x-mvh-product': 'dog-vacine', 'x-mvh-product-name': 'Dog Vacine' }) }, 'request-1');
  assert.equal(record.productCode, 'dog-vacine');
  assert.equal(record.firstName, 'Test');
  assert.equal(JSON.stringify(record).includes('4012000033330026'), false);
});

test('storage connection parser preserves base64 key padding', () => {
  const parsed = parseStorageConnection('DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=abc==;EndpointSuffix=core.windows.net');
  assert.equal(parsed.accountKey, 'abc==');
  assert.equal(parsed.endpoint, 'https://testaccount.table.core.windows.net');
});
