# Requirements specification

## 1. Purpose and scope

Create a developer-only proof of concept (POC) that lets an operator submit a mock payment to J.P. Morgan Online Payments and retrieve a specific payment by request ID. The solution will run in Azure, contain no sign-in in this phase, and use only mock/test data and endpoints.

The POC proves connectivity and workflow; it is not approval to process production payments. Refunds, voids, recurring payments, settlement, reconciliation, user administration, and production onboarding are out of scope. A limited Azure Table test ledger is in scope as described below.

## 2. Assumptions and constraints

- “Chase” means the J.P. Morgan Online Payments developer-portal API and its mock environment.
- The supplied URL is the mock OAuth token URL. The supplied 86-character credential is treated as the OAuth client secret, not a bearer access token.
- The Online Payments quick start identifies `https://api-mock.payments.jpmorgan.com/api/v2/payments` as the mock payment endpoint.
- The implementation uses the Online Payments v2 create and single-payment retrieval contracts. It does not claim to provide general payment history.
- No primary account number (PAN), security code/CVV, real bank-account number, or other live payment-account data may be entered into this POC.
- Azure resource defaults are:
  - Resource group: `MVH-Chase-POC-RSG`
  - Key Vault: `MVH-Chase-POC-KV`
  - Static Web App: `MVH-Chase-POC-webapp`
- Azure service DNS names are globally unique. The deployer may need to override a default name if already taken.
- The phrase `RSG:` in the project brief is interpreted as a label, not part of the resource-group name.

## 3. High-level requirements

### Functional

- HLR-F01: The portal shall let an operator enter a mock payment request and submit it.
- HLR-F02: The portal shall display the upstream HTTP outcome and a sanitized response.
- HLR-F03: The portal shall let an operator retrieve a specific Online Payments transaction using its original request ID. A general history list requires the separate Reporting API or an approved local ledger.
- HLR-F04: The portal shall display returned payment records and failure messages.
- HLR-F05: Each submit request shall have a correlation/request ID to support troubleshooting and safe retries.
- HLR-F06: The backend shall communicate only with the configured Chase host and endpoints.
- HLR-F07: The POC shall not persist full Chase payment requests/responses or payment credentials; only the allow-listed summary defined in the data rules may be stored.
- HLR-F08: The portal shall capture synthetic payer and visit details, show the exact Chase request preview, and record a safe payment summary in Azure Table Storage.

### Security and compliance

- HLR-S01: Chase credentials shall be stored in Azure Key Vault, never in frontend code, source control, logs, or browser storage.
- HLR-S02: The API shall access Key Vault through an Azure managed identity with secret-read-only RBAC.
- HLR-S03: All traffic shall use HTTPS/TLS.
- HLR-S04: Logs and telemetry shall exclude authorization values and payment payload/response bodies by default.
- HLR-S05: The portal shall clearly state “mock data only” and shall reject common PAN-like digit sequences.
- HLR-S06: The browser shall never call Chase or Key Vault directly.
- HLR-S07: Public access without sign-in is accepted only for the temporary developer POC; authentication and authorization are required before any shared, test-client, or production use.
- HLR-S08: The team shall perform and document a PCI DSS scope determination with its acquiring bank/QSA before real card data is used.

### Operational

- HLR-O01: Azure resources shall be reproducibly deployable using Bicep.
- HLR-O02: The API shall emit structured operational telemetry with correlation ID, route, duration, upstream status, and outcome—without sensitive payloads.
- HLR-O03: Secrets shall be independently rotatable without rebuilding frontend assets.
- HLR-O04: Development resources shall use tags and cost-conscious SKUs.
- HLR-O05: Destructive changes and production endpoints shall not be enabled by default.

## 4. Low-level requirements

### Portal

- LLR-P01: Serve a static HTML/CSS/JavaScript client from Azure Static Web Apps.
- LLR-P02: Provide “Push payment” and “Review payment” views.
- LLR-P03: The payment view shall accept a JSON body, validate that it is an object and valid JSON, and require explicit operator confirmation that it contains mock data.
- LLR-P04: The review view shall require `requestIdentifier` and URL-encode it.
- LLR-P05: Disable submit controls while a request is in flight and prevent accidental double-submit.
- LLR-P06: Render API results as text, not executable HTML.
- LLR-P07: Do not store request content in cookies, local storage, session storage, analytics, or URLs.
- LLR-P08: Set a restrictive Content Security Policy, clickjacking protection, referrer policy, and MIME-sniffing protection.

### Backend APIs

