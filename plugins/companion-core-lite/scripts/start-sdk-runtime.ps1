param()

$ErrorActionPreference = 'Stop'
$pluginRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sdkRoot = Join-Path $pluginRoot 'sdk'
$dataRoot = if ($env:COMPANION_CORE_LITE_DATA_DIR) {
  [System.IO.Path]::GetFullPath($env:COMPANION_CORE_LITE_DATA_DIR)
} else {
  Join-Path $env:USERPROFILE '.companion-core-lite'
}
$identityRoot = Join-Path $dataRoot 'identity'
$personaPath = Join-Path $identityRoot 'PERSONA.md'
$configPath = Join-Path $dataRoot 'sdk-config.json'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 20 or newer is required.'
}

$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
  throw "Node.js 20 or newer is required; found $(& node --version)."
}

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
if (-not (Test-Path -LiteralPath $configPath)) {
  Copy-Item -LiteralPath (Join-Path $sdkRoot 'config.example.json') -Destination $configPath
  Write-Host "Created visible cost settings at $configPath"
}

if (-not (Test-Path -LiteralPath $personaPath)) {
  New-Item -ItemType Directory -Force -Path $identityRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $sdkRoot 'identity.example\PERSONA.md') -Destination $personaPath
  Copy-Item -LiteralPath (Join-Path $sdkRoot 'identity.example\CONTINUITY.md') -Destination (Join-Path $identityRoot 'CONTINUITY.md') -ErrorAction SilentlyContinue
  throw "Identity scaffold created at $identityRoot. Have the companion author PERSONA.md, then run this command again."
}

if ((Get-Content -LiteralPath $personaPath -Raw) -match 'COMPANION_CORE_LITE_IDENTITY_SCAFFOLD') {
  throw "PERSONA.md is still the setup scaffold at $personaPath. Have the companion author it, remove the scaffold marker, then run this command again."
}

if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'node_modules\@openai\codex-sdk'))) {
  Write-Host 'Installing the pinned local runtime dependencies...'
  & npm ci --prefix $sdkRoot
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}

Push-Location $sdkRoot
try {
  & npm start
  if ($LASTEXITCODE -ne 0) { throw "SDK runtime exited with code $LASTEXITCODE." }
} finally {
  Pop-Location
}
