param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$CandidateId)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Installation verification runs only on a disposable GitHub-hosted runner.' }
if ($env:WINDOWS_SIGNING_CERT_THUMBPRINT -notmatch '^[a-fA-F0-9]{40}$') { throw 'Configure WINDOWS_SIGNING_CERT_THUMBPRINT.' }
$work = [IO.Path]::GetFullPath('.release')
$candidate = Get-Content -LiteralPath (Join-Path $work 'signing-candidate.json') -Raw | ConvertFrom-Json
if ($candidate.id -ne $CandidateId) { throw 'Candidate identity mismatch.' }
function Assert-Signature([string]$File) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $env:WINDOWS_SIGNING_CERT_THUMBPRINT -or -not $signature.TimeStamperCertificate) { throw "Invalid Authenticode certificate or timestamp: $File" }
}
Assert-Signature $Installer
$installRoot = Join-Path $env:RUNNER_TEMP "clipsx-certification-$CandidateId"
if (Test-Path -LiteralPath $installRoot) { throw 'Disposable installation directory already exists.' }
$process = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$installRoot") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
$uninstaller = Join-Path $installRoot 'uninstall.exe'
try {
    Assert-Signature $uninstaller
    foreach ($image in $candidate.windowsImages.PSObject.Properties) { Assert-Signature (Join-Path $installRoot $image.Name) }
    & node (Join-Path $PSScriptRoot 'image.mjs') (Join-Path $work 'signing-candidate.json') $installRoot installed
    if ($LASTEXITCODE -ne 0) { throw 'Installed executable identity verification failed.' }
    @{ candidateId = $CandidateId; verified = $true; installerSha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant(); thumbprint = $env:WINDOWS_SIGNING_CERT_THUMBPRINT; applicationVerified = $true; uninstallerVerified = $true; originalImageVerified = $true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $work 'native-evidence-windows-x64.json') -Encoding utf8
} finally {
    if (Test-Path -LiteralPath $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait | Out-Null }
}
