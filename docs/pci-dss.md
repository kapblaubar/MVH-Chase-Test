# PCI DSS primer for this POC

## What PCI DSS is

The Payment Card Industry Data Security Standard (PCI DSS) applies to entities that store, process, or transmit payment-account data, and can also apply to systems that could affect the security of the cardholder-data environment. The current standard is PCI DSS v4.0.1. PCI compliance is not a one-time Azure setting; it combines scope, architecture, controls, operating evidence, testing, and the appropriate validation method.

Key terms:

- **Cardholder data (CHD):** at minimum the primary account number (PAN); it can also include cardholder name, expiration date, and service code when stored with the PAN.
- **Sensitive authentication data (SAD):** full track data, card verification code/value (CVV/CVC), and PIN/PIN block. SAD must not be stored after authorization, even if encrypted.
- **CDE:** people, processes, and technologies that store, process, or transmit CHD, plus systems that can affect its security.
- **SAQ:** a Self-Assessment Questionnaire used only when the organization meets that SAQ’s eligibility criteria. Your acquiring bank/payment brands determine validation obligations; a Qualified Security Assessor (QSA) can advise on scope.

## What it means here

This repository is safest when it never handles real payment-account data. J.P. Morgan’s developer mock examples may use published test values; those must remain unmistakably synthetic. A “dev” label does not exempt a system if real CHD enters it.

If this portal directly collects a PAN and sends it through this Functions API, the browser, frontend delivery path, backend, deployment pipeline, logging, operator endpoints, and connected systems can enter PCI scope. Encryption and Key Vault improve security but do not remove systems from scope.

For a future card-payment implementation, prefer a J.P. Morgan-hosted payment page, drop-in UI, or tokenization flow where card fields originate from and submit directly to the validated payment provider. That architecture may reduce scope, but SAQ A eligibility has strict conditions and must be confirmed; outsourcing does not transfer all responsibility.

If these are outbound bank/ACH payments rather than payment-card transactions, PCI DSS may not be the governing standard for the account data. That does **not** make the data low risk: apply bank-account-data security, privacy, fraud, access-control, sanctions/approval, and J.P. Morgan contractual requirements. Confirm the product before choosing the compliance framework.

## The 12 PCI DSS requirement families, in plain language

1. Install and maintain network security controls.
2. Apply secure configurations to all system components.
3. Protect stored account data.
4. Protect cardholder data with strong cryptography during transmission over open/public networks.
5. Protect systems and networks from malicious software.
6. Develop and maintain secure systems and software.
7. Restrict access by business need-to-know.
8. Identify users and authenticate access.
9. Restrict physical access to cardholder data.
10. Log and monitor access to systems and cardholder data.
11. Regularly test security systems and processes.
12. Maintain organizational security policies and programs.

The POC’s deliberate lack of sign-in conflicts with the spirit—and likely applicability—of access-control requirements if real account data or payment capability is present. Therefore anonymous access is acceptable only with synthetic data, mock endpoints, limited lifetime, and preferably network restrictions. Add Entra ID before broad access.

## Required guardrails for this phase

- Use only J.P. Morgan mock/test endpoints and synthetic values.
- Never store PAN, CVV, bank-account numbers, payloads, or tokens in logs, screenshots, tickets, browser storage, or source control.
- Keep secrets server-side in Key Vault and rotate them after suspected disclosure.
- Limit portal access at the network/platform layer where practical even before application sign-in is added.
- Run dependency, static-code, IaC, and secret scanning in CI.
- Patch supported runtimes; review access and logs; define incident response and secret-rotation procedures.
- Document the data flow and inventory every component able to influence it.
- Obtain the service provider’s current Attestation of Compliance for the services used and document shared responsibilities.
- Before real data, ask the acquirer/QSA to confirm scope and the correct SAQ/ROC path. Do not self-select SAQ A solely because a third party is involved.

## Primary references

- [PCI SSC document library (PCI DSS v4.0.1 and SAQs)](https://www.pcisecuritystandards.org/document_library/)
- [PCI SSC: SAQs for PCI DSS v4.0.1](https://www.pcisecuritystandards.org/wp-content/uploads/2024/10/SAQs_for_PCI_DSS_v4.0.1_Bulletin.pdf)
- [PCI SSC FAQ 1580: applicability and outsourced services](https://www.pcisecuritystandards.org/faqs/1580/)
- [J.P. Morgan Payments Developer Portal quick start](https://developer.payments.jpmorgan.com/docs/quick-start)
- [J.P. Morgan Online Payments overview](https://developer.payments.jpmorgan.com/docs/commerce/online-payments/capabilities/online-payments/index)
- [Azure Static Web Apps API options](https://learn.microsoft.com/azure/static-web-apps/apis-functions)
- [Azure managed identity for App Service and Functions](https://learn.microsoft.com/azure/app-service/overview-managed-identity)

This is practical engineering guidance, not a compliance attestation or legal advice.
