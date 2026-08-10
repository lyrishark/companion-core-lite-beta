param(
  [string]$RootPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = if ($RootPath) {
  (Resolve-Path -LiteralPath $RootPath).Path
} else {
  (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
}

$forbiddenLeafNames = @(
  '.env',
  'auth.json',
  'activity-state.json',
  'discord-bridge-session.json',
  'sdk-budget-ledger.json',
  'sdk-runtime-state.json',
  'sdk-failed-turn.json'
)
$forbiddenDirectories = @('node_modules', 'sdk-codex-home', '.local-data')
$textExtensions = @('.json', '.md', '.mjs', '.js', '.ts', '.ps1', '.html', '.yml', '.yaml', '.toml', '.txt')
$secretPatterns = @(
  '(?<![A-Za-z0-9_-])mfa\.[A-Za-z0-9_-]{40,}',
  '(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])',
  '(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}',
  '(?<![A-Za-z0-9_-])gh[pousr]_[A-Za-z0-9]{30,}'
)

$gitPaths = @(& git -C $repoRoot ls-files --cached --others --exclude-standard 2>$null)
if ($LASTEXITCODE -eq 0) {
  $files = $gitPaths | ForEach-Object { Get-Item -LiteralPath (Join-Path $repoRoot $_) } | Where-Object { -not $_.PSIsContainer }
} else {
  $files = Get-ChildItem -LiteralPath $repoRoot -File -Recurse -Force | Where-Object {
    $relative = $_.FullName.Substring($repoRoot.Length).TrimStart('\')
    $segments = $relative -split '\\'
    '.git' -notin $segments -and 'dist' -notin $segments -and 'node_modules' -notin $segments
  }
}

$forbiddenFiles = $files | Where-Object {
  $_.Name -in $forbiddenLeafNames -or
  (($_.FullName.Substring($repoRoot.Length).TrimStart('\') -split '\\') | Where-Object { $_ -in $forbiddenDirectories })
}
if ($forbiddenFiles) {
  $paths = $forbiddenFiles.FullName -join [Environment]::NewLine
  throw "Share tree contains forbidden live-state or dependency paths:`n$paths"
}

$suspectFiles = [System.Collections.Generic.List[string]]::new()
foreach ($file in $files | Where-Object { $_.Extension.ToLowerInvariant() -in $textExtensions }) {
  $content = Get-Content -LiteralPath $file.FullName -Raw
  if ($secretPatterns | Where-Object { $content -match $_ }) {
    $suspectFiles.Add($file.FullName)
  }
}
if ($suspectFiles.Count) {
  throw "Possible token-shaped secret found; values were not printed. Inspect:`n$($suspectFiles -join [Environment]::NewLine)"
}

Write-Output "Share-tree audit passed: $($files.Count) files checked; no forbidden live state, dependencies, or token-shaped secrets found."
