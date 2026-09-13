<#
.SYNOPSIS
Post-processes an `npm run release` publish.

electron-builder's `--publish always` reliably uploads the small
.blockmap but then leaves the GitHub release in a draft state with the
large installer .exe and latest.yml missing, no error surfaced in the
build log. Separately, `gh release upload` sanitizes spaces in a local
filename to dots, which won't match the hyphenated name latest.yml
records (electron-builder's own artifactName convention) - so the
missing assets have to be re-uploaded from a renamed copy, not the
original build output.

This has hit three releases in a row (v0.1.6, v0.1.7, v0.1.8) with the
exact same symptoms. Run this after every `npm run release` (it also
runs automatically as the `postrelease` npm script).

.PARAMETER Version
Defaults to the version in shell/package.json.
#>

param(
    [string]$Version
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$shellDir = Split-Path -Parent $scriptDir
$distDir = Join-Path (Split-Path -Parent $shellDir) 'dist'

if (-not $Version) {
    $pkg = Get-Content (Join-Path $shellDir 'package.json') -Raw | ConvertFrom-Json
    $Version = $pkg.version
}
$tag = "v$Version"

Write-Output "Verifying release $tag ..."

$latestYmlPath = Join-Path $distDir 'latest.yml'
if (-not (Test-Path $latestYmlPath)) {
    throw "$latestYmlPath not found - run 'npm run dist' or 'npm run release' first."
}
$latestYml = Get-Content $latestYmlPath -Raw
$installerName = ([regex]::Match($latestYml, '(?m)^path:\s*(.+)$')).Groups[1].Value.Trim()
$expectedSha512 = ([regex]::Match($latestYml, '(?m)^sha512:\s*(.+)$')).Groups[1].Value.Trim()
if (-not $installerName -or -not $expectedSha512) {
    throw "Could not parse 'path'/'sha512' out of $latestYmlPath"
}

$release = gh release view $tag --json assets,isDraft | ConvertFrom-Json
$existingNames = @($release.assets | ForEach-Object { $_.name })

$required = @($installerName, 'latest.yml')
foreach ($name in $required) {
    if ($existingNames -notcontains $name) {
        Write-Output "Missing asset on release: $name - uploading ..."
        $localPath = Join-Path $distDir $name
        if (-not (Test-Path $localPath)) {
            throw "Expected local file not found: $localPath (electron-builder's local artifact name has spaces, not hyphens - check $distDir)"
        }
        gh release upload $tag $localPath --clobber
        if ($LASTEXITCODE -ne 0) { throw "gh release upload failed for $name" }
    } else {
        Write-Output "Already present: $name"
    }
}

if ($release.isDraft) {
    Write-Output "Release is still a draft - publishing it (electron-updater ignores drafts entirely) ..."
    gh release edit $tag --draft=false
    if ($LASTEXITCODE -ne 0) { throw "gh release edit --draft=false failed" }
} else {
    Write-Output "Release is already published (not a draft)."
}

Write-Output "Downloading published installer to verify its checksum matches latest.yml ..."
$verifyDir = Join-Path $env:TEMP "dineforge-release-verify-$Version"
if (Test-Path $verifyDir) { Remove-Item -Recurse -Force $verifyDir }
New-Item -ItemType Directory -Force -Path $verifyDir | Out-Null
gh release download $tag --pattern $installerName --dir $verifyDir --clobber
if ($LASTEXITCODE -ne 0) { throw "gh release download failed for $installerName" }

$downloadedPath = Join-Path $verifyDir $installerName
$sha = [System.Security.Cryptography.SHA512]::Create()
try {
    $bytes = [System.IO.File]::ReadAllBytes($downloadedPath)
    $actualSha512 = [Convert]::ToBase64String($sha.ComputeHash($bytes))
} finally {
    $sha.Dispose()
}
Remove-Item -Recurse -Force $verifyDir

if ($actualSha512 -ne $expectedSha512) {
    throw "SHA512 mismatch for $installerName!`nExpected (latest.yml): $expectedSha512`nActual (downloaded):   $actualSha512`nelectron-updater will silently fail to update clients - re-upload the installer."
}

Write-Output "Verified: $installerName matches latest.yml's SHA512."
Write-Output "Release $tag is complete and published."
