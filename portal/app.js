'use strict';

const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
const result = document.querySelector('#result');
const resultMeta = document.querySelector('#result-meta');
const resultBody = document.querySelector('#result-body');
const resultSummary = document.querySelector('#result-summary');
const paymentForm = document.querySelector('#payment-form');
const payloadPreview = document.querySelector('#payload-preview');
const PRODUCTS = Object.freeze({
  'dog-vacine': { name: 'Dog Vacine', amount: 7500 },
  'dog-xray': { name: 'Dog XRAY', amount: 18000 },
  'dog-exam': { name: 'Dog Exam', amount: 6500 }
});
let merchantOrderNumber = `MVH-${crypto.randomUUID()}`;

for (const tab of tabs) tab.addEventListener('click', () => {
  for (const candidate of tabs) {
    const active = candidate === tab;
    candidate.classList.toggle('active', active);
    candidate.setAttribute('aria-selected', String(active));
  }
  for (const panel of panels) {
    const active = panel.id === tab.dataset.panel;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  }
  history.replaceState(null, '', `#${tab.dataset.panel}`);
});

function text(value, fallback = 'Not supplied') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function money(amount, currency = 'USD') {
  if (!Number.isFinite(Number(amount))) return 'Not supplied';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(amount) / 100);
}

function summaryItem(label, value) {
  const item = document.createElement('div');
  const term = document.createElement('span');
  const description = document.createElement('strong');
  term.textContent = label;
  description.textContent = text(value);
  item.append(term, description);
  return item;
}

function renderChaseSummary(payload) {
  resultSummary.replaceChildren();
  if (payload?.error) {
    resultSummary.append(summaryItem('Result', payload.error));
    return;
  }
  const data = payload?.data;
  if (!data) return;
  const card = data.paymentMethodType?.card || {};
  const items = [
    ['Outcome', `${text(data.responseStatus)} / ${text(data.responseCode)}`],
    ['State', data.transactionState], ['Message', data.responseMessage || data.hostMessage],
    ['Amount', money(data.amount, data.currency)],
    ['Card', [card.cardTypeName, card.maskedAccountNumber].filter(Boolean).join(' · ')],
    ['Capture method', data.captureMethod], ['Transaction date', data.transactionDate || data.captureTime],
    ['Request ID', data.requestId], ['Transaction ID', data.transactionId],
    ['Merchant order', data.merchantOrderNumber]
  ];
  for (const [label, value] of items) resultSummary.append(summaryItem(label, value));
}

function showResult(response, payload, elapsedMs) {
  const correlation = response.headers.get('x-correlation-id') || 'not supplied';
  resultMeta.textContent = `HTTP ${response.status} · ${elapsedMs} ms · correlation ${correlation}`;
  renderChaseSummary(payload);
  resultBody.textContent = JSON.stringify(payload, null, 2);
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function callApi(form, url, options) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const started = performance.now();
  try {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({ error: 'The API returned a non-JSON response.' }));
    showResult(response, payload, Math.round(performance.now() - started));
    return { response, payload };
  } catch {
    resultMeta.textContent = `Network failure · ${Math.round(performance.now() - started)} ms`;
    renderChaseSummary({ error: 'Could not reach the payment API.' });
    resultBody.textContent = JSON.stringify({ error: 'Could not reach the payment API.' }, null, 2);
    result.hidden = false;
  } finally { button.disabled = false; }
}

function buildPaymentPayload(redactCardVerification = false) {
  const fields = Object.fromEntries(new FormData(paymentForm));
  const product = PRODUCTS[fields.product];
  return {
    captureMethod: 'NOW', amount: product.amount, currency: 'USD', merchantOrderNumber,
    merchant: { merchantSoftware: { companyName: 'MVH', productName: 'Chase POC', version: '0.1.0' }, merchantCategoryCode: '4899' },
    paymentMethodType: { card: { accountNumber: fields.cardNumber.replace(/[ -]/g, ''), expiry: { month: Number(fields.expiryMonth), year: Number(fields.expiryYear) }, cvv: redactCardVerification ? '[MOCK CVV ENTERED]' : fields.cvv, isBillPayment: true } },
    accountHolder: {
      firstName: fields.firstName, lastName: fields.lastName, email: fields.email,
      phone: { countryCode: 1, phoneNumber: fields.phoneNumber },
      billingAddress: { line1: fields.addressLine1, line2: fields.addressLine2, city: fields.city, state: fields.state, postalCode: fields.postalCode, countryCode: 'USA' }
    },
    initiatorType: 'CARDHOLDER', accountOnFile: 'NOT_STORED', isAmountFinal: true
  };
}

