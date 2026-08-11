$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'test-share-tree.mjs'))
if ($args.Count -gt 0) { $arguments += $args[0] }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw "Share-tree audit exited with code $LASTEXITCODE." }
