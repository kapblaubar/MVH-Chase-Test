'use strict';

const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

let tableClient;

function parseStorageConnection(connectionString) {
  const values = Object.fromEntries(connectionString.split(';').filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return [part.slice(0, separator), part.slice(separator + 1)];
  }));
  if (!values.AccountName || !values.AccountKey) throw new Error('Storage connection is incomplete');
  const endpoint = values.TableEndpoint || `https://${values.AccountName}.table.${values.EndpointSuffix || 'core.windows.net'}`;
  return { endpoint, accountName: values.AccountName, accountKey: values.AccountKey };
}

function getClient(environment = process.env) {
  if (tableClient) return tableClient;
  const storage = parseStorageConnection(environment.AzureWebJobsStorage || '');
  tableClient = new TableClient(
    storage.endpoint,
    environment.PAYMENT_RECORDS_TABLE || 'PaymentRecords',
    new AzureNamedKeyCredential(storage.accountName, storage.accountKey)
  );
  return tableClient;
}

function safe(value, maxLength = 256) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function customerRecord(body, request, correlationId) {
  const holder = body.accountHolder || {};
  const address = holder.billingAddress || {};
  return {
    partitionKey: 'POC',
    rowKey: correlationId,
    submittedUtc: new Date().toISOString(),
    status: 'SUBMITTING',
    productCode: safe(request.headers.get('x-mvh-product'), 40),
    productName: safe(request.headers.get('x-mvh-product-name'), 80),
    petName: safe(request.headers.get('x-mvh-pet-name'), 80),
    amount: Number(body.amount) || 0,
    currency: safe(body.currency, 3),
    merchantOrderNumber: safe(body.merchantOrderNumber, 64),
    firstName: safe(holder.firstName, 80),
    lastName: safe(holder.lastName, 80),
    email: safe(holder.email, 254),
    phoneCountryCode: safe(holder.phone?.countryCode, 5),
    phoneNumber: safe(holder.phone?.phoneNumber, 30),
    addressLine1: safe(address.line1, 120),
    addressLine2: safe(address.line2, 120),
    city: safe(address.city, 80),
    state: safe(address.state, 40),
    postalCode: safe(address.postalCode, 20),
    countryCode: safe(address.countryCode, 3)
  };
}

async function beginRecord(body, request, correlationId) {
  const entity = customerRecord(body, request, correlationId);
  await getClient().upsertEntity(entity, 'Replace');
}

async function completeRecord(correlationId, upstreamStatus, responseBody) {
  const data = responseBody && typeof responseBody === 'object' ? responseBody : {};
  await getClient().updateEntity({
    partitionKey: 'POC',
    rowKey: correlationId,
    completedUtc: new Date().toISOString(),
    status: safe(data.responseStatus || (upstreamStatus < 400 ? 'SUCCESS' : 'ERROR'), 30),
    transactionState: safe(data.transactionState, 30),
    responseCode: safe(data.responseCode, 60),
    upstreamStatus,
    transactionId: safe(data.transactionId, 100),
    chaseRequestId: safe(data.requestId, 100)
  }, 'Merge');
}

async function listRecords(limit = 100) {
  const records = [];
  const select = [
    'RowKey', 'submittedUtc', 'completedUtc', 'status', 'transactionState', 'responseCode',
    'upstreamStatus', 'transactionId', 'chaseRequestId', 'productCode', 'productName',
    'petName', 'amount', 'currency', 'merchantOrderNumber', 'firstName', 'lastName',
    'email', 'phoneCountryCode', 'phoneNumber', 'addressLine1', 'addressLine2', 'city',
    'state', 'postalCode', 'countryCode'
  ];
  const entities = getClient().listEntities({
    queryOptions: { filter: "PartitionKey eq 'POC'", select }
  });
  for await (const entity of entities) records.push(entity);
  return records
    .sort((left, right) => String(right.submittedUtc).localeCompare(String(left.submittedUtc)))
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 100));
}

module.exports = { beginRecord, completeRecord, customerRecord, listRecords, parseStorageConnection };
