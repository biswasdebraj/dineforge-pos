<#
.SYNOPSIS
Downloads and stages the portable PHP runtime bundled into the FoodNest POS
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

# Only pdo_sqlite/sqlite3 are needed — this app never loads any other
# extension, and dev/ (build headers) is never needed at runtime.
Remove-Item -Recurse -Force (Join-Path $phpDir 'dev') -ErrorAction SilentlyContinue
$extDir = Join-Path $phpDir 'ext'
Get-ChildItem $extDir -Filter '*.dll' | Where-Object {
    $_.Name -ne 'php_pdo_sqlite.dll' -and $_.Name -ne 'php_sqlite3.dll'
} | Remove-Item -Force

# Portable builds ship without an active php.ini — base ours on the
# production template with just the two needed extensions enabled.
$iniContent = Get-Content (Join-Path $phpDir 'php.ini-production') -Raw
$iniContent = $iniContent -replace '(?m)^;extension_dir = "ext"', 'extension_dir = "ext"'
$iniContent = $iniContent -replace '(?m)^;extension=pdo_sqlite', 'extension=pdo_sqlite'
$iniContent = $iniContent -replace '(?m)^;extension=sqlite3', 'extension=sqlite3'
Set-Content -Path (Join-Path $phpDir 'php.ini') -Value $iniContent -Encoding utf8 -NoNewline

$loaded = & (Join-Path $phpDir 'php.exe') -c (Join-Path $phpDir 'php.ini') -m
if ($loaded -notcontains 'pdo_sqlite' -or $loaded -notcontains 'sqlite3') {
    throw 'pdo_sqlite/sqlite3 did not load correctly after setup'
}

Write-Output "PHP $phpVersion staged at $phpDir with pdo_sqlite/sqlite3 enabled."
