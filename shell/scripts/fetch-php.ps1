<#
.SYNOPSIS
Downloads and stages the portable PHP runtime bundled into the DineForge POS
installer, so the restaurant owner never has to install PHP themselves.

Run this once before `npm run dist`. Not committed to git (shell/resources/php
is gitignored) — a ~30MB official binary download doesn't belong in source
control history, and this script makes it reproducible instead.
#>

$ErrorActionPreference = 'Stop'

$phpVersion = '8.2.33'
$zipUrl = "https://downloads.php.net/~windows/releases/php-$phpVersion-nts-Win32-vs16-x64.zip"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$resourcesDir = Join-Path (Split-Path -Parent $scriptDir) 'resources'
$phpDir = Join-Path $resourcesDir 'php'
$zipPath = Join-Path $resourcesDir 'php.zip'

if (Test-Path $phpDir) {
    Write-Output "Removing existing $phpDir"
    Remove-Item -Recurse -Force $phpDir
}
New-Item -ItemType Directory -Force -Path $resourcesDir | Out-Null

Write-Output "Downloading PHP $phpVersion NTS x64 from $zipUrl"
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

Write-Output "Extracting to $phpDir"
Expand-Archive -Path $zipPath -DestinationPath $phpDir -Force
Remove-Item $zipPath

# pdo_sqlite/sqlite3 for the database; mbstring/zip for PhpSpreadsheet
# (menu Excel import/template — the Xlsx reader needs ZipArchive from the
# zip extension, and PhpSpreadsheet's shared string handling needs
# mbstring). Nothing else is needed, and dev/ (build headers) never is.
$neededExtensions = @('php_pdo_sqlite.dll', 'php_sqlite3.dll', 'php_mbstring.dll', 'php_zip.dll')
Remove-Item -Recurse -Force (Join-Path $phpDir 'dev') -ErrorAction SilentlyContinue
$extDir = Join-Path $phpDir 'ext'
Get-ChildItem $extDir -Filter '*.dll' | Where-Object {
    $neededExtensions -notcontains $_.Name
} | Remove-Item -Force

# Portable builds ship without an active php.ini — base ours on the
# production template with just the needed extensions enabled.
$iniContent = Get-Content (Join-Path $phpDir 'php.ini-production') -Raw
$iniContent = $iniContent -replace '(?m)^;extension_dir = "ext"', 'extension_dir = "ext"'
$iniContent = $iniContent -replace '(?m)^;extension=pdo_sqlite', 'extension=pdo_sqlite'
$iniContent = $iniContent -replace '(?m)^;extension=sqlite3', 'extension=sqlite3'
$iniContent = $iniContent -replace '(?m)^;extension=mbstring', 'extension=mbstring'
$iniContent = $iniContent -replace '(?m)^;extension=zip', 'extension=zip'
Set-Content -Path (Join-Path $phpDir 'php.ini') -Value $iniContent -Encoding utf8 -NoNewline

$loaded = & (Join-Path $phpDir 'php.exe') -c (Join-Path $phpDir 'php.ini') -m
foreach ($required in @('pdo_sqlite', 'sqlite3', 'mbstring', 'zip')) {
    if ($loaded -notcontains $required) {
        throw "$required did not load correctly after setup"
    }
}

Write-Output "PHP $phpVersion staged at $phpDir with pdo_sqlite/sqlite3/mbstring/zip enabled."