- LLR-A01: `POST /api/payments` shall accept `application/json` with a maximum body size of 64 KiB.
- LLR-A02: `POST /api/payments` shall reject malformed JSON, empty/non-object bodies, PAN-like 13–19 digit sequences (after common separators are removed), and requests lacking `X-Confirm-Mock-Data: true`.
- LLR-A03: The API shall use an incoming valid `X-Correlation-ID` or create a UUID, and return it in the response.
- LLR-A04: The API shall exchange the client ID and client secret at the configured OAuth token URL, cache the short-lived bearer token server-side, and send that bearer token to the Payments API.
- LLR-A05: The API shall set `Accept: application/json`, `Content-Type: application/json`, and configurable correlation/request-ID header names.
- LLR-A06: `GET /api/payments` shall forward only `requestIdentifier` to the configured retrieval endpoint.
- LLR-A07: Upstream calls shall time out after a configurable period (default 15 seconds).
- LLR-A08: The API shall not automatically retry POST requests. Retry behavior requires confirmation of the product’s idempotency semantics.
- LLR-A09: Upstream response bodies shall be capped at 1 MiB and returned as JSON where possible or safely wrapped as text.
- LLR-A10: Client responses shall map validation failures to 400, timeouts to 504, configuration failures to 500, and upstream failures to 502 while preserving the upstream status in a separate field.
- LLR-A11: CORS shall allow only the deployed portal origin (and explicitly configured local development origin).
- LLR-A12: URLs shall be assembled from a configured base URL plus relative paths; absolute, user-supplied upstream URLs are prohibited.

### Azure infrastructure

- LLR-I01: Deploy all resources to `MVH-Chase-POC-RSG` in a parameterized Azure region.
- LLR-I02: Deploy an Azure Static Web App named `MVH-Chase-POC-webapp` using the Standard tier so a bring-your-own Functions backend can be linked.
- LLR-I03: Deploy a separate Azure Functions app with a system-assigned managed identity.
- LLR-I04: Deploy Key Vault `MVH-Chase-POC-KV` with Azure RBAC, soft delete, purge protection, and public network access enabled for this initial POC bootstrap.
- LLR-I05: Grant only the Functions identity `Key Vault Secrets User` at vault scope. The Static Web App receives no secret role.
- LLR-I06: Store `chase-token-url`, `chase-client-id`, and `chase-client-secret` as separate secrets. The API base URL is non-secret configuration.
- LLR-I07: Deploy Application Insights/Log Analytics and connect the Functions app.
- LLR-I08: Enforce HTTPS-only, TLS 1.2 or newer, FTPS disabled, and HTTP/2 where supported.
- LLR-I09: Give storage and telemetry resources collision-resistant names derived from the subscription/resource-group deployment context.
- LLR-I10: Parameterize Chase create/history relative paths and header names without placing secret values in Bicep parameter files.

### Testing and acceptance

- LLR-T01: Unit tests shall cover URL construction, query allow-listing, JSON/PAN validation, and response sanitization.
- LLR-T02: IaC shall compile with the installed Bicep CLI.
- LLR-T03: A smoke test shall verify portal availability and that both API endpoints return controlled errors before secrets are configured.
- LLR-T04: With valid mock credentials, a documented J.P. Morgan happy-path sample shall submit successfully and appear through the supported history API, if that product provides history/list functionality.
- LLR-T05: Invalid token, rate limit, timeout, malformed request, duplicate request ID, and simulated upstream 5xx cases shall produce safe, comprehensible results.
- LLR-T06: Source and built frontend shall contain no Chase secret values.

## 5. Data and logging rules

Allowed telemetry: UTC timestamp, correlation ID, operation name, duration, application outcome, HTTP status, upstream status, and exception type. Prohibited telemetry: authorization headers, client ID, PAN, CVV/security code, bank-account/routing numbers, full payment payloads, full upstream response bodies, or secret URIs containing versions.

The POC maintains a limited test ledger in the `PaymentRecords` Azure Table. It stores payer/contact fields, pet/product details, amount, identifiers, and status, but never card number, CVV, OAuth credentials, or full request/response bodies. This ledger is for POC review only; retention and deletion policy must be approved before any real personal data is used. Online Payments supports retrieving one transaction by request ID or transaction ID, not listing general Chase history.

## 6. Open decisions / requirements workshop

These answers are needed before the integration can be considered complete:

1. Which J.P. Morgan product and API/version is enabled in the developer project (Online Payments, Payments, Embedded Banking, Pay by Bank, Reporting, or another product)?
2. Is “push payment” an acceptance of a card/customer payment, or an outbound treasury disbursement to a beneficiary?
3. What are the exact mock base URL, create endpoint, history/list endpoint, required headers, and OpenAPI schemas? Do not paste secrets into documentation.
4. Is the supplied token long-lived mock access, or must the backend obtain/refresh OAuth tokens using a client credential, signed assertion, or mTLS certificate?
5. Are `merchant-id`, `account-id`, `minorVersion`, idempotency, or product-specific request-ID headers required?
6. What history filters and pagination contract are required? Does “history” instead require the Reporting API?
7. Who may use the POC, from which networks, and when must Entra ID sign-in be added?
8. Will any real card or bank-account data ever transit the solution? If yes, stop and complete PCI/security architecture and legal reviews first.
9. What data must be retained, for how long, and who is authorized to view it?
10. What success, latency, availability, volume, and test-case targets define POC acceptance?

## 7. Traceable POC acceptance summary

The POC is accepted only when infrastructure deploys reproducibly, the browser contains no credentials, both backend operations work against the confirmed mock API contract, logs are shown not to contain sensitive fields, negative tests pass, and the open decisions above are recorded or explicitly deferred by the product and security owners.
