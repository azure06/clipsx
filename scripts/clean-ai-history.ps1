$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'clean-ai-history.mjs'
& node $scriptPath @args
exit $LASTEXITCODE
