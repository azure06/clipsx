param(
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+-\d+-\d+$')][string]$CandidateId,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$CertificateThumbprint,
    [string]$SignToolPath,
    [string]$WorkingDirectory = (Join-Path $env:TEMP "clipsx-sign-$CandidateId")
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'Run this helper on Windows.' }
foreach ($program in @('node', 'npm', 'gh', 'cargo', 'tar')) { if (-not (Get-Command $program -ErrorAction SilentlyContinue)) { throw "$program is required." } }
if (-not $SignToolPath) {
    $known = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($known) { $SignToolPath = $known.Source }
    else {
        $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
        $SignToolPath = Get-ChildItem -LiteralPath $sdkRoot -Recurse -Filter signtool.exe | Where-Object { $_.Directory.Name -eq 'x64' } | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
}
if (-not $SignToolPath -or -not (Test-Path -LiteralPath $SignToolPath)) { throw 'Install the Windows SDK signing tools or pass -SignToolPath.' }
& gh auth status
if ($LASTEXITCODE -ne 0) { throw 'Authenticate GitHub CLI first.' }
$certificate = Get-Item -LiteralPath "Cert:/CurrentUser/My/$CertificateThumbprint" -ErrorAction SilentlyContinue
if (-not $certificate -or -not $certificate.HasPrivateKey) { throw 'Log into SimplySign in this Windows user session first.' }
if ($certificate.NotAfter -le (Get-Date)) { throw 'The signing certificate has expired.' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$pipeline = Join-Path $root 'scripts/release/pipeline.mjs'
$work = [IO.Path]::GetFullPath($WorkingDirectory)
# Never reuse or delete an existing user directory. A fresh workspace also prevents
# a previously signed executable from being accidentally packaged for another run.
if (Test-Path -LiteralPath $work) { throw 'WorkingDirectory already exists. Choose a fresh directory.' }
New-Item -ItemType Directory -Path $work | Out-Null
$previousWork = $env:RELEASE_WORKDIR
try {
    $env:RELEASE_WORKDIR = $work
    Push-Location $root
    try { & node $pipeline prepare-windows $CandidateId; if ($LASTEXITCODE -ne 0) { throw 'Candidate retrieval failed.' } } finally { Pop-Location }
    $candidate = Get-Content -LiteralPath (Join-Path $work 'signing-candidate.json') -Raw | ConvertFrom-Json
    $kit = Join-Path $work 'windows-kit'
    $source = Join-Path $work 'source'
    Expand-Archive -LiteralPath (Join-Path $kit 'source.zip') -DestinationPath $source
    New-Item -ItemType Directory -Path (Join-Path $source 'src-tauri/target/x86_64-pc-windows-msvc/release') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $source 'dist') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $kit 'clipsx.exe') -Destination (Join-Path $source 'src-tauri/target/x86_64-pc-windows-msvc/release/clipsx.exe')
    Copy-Item -LiteralPath (Join-Path $kit 'tauri.auth.csp.conf.json') -Destination (Join-Path $source 'src-tauri/tauri.auth.csp.conf.json')
    & tar -xzf (Join-Path $kit 'frontend.tar.gz') -C (Join-Path $source 'dist')
    if ($LASTEXITCODE -ne 0) { throw 'Frontend extraction failed.' }
    $env:CLIPSX_SIGNTOOL = [IO.Path]::GetFullPath($SignToolPath)
    $env:CLIPSX_CERT_THUMBPRINT = $CertificateThumbprint.ToUpperInvariant()
    $env:CLIPSX_SIGNING_LOG = Join-Path $work 'signing-log.jsonl'
    # Use the trusted helper's signing wrapper, not a command from the candidate.
    $signScript = Join-Path $PSScriptRoot 'sign-file.ps1'
    $signHost = Join-Path $PSHOME $(if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' })
    $signCommand = @($signHost, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $signScript, '%1')
    $overlay = @{ build = @{ beforeBuildCommand = $null; beforeBundleCommand = $null }; bundle = @{ targets = @('nsis'); createUpdaterArtifacts = $false; windows = @{ signCommand = @{ cmd = $signCommand[0]; args = $signCommand[1..($signCommand.Length - 1)] }; nsis = @{ installMode = 'currentUser' } } } }
    $configPath = Join-Path $work 'signing.conf.json'
    [IO.File]::WriteAllText($configPath, ($overlay | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
    Push-Location $source
    try {
        & npm ci --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Pinned packaging dependency installation failed.' }
        & node node_modules/@tauri-apps/cli/tauri.js bundle --ci --verbose --target x86_64-pc-windows-msvc --bundles nsis --config src-tauri/tauri.auth.csp.conf.json --config $configPath
        if ($LASTEXITCODE -ne 0) { throw 'Signed bundling failed.' }
    } finally { Pop-Location }
    $installers = @(Get-ChildItem -LiteralPath (Join-Path $source 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis') -Filter '*.exe')
    if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer.' }
    $signatures = @(Get-Content -LiteralPath $env:CLIPSX_SIGNING_LOG | ForEach-Object { $_ | ConvertFrom-Json })
    # NSIS signs its generated uninstaller under a temporary filename. The wrapper
    # verifies every signing operation; CI inspects the actual installed uninstaller.
    if (-not ($signatures | Where-Object { $_.File -eq 'clipsx.exe' })) { throw 'Application signing evidence is missing.' }
    if (-not ($signatures | Where-Object { $_.File -eq $installers[0].Name })) { throw 'Installer signing evidence is missing.' }
    Push-Location $root
    try {
        & node (Join-Path $PSScriptRoot 'image.mjs') (Join-Path $work 'signing-candidate.json') (Join-Path $source 'src-tauri/target/x86_64-pc-windows-msvc/release')
        if ($LASTEXITCODE -ne 0) { throw 'Packaging executable identity verification failed.' }
    } finally { Pop-Location }
    $evidence = @{ candidateId = $candidate.id; verified = $true; thumbprint = $env:CLIPSX_CERT_THUMBPRINT; signatures = $signatures }
    $evidencePath = Join-Path $work 'windows-evidence.json'
    $evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $evidencePath -Encoding utf8
    Push-Location $root
    try { & node $pipeline submit-windows $candidate.id $installers[0].FullName $evidencePath; if ($LASTEXITCODE -ne 0) { throw 'Upload or finalization dispatch failed. Keep this workspace for recovery.' } } finally { Pop-Location }
    Write-Host "Signed candidate $($candidate.id) uploaded. CI finalization has been requested. Workspace: $work"
} finally {
    $env:RELEASE_WORKDIR = $previousWork
    Remove-Item Env:CLIPSX_SIGNTOOL, Env:CLIPSX_CERT_THUMBPRINT, Env:CLIPSX_SIGNING_LOG -ErrorAction SilentlyContinue
}
