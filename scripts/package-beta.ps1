param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $OutputPath) {
  $OutputPath = Join-Path $repoRoot 'dist\companion-core-lite-beta.zip'
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("companion-core-lite-package-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null
try {
  foreach ($directory in @('.agents', 'plugins', 'docs')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $directory) -Destination (Join-Path $stageRoot $directory) -Recurse -Force
  }
  foreach ($file in @('README.md', 'START_HERE.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LICENSE')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $stageRoot $file) -Force
  }

  Get-ChildItem -LiteralPath $stageRoot -Directory -Recurse -Force |
    Where-Object { $_.Name -eq 'node_modules' } |
    Sort-Object FullName -Descending |
    Remove-Item -Recurse -Force

  $items = Get-ChildItem -LiteralPath $stageRoot -Force | Select-Object -ExpandProperty FullName
  Compress-Archive -LiteralPath $items -DestinationPath $resolvedOutput -CompressionLevel Optimal -Force
  Write-Output $resolvedOutput
} finally {
  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
}
