'use strict';

const SENSITIVE_KEYS = /(?:authorization|token|secret|password|accountnumber|account_number|routingnumber|routing_number|pan|cvv|cvc|securitycode)/i;
const CARD_CANDIDATE = /(?:\d[ -]*?){13,19}/g;
const ALLOWED_MOCK_PANS = new Set(['4012000033330026']);

function normalizePan(value) {
  return String(value ?? '').replace(/[ -]/g, '');
}

function isAllowedMockPan(value) {
  return ALLOWED_MOCK_PANS.has(normalizePan(value));
}

function validateMockCard(card, currentYear = new Date().getUTCFullYear()) {
  if (!card || !isAllowedMockPan(card.accountNumber)) return 'Use only the published Chase quick-start mock card number.';
  const month = Number(card.expiry?.month);
  const year = Number(card.expiry?.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < currentYear) return 'Enter a valid mock-card expiration month and year.';
  if (!/^\d{3,4}$/.test(String(card.cvv ?? ''))) return 'Enter a 3- or 4-digit mock card verification value.';
  return null;
}

function luhn(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let total = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
    doubleDigit = !doubleDigit;
  }
  return total % 10 === 0;
}

function containsPanLikeValue(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return [...serialized.matchAll(CARD_CANDIDATE)].some((match) => {
    const digits = match[0].replace(/\D/g, '');
    return !ALLOWED_MOCK_PANS.has(digits) && luhn(digits);
  });
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item)]));
  }
  if (typeof value === 'string') {
    return value.replace(CARD_CANDIDATE, (candidate) => luhn(candidate) ? '[REDACTED-PAN]' : candidate);
  }
  return value;
}

module.exports = { containsPanLikeValue, isAllowedMockPan, luhn, redact, validateMockCard };
