<#
.SYNOPSIS
Deploys the MVH Chase POC infrastructure, secrets, API, and static portal.

.DESCRIPTION
Run after `az login` and selecting a subscription. Secret values are read from
CHASE_TOKEN_URL, CHASE_CLIENT_ID, and CHASE_CLIENT_SECRET when present; otherwise
the script prompts without echoing the values. Do not place secrets in a .ps1,
.bicepparam, shell history, or source control.

.PARAMETER Location
Azure region for regional resources.

.PARAMETER ResourceGroupName
Resource group name. Defaults to MVH-Chase-POC-RSG.

.PARAMETER KeyVaultName
Globally unique Key Vault name. Defaults to MVH-Chase-POC-KV.

.PARAMETER StaticWebAppName
Globally unique Static Web App name. Defaults to MVH-Chase-POC-webapp.

.PARAMETER FunctionAppName
Globally unique Functions app name. Defaults to MVH-Chase-POC-api.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Location,
  [string] $ResourceGroupName = 'MVH-Chase-POC-RSG',
  [string] $KeyVaultName = 'MVH-Chase-POC-KV',
  [string] $StaticWebAppName = 'MVH-Chase-POC-webapp',
  [string] $FunctionAppName = 'MVH-Chase-POC-api'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Read-SecretValue([string] $EnvironmentName, [string] $Prompt) {
  $existing = [Environment]::GetEnvironmentVariable($EnvironmentName)
  if ($existing) { return $existing }
  $secure = Read-Host $Prompt -AsSecureString
  return [System.Net.NetworkCredential]::new('', $secure).Password
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI is required.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 or newer is required.' }

$account = az account show --output json | ConvertFrom-Json
if (-not $account.id) { throw 'Run az login and select an Azure subscription first.' }
Write-Host "Deploying to subscription $($account.name) ($($account.id))"

$deploymentName = "mvh-chase-poc-$(Get-Date -Format 'yyyyMMddHHmmss')"
$deploymentJson = az deployment sub create `
  --name $deploymentName `
  --location $Location `
  --template-file (Join-Path $root 'infra/main.bicep') `
  --parameters location=$Location resourceGroupName=$ResourceGroupName keyVaultName=$KeyVaultName staticWebAppName=$StaticWebAppName functionAppName=$FunctionAppName `
  --output json
if ($LASTEXITCODE -ne 0) { throw 'Infrastructure deployment failed.' }
$deployment = $deploymentJson | ConvertFrom-Json
$functionId = $deployment.properties.outputs.functionAppId.value
$authId = "$functionId/config/authsettingsV2"

$chaseTokenUrl = Read-SecretValue 'CHASE_TOKEN_URL' 'Chase OAuth token URL'
$chaseClientId = Read-SecretValue 'CHASE_CLIENT_ID' 'Chase client ID'
$chaseClientSecret = Read-SecretValue 'CHASE_CLIENT_SECRET' 'Chase client secret'
if (-not $chaseTokenUrl.StartsWith('https://')) { throw 'The Chase token URL must start with https://.' }

az keyvault secret set --vault-name $KeyVaultName --name 'chase-token-url' --value $chaseTokenUrl --output none
if ($LASTEXITCODE -ne 0) { throw 'Could not store the Chase token URL.' }
az keyvault secret set --vault-name $KeyVaultName --name 'chase-client-id' --value $chaseClientId --output none
if ($LASTEXITCODE -ne 0) { throw 'Could not store the Chase client ID.' }
az keyvault secret set --vault-name $KeyVaultName --name 'chase-client-secret' --value $chaseClientSecret --output none
if ($LASTEXITCODE -ne 0) { throw 'Could not store the Chase client secret.' }

Push-Location (Join-Path $root 'api')
try {
  npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'API tests failed.' }
} finally {
  Pop-Location
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "mvh-chase-$([guid]::NewGuid())"
$resolvedTempParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$resolvedTempRoot = [System.IO.Path]::GetFullPath($tempRoot)
if (-not $resolvedTempRoot.StartsWith($resolvedTempParent, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Refusing to create deployment staging outside the system temp directory.'
}
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$backendRestored = $false
try {
  # A linked Static Web Apps backend enables App Service Authentication, which
  # blocks zip deployment. Temporarily unlink it, then restore and harden it.
  $linked = az staticwebapp backends show --resource-group $ResourceGroupName --name $StaticWebAppName --output json 2>$null
  if ($LASTEXITCODE -eq 0 -and $linked) {
    az staticwebapp backends unlink --resource-group $ResourceGroupName --name $StaticWebAppName --output none
    if ($LASTEXITCODE -ne 0) { throw 'Could not temporarily unlink the Functions backend.' }
  }
  az resource update --ids $authId --set properties.platform.enabled=false properties.globalValidation.requireAuthentication=false properties.globalValidation.unauthenticatedClientAction=AllowAnonymous --output none
  if ($LASTEXITCODE -ne 0) { throw 'Could not temporarily disable Functions platform authentication.' }

  $apiStage = Join-Path $tempRoot 'api'
  New-Item -ItemType Directory -Path $apiStage | Out-Null
  Copy-Item -Recurse -Path (Join-Path $root 'api/src'),(Join-Path $root 'api/node_modules') -Destination $apiStage
  Copy-Item -Path (Join-Path $root 'api/package.json'),(Join-Path $root 'api/host.json') -Destination $apiStage
  $apiZip = Join-Path $tempRoot 'api.zip'
  # Windows Compress-Archive writes backslash path separators, which the Linux
  # Functions worker cannot resolve. bsdtar creates portable ZIP entries.
  Push-Location $apiStage
  try {
    tar.exe -a -c -f $apiZip src node_modules package.json host.json
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Functions deployment package.' }
  } finally {
    Pop-Location
  }
  az functionapp deployment source config-zip --resource-group $ResourceGroupName --name $FunctionAppName --src $apiZip --output none
  if ($LASTEXITCODE -ne 0) { throw 'Functions deployment failed.' }

  az staticwebapp backends link --resource-group $ResourceGroupName --name $StaticWebAppName --backend-resource-id $functionId --backend-region $Location --output none
  if ($LASTEXITCODE -ne 0) { throw 'Could not link the Functions backend to Static Web Apps.' }
  az resource update --ids $authId --set properties.platform.enabled=true properties.globalValidation.requireAuthentication=true properties.globalValidation.unauthenticatedClientAction=Return401 --output none
  if ($LASTEXITCODE -ne 0) { throw 'Could not protect direct access to the Functions backend.' }
  $backendRestored = $true

  $deploymentToken = az staticwebapp secrets list --resource-group $ResourceGroupName --name $StaticWebAppName --query 'properties.apiKey' --output tsv
  if ($LASTEXITCODE -ne 0 -or -not $deploymentToken) { throw 'Could not retrieve the Static Web App deployment token.' }
  npx --yes @azure/static-web-apps-cli deploy (Join-Path $root 'portal') --deployment-token $deploymentToken --env production
  if ($LASTEXITCODE -ne 0) { throw 'Portal deployment failed.' }
} finally {
  if (-not $backendRestored) {
    Write-Warning 'Deployment did not complete; attempting to restore the protected backend link.'
    az staticwebapp backends link --resource-group $ResourceGroupName --name $StaticWebAppName --backend-resource-id $functionId --backend-region $Location --output none
    az resource update --ids $authId --set properties.platform.enabled=true properties.globalValidation.requireAuthentication=true properties.globalValidation.unauthenticatedClientAction=Return401 --output none
  }
  if (Test-Path -LiteralPath $resolvedTempRoot) {
    Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force
  }
  $deploymentToken = $null
  $chaseTokenUrl = $null
  $chaseClientId = $null
  $chaseClientSecret = $null
}

$portalHost = $deployment.properties.outputs.staticWebAppHostname.value
Write-Host "Deployment complete: https://$portalHost"
Write-Host 'Allow several minutes for Key Vault references and the linked backend to become ready.'
