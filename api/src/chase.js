'use strict';

const ALLOWED_HISTORY_FIELDS = new Set(['requestIdentifier']);
let cachedToken;

function requireSetting(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value || value.startsWith('@Microsoft.KeyVault(')) {
    throw new Error(`Required setting ${name} is unavailable`);
  }
  return value;
}

function buildUrl(baseUrl, relativePath, query) {
  const base = new URL(requireProtocol(baseUrl));
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Unsupported Chase URL protocol');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) {
    throw new Error('The Chase base URL must use HTTPS');
  }
  if (/^https?:\/\//i.test(relativePath)) throw new Error('Chase endpoint paths must be relative');
  const normalizedBase = base.href.endsWith('/') ? base.href : `${base.href}/`;
  const url = new URL(relativePath.replace(/^\//, ''), normalizedBase);
  for (const [key, value] of query ?? []) {
    if (ALLOWED_HISTORY_FIELDS.has(key) && value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function requireProtocol(value) {
  return value;
}

async function getAccessToken(environment = process.env, fetchImplementation = fetch) {
  const now = Date.now();
  if (cachedToken?.expiresAt > now + 60000) return cachedToken.value;

  const tokenUrl = new URL(requireSetting('CHASE_TOKEN_URL', environment));
  if (tokenUrl.protocol !== 'https:') throw new Error('The Chase token URL must use HTTPS');
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: environment.CHASE_OAUTH_SCOPE?.trim() || 'jpm:payments:sandbox',
    client_id: requireSetting('CHASE_CLIENT_ID', environment),
    client_secret: requireSetting('CHASE_CLIENT_SECRET', environment)
  });
  const tokenResponse = await fetchImplementation(tokenUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    redirect: 'error'
  });
  if (!tokenResponse.ok) throw new Error(`Chase OAuth returned HTTP ${tokenResponse.status}`);
  const payload = await tokenResponse.json();
  if (!payload.access_token || typeof payload.access_token !== 'string') throw new Error('Chase OAuth response did not include an access token');
  const lifetimeSeconds = Math.max(60, Math.min(Number(payload.expires_in) || 3600, 86400));
  cachedToken = { value: payload.access_token, expiresAt: now + lifetimeSeconds * 1000 };
  return cachedToken.value;
}

async function upstreamHeaders(correlationId, environment = process.env, fetchImplementation = fetch) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${await getAccessToken(environment, fetchImplementation)}`,
    'content-type': 'application/json'
  };
  const clientHeader = environment.CHASE_CLIENT_ID_HEADER?.trim();
  if (clientHeader) headers[clientHeader] = requireSetting('CHASE_CLIENT_ID', environment);
  const requestHeader = environment.CHASE_REQUEST_ID_HEADER?.trim() || 'request-id';
  headers[requestHeader] = correlationId;
  headers['merchant-id'] = requireSetting('CHASE_MERCHANT_ID', environment);
  headers.minorVersion = environment.CHASE_MINOR_VERSION?.trim() || '';
  return headers;
}

module.exports = { ALLOWED_HISTORY_FIELDS, buildUrl, getAccessToken, requireSetting, upstreamHeaders };