function updatePreview() { payloadPreview.textContent = JSON.stringify(buildPaymentPayload(true), null, 2); }
paymentForm.addEventListener('input', updatePreview);
paymentForm.addEventListener('change', updatePreview);
updatePreview();

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(paymentForm));
  const product = PRODUCTS[fields.product];
  const outcome = await callApi(event.currentTarget, '/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-confirm-mock-data': 'true', 'x-correlation-id': crypto.randomUUID(), 'x-mvh-product': fields.product, 'x-mvh-product-name': product.name, 'x-mvh-pet-name': fields.petName },
    body: JSON.stringify(buildPaymentPayload())
  });
  const requestId = outcome?.payload?.data?.requestId;
  if (requestId) {
    document.querySelector('#chase-review-form [name="requestIdentifier"]').value = requestId;
    merchantOrderNumber = `MVH-${crypto.randomUUID()}`;
    updatePreview();
  }
});

document.querySelector('#chase-review-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = new URLSearchParams();
  for (const [key, value] of new FormData(event.currentTarget)) if (value) query.set(key, value);
  await callApi(event.currentTarget, `/api/payments?${query}`, { headers: { 'x-correlation-id': crypto.randomUUID() } });
});

function recordDetail(record) {
  const detail = document.querySelector('#record-detail');
  detail.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = 'Stored record details';
  const grid = document.createElement('div');
  grid.className = 'record-grid';
  const fields = [
    ['Submitted', record.submittedUtc], ['Completed', record.completedUtc],
    ['Payer', `${text(record.firstName, '')} ${text(record.lastName, '')}`.trim()], ['Email', record.email],
    ['Phone', `${text(record.phoneCountryCode, '')} ${text(record.phoneNumber, '')}`.trim()],
    ['Address', [record.addressLine1, record.addressLine2, record.city, record.state, record.postalCode, record.countryCode].filter(Boolean).join(', ')],
    ['Pet', record.petName], ['Product', record.productName], ['Amount', money(record.amount, record.currency)],
    ['Status', record.status], ['Transaction state', record.transactionState], ['Response code', record.responseCode],
    ['Request ID', record.chaseRequestId || record.rowKey], ['Transaction ID', record.transactionId], ['Merchant order', record.merchantOrderNumber]
  ];
  for (const [label, value] of fields) grid.append(summaryItem(label, value));
  detail.append(heading, grid);
  detail.hidden = false;
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadHistory() {
  const button = document.querySelector('#refresh-history');
  const status = document.querySelector('#history-status');
  const body = document.querySelector('#history-body');
  button.disabled = true;
  status.textContent = 'Loading payment history…';
  try {
    const response = await fetch('/api/payment-records?limit=100', { headers: { 'x-correlation-id': crypto.randomUUID() } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'History request failed.');
    body.replaceChildren();
    for (const record of payload.records) {
      const row = document.createElement('tr');
      const values = [new Date(record.submittedUtc).toLocaleString(), `${text(record.firstName, '')} ${text(record.lastName, '')} / ${text(record.petName)}`.trim(), text(record.productName), money(record.amount, record.currency), text(record.status), text(record.chaseRequestId || record.rowKey)];
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      const actionCell = document.createElement('td');
      const action = document.createElement('button');
      action.type = 'button'; action.className = 'secondary'; action.textContent = 'Details';
      action.addEventListener('click', () => recordDetail(record));
      actionCell.append(action); row.append(actionCell); body.append(row);
    }
    if (!payload.records.length) body.innerHTML = '<tr><td colspan="7" class="empty">No stored payments found.</td></tr>';
    status.textContent = `${payload.count} stored payment${payload.count === 1 ? '' : 's'} loaded.`;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}

document.querySelector('#refresh-history').addEventListener('click', loadHistory);
document.querySelector('#close-result').addEventListener('click', () => { result.hidden = true; });
const initialTab = document.querySelector(`.tab[data-panel="${location.hash.slice(1)}"]`);
if (initialTab) initialTab.click();
