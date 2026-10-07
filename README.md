# MVH Chase Payments proof of concept

An Azure-hosted proof of concept for submitting mock payment requests to J.P. Morgan Online Payments, reviewing the POC's Azure Table history, and retrieving Chase's scenario-driven mock response by request ID.

> This repository is deliberately **mock/test only**. Do not enter real cardholder data, bank-account data, credentials, or production payments.

## Architecture

```text
Browser -> Azure Static Web Apps -> Azure Functions -> J.P. Morgan mock API
                                      |
                                      +-> managed identity -> Azure Key Vault
                                      +-> PaymentRecords Azure Table
                                      +-> Application Insights
```

The browser never reads Key Vault. The Functions app is the only component permitted to retrieve the Chase credentials.

## Repository

- `docs/requirements.md` — high- and low-level requirements, assumptions, acceptance criteria, and open decisions
- `docs/pci-dss.md` — PCI DSS primer and scope guidance
- `infra/main.bicep` — Azure resources and least-privilege Key Vault access
- `infra/main.bicepparam.example` — non-secret deployment values
- `scripts/deploy.ps1` — infrastructure deployment and secret bootstrap
- `portal/` — dependency-free static portal
- `api/` — Node.js Azure Functions backend for Chase payment operations and stored POC history

## Prerequisites

- Azure CLI and Bicep
- An Azure subscription where you can create resources and role assignments
- Node.js 22+ for local API tests and the Azure Functions runtime
- A J.P. Morgan **mock/test** OAuth token URL, client ID, client secret, and the product-specific API paths

## Deploy infrastructure

Sign in and select the intended subscription:

```powershell
az login
az account set --subscription '<subscription-id>'
```

Copy the example parameter file and set a valid Azure region. Resource names requested for this POC are defaults. Key Vault, Functions, and Static Web App names are globally scoped; choose unique overrides if Azure reports a collision.

```powershell
Copy-Item infra/main.bicepparam.example infra/main.bicepparam
./scripts/deploy.ps1 -Location westus2
```

The script prompts securely for Chase values, stores them in Key Vault, deploys the Functions package, uploads the portal, and prints the resulting URLs. For CI, pass secret values as secure environment variables described by `Get-Help ./scripts/deploy.ps1 -Detailed`.

The portal captures synthetic payer and pet details, offers Dog Vacine ($75), Dog XRAY ($180), and Dog Exam ($65), previews the generated Chase payload, submits to the Chase mock API, and records a safe summary in the `PaymentRecords` Azure Table. It never stores the card number, CVV, OAuth credentials, or full Chase payload/response. Payment History displays the stored POC records. Chase Review shows a readable summary and retains the sanitized raw JSON evidence returned by Chase. The Online Payments API does not provide a general Chase history list.

## Local checks

```powershell
cd api
npm install
npm test
```

Run `az bicep build --file infra/main.bicep` to validate the infrastructure template.

## Before implementation approval

Resolve the items in the requirements document, especially the exact J.P. Morgan product/API, authentication scheme, payment and history endpoint contracts, merchant/account headers, data-retention need, and PCI scope. A static access token may be suitable for a developer mock environment but must not be assumed to be the production authentication design.
