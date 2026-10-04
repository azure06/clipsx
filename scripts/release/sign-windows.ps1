# Retain the documented entrypoint; the implementation owns its parameter checks.
& (Join-Path $PSScriptRoot 'platforms/windows/sign-windows.ps1') @args
