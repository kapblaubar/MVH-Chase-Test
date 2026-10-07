param location string
param keyVaultName string
param staticWebAppName string
param functionAppName string
param chaseCreatePath string
param chaseHistoryPath string
param chaseClientIdHeader string
param chaseApiBaseUrl string
param chaseRequestIdHeader string
param chaseMerchantId string
param additionalAllowedOrigins string
param tags object

var suffix = uniqueString(subscription().id, resourceGroup().id)
var storageName = take('mvhchase${suffix}', 24)
var logName = 'MVH-Chase-POC-logs-${suffix}'
var insightsName = 'MVH-Chase-POC-insights-${suffix}'
var planName = 'MVH-Chase-POC-plan-${suffix}'
var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource paymentRecords 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'PaymentRecords'
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logName
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: insightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableLocalAuth: false
    IngestionMode: 'LogAnalytics'
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      alwaysOn: false
      ftpsState: 'Disabled'
      http20Enabled: true
      minTlsVersion: '1.2'
      linuxFxVersion: 'NODE|22'
      cors: {
        allowedOrigins: filter(split(additionalAllowedOrigins, ','), origin => !empty(origin))
        supportCredentials: false
      }
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'AzureWebJobsFeatureFlags'
          value: 'EnableWorkerIndexing'
        }
        {
          name: 'FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR'
          value: 'true'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~22'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: insights.properties.ConnectionString
        }
        {
          name: 'CHASE_API_BASE_URL'
          value: chaseApiBaseUrl
        }
        {
          name: 'CHASE_TOKEN_URL'
          value: '@Microsoft.KeyVault(VaultName=${vault.name};SecretName=chase-token-url)'
        }
        {
          name: 'CHASE_CLIENT_ID'
          value: '@Microsoft.KeyVault(VaultName=${vault.name};SecretName=chase-client-id)'
        }
        {
          name: 'CHASE_CLIENT_SECRET'
          value: '@Microsoft.KeyVault(VaultName=${vault.name};SecretName=chase-client-secret)'
        }
        {
          name: 'CHASE_OAUTH_SCOPE'
          value: 'jpm:payments:sandbox'
        }
        {
          name: 'CHASE_CREATE_PATH'
          value: chaseCreatePath
        }
        {
          name: 'CHASE_HISTORY_PATH'
          value: chaseHistoryPath
        }
        {
          name: 'CHASE_CLIENT_ID_HEADER'
          value: chaseClientIdHeader
        }
        {
          name: 'CHASE_REQUEST_ID_HEADER'
          value: chaseRequestIdHeader
        }
        {
          name: 'CHASE_MERCHANT_ID'
          value: chaseMerchantId
        }
        {
          name: 'CHASE_TIMEOUT_MS'
          value: '15000'
        }
        {
          name: 'PAYMENT_RECORDS_TABLE'
          value: paymentRecords.name
        }
      ]
    }
  }
}

resource vaultSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, functionApp.id, keyVaultSecretsUserRoleId)
  scope: vault
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    allowConfigFileUpdates: true
    publicNetworkAccess: 'Enabled'
    stagingEnvironmentPolicy: 'Disabled'
  }
}

output keyVaultName string = vault.name
output staticWebAppName string = staticSite.name
output staticWebAppHostname string = staticSite.properties.defaultHostname
output functionAppName string = functionApp.name
output functionAppId string = functionApp.id
output functionHostname string = functionApp.properties.defaultHostName
