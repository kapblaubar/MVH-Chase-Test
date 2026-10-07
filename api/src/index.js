'use strict';

const { app } = require('@azure/functions');
const { buildUrl, requireSetting, upstreamHeaders } = require('./chase');
const { beginRecord, completeRecord, listRecords } = require('./records');
const { containsPanLikeValue, redact } = require('./security');

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const PRODUCTS = Object.freeze({
  'dog-vacine': 7500,
  'dog-xray': 18000,
  'dog-exam': 6500
});

function response(status, body, correlationId, extraHeaders = {}) {
  return {
    status,
    jsonBody: body,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-correlation-id': correlationId,
      ...extraHeaders
    }
  };
}

async function readUpstream(upstream) {
  const contentLength = Number(upstream.headers.get('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('Upstream response exceeded the 1 MiB limit');
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('Upstream response exceeded the 1 MiB limit');
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try {
    return redact(JSON.parse(text));
  } catch {
    return { message: redact(text.slice(0, 4096)) };
  }
}

async function payments(request, context) {
  const incomingCorrelation = request.headers.get('x-correlation-id');
  const correlationId = incomingCorrelation && CORRELATION_PATTERN.test(incomingCorrelation)
    ? incomingCorrelation
    : crypto.randomUUID();
  const started = Date.now();

  try {
    const baseUrl = requireSetting('CHASE_API_BASE_URL');
    const method = request.method.toUpperCase();
    let url;
    let body;

    if (method === 'POST') {
      if (request.headers.get('x-confirm-mock-data') !== 'true') {
        return response(400, { error: 'Confirm that the request contains mock data only.' }, correlationId);
      }
      const contentType = request.headers.get('content-type') || '';
      if (!contentType.toLowerCase().startsWith('application/json')) {
        return response(415, { error: 'Content-Type must be application/json.' }, correlationId);
      }
      const raw = await request.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
        return response(413, { error: 'Request body exceeds 64 KiB.' }, correlationId);
      }
      try {
        body = JSON.parse(raw);
      } catch {
        return response(400, { error: 'Request body is not valid JSON.' }, correlationId);
      }
      if (!body || Array.isArray(body) || typeof body !== 'object') {
        return response(400, { error: 'Request body must be a JSON object.' }, correlationId);
      }
      if (containsPanLikeValue(body)) {
        return response(400, { error: 'A PAN-like value was detected. This POC does not accept card numbers.' }, correlationId);
      }
      const productCode = request.headers.get('x-mvh-product');
      if (!Object.hasOwn(PRODUCTS, productCode)) {
        return response(400, { error: 'Select a supported test product.' }, correlationId);
      }
      if (body.amount !== PRODUCTS[productCode]) {
        return response(400, { error: 'Payment amount does not match the selected product.' }, correlationId);
      }
      if (!body.accountHolder?.firstName || !body.accountHolder?.lastName || !body.accountHolder?.email) {
        return response(400, { error: 'Payer first name, last name, and email are required.' }, correlationId);
      }
      await beginRecord(body, request, correlationId);
      url = buildUrl(baseUrl, process.env.CHASE_CREATE_PATH || '/api/v2/payments');
    } else {
      url = buildUrl(baseUrl, process.env.CHASE_HISTORY_PATH || '/api/v2/payments', request.query.entries());
    }

    const controller = new AbortController();
    const timeoutMs = Number(process.env.CHASE_TIMEOUT_MS || 15000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstream;
    try {
      upstream = await fetch(url, {
        method,
        headers: await upstreamHeaders(correlationId),
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: 'error'
      });
    } finally {
      clearTimeout(timer);
    }

    const upstreamBody = await readUpstream(upstream);
    let recorded = method !== 'POST';
    if (method === 'POST') {
      try {
        await completeRecord(correlationId, upstream.status, upstreamBody);
        recorded = true;
      } catch (recordError) {
        context.error('Payment record completion failed', { correlationId, errorType: recordError?.name || 'Error' });
      }
    }
    const elapsedMs = Date.now() - started;
    context.log('Chase request completed', { correlationId, operation: method, elapsedMs, upstreamStatus: upstream.status, success: upstream.ok });
    if (!upstream.ok) {
      return response(502, { error: 'Chase rejected or could not process the request.', upstreamStatus: upstream.status, recorded, details: upstreamBody }, correlationId);
    }
    return response(method === 'POST' ? 201 : 200, { data: upstreamBody, recorded }, correlationId);
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const timedOut = error?.name === 'AbortError';
    context.error('Chase request failed', {
      correlationId,
      elapsedMs,
      errorType: error?.name || 'Error',
      errorMessage: String(error?.message || 'Unknown error').slice(0, 200),
      causeCode: String(error?.cause?.code || '').slice(0, 50),
      causeMessage: String(error?.cause?.message || '').slice(0, 200),
      timedOut
    });
    return response(timedOut ? 504 : 500, { error: timedOut ? 'The Chase request timed out.' : 'The payment service is not configured or unavailable.' }, correlationId);
  }
}

app.http('payments', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'payments',
  handler: payments
});

async function paymentRecords(request, context) {
  const incomingCorrelation = request.headers.get('x-correlation-id');
  const correlationId = incomingCorrelation && CORRELATION_PATTERN.test(incomingCorrelation)
    ? incomingCorrelation
    : crypto.randomUUID();
  try {
    const records = await listRecords(request.query.get('limit'));
    context.log('Payment records retrieved', { correlationId, count: records.length });
    return response(200, { records, count: records.length }, correlationId);
  } catch (error) {
    context.error('Payment records retrieval failed', { correlationId, errorType: error?.name || 'Error' });
    return response(500, { error: 'Payment history is temporarily unavailable.' }, correlationId);
  }
}

app.http('payment-records', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'payment-records',
  handler: paymentRecords
});

module.exports = { paymentRecords, payments, readUpstream };
