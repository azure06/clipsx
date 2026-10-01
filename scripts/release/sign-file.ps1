param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = 'Stop'
if (-not $env:CLIPSX_SIGNTOOL -or -not $env:CLIPSX_CERT_THUMBPRINT) { throw 'Signing environment is not configured.' }
& $env:CLIPSX_SIGNTOOL sign /sha1 $env:CLIPSX_CERT_THUMBPRINT /fd SHA256 /tr http://time.certum.pl /td SHA256 /v $Path
if ($LASTEXITCODE -ne 0) { throw "SignTool failed for $Path" }
& $env:CLIPSX_SIGNTOOL verify /pa /all /v $Path
if ($LASTEXITCODE -ne 0) { throw "Signature verification failed for $Path" }
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $env:CLIPSX_CERT_THUMBPRINT -or -not $signature.TimeStamperCertificate) { throw "Unexpected signing certificate or missing timestamp: $Path" }
if ($env:CLIPSX_SIGNING_LOG) {
    [pscustomobject]@{ File = [IO.Path]::GetFileName($Path); Sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant(); Thumbprint = $signature.SignerCertificate.Thumbprint; Timestamped = $true } | ConvertTo-Json -Compress | Add-Content -LiteralPath $env:CLIPSX_SIGNING_LOG
}
