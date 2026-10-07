targetScope = 'subscription'

@description('Azure region for the resource group and regional services.')
param location string

@description('Resource group name.')
param resourceGroupName string = 'MVH-Chase-POC-RSG'

@description('Globally unique Key Vault name.')
param keyVaultName string = 'MVH-Chase-POC-KV'

@description('Globally unique Static Web App name.')
param staticWebAppName string = 'MVH-Chase-POC-webapp'

@description('Globally unique Functions app name.')
param functionAppName string = 'MVH-Chase-POC-api'

@description('Relative path appended to the Chase base URL for payment creation.')
param chaseCreatePath string = '/api/v2/payments'

@description('Relative path appended to the Chase base URL for payment retrieval.')
param chaseHistoryPath string = '/api/v2/payments'

@description('J.P. Morgan API base URL. This is not the OAuth token URL.')
param chaseApiBaseUrl string = 'https://api-mock.payments.jpmorgan.com'

@description('Header used to send the Chase client ID. Set to an empty string if unused.')
param chaseClientIdHeader string = ''

@description('Header used for the upstream request/correlation ID.')
param chaseRequestIdHeader string = 'request-id'

@description('Mock merchant ID from the J.P. Morgan Online Payments quick start.')
param chaseMerchantId string = '998482157630'

@description('Optional comma-separated local-development CORS origins. Production uses the linked backend route.')
param additionalAllowedOrigins string = 'http://localhost:4280,http://localhost:5173'

param tags object = {
  project: 'MVH-Chase-POC'
  environment: 'dev'
  dataClassification: 'synthetic-only'
  managedBy: 'bicep'
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module platform './platform.bicep' = {
  name: 'mvh-chase-poc-platform'
  scope: resourceGroup
  params: {
    location: location
    keyVaultName: keyVaultName
    staticWebAppName: staticWebAppName
    functionAppName: functionAppName
    chaseCreatePath: chaseCreatePath
    chaseHistoryPath: chaseHistoryPath
    chaseClientIdHeader: chaseClientIdHeader
    chaseApiBaseUrl: chaseApiBaseUrl
    chaseRequestIdHeader: chaseRequestIdHeader
    chaseMerchantId: chaseMerchantId
    additionalAllowedOrigins: additionalAllowedOrigins
    tags: tags
  }
}

output resourceGroupName string = resourceGroup.name
output keyVaultName string = platform.outputs.keyVaultName
output staticWebAppName string = platform.outputs.staticWebAppName
output staticWebAppHostname string = platform.outputs.staticWebAppHostname
output functionAppName string = platform.outputs.functionAppName
output functionAppId string = platform.outputs.functionAppId
output functionHostname string = platform.outputs.functionHostname
