$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 20 or newer is required.'
}

& node (Join-Path $PSScriptRoot 'start-sdk-runtime.mjs')
if ($LASTEXITCODE -ne 0) { throw "SDK runtime exited with code $LASTEXITCODE." }
