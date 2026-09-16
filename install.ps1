# Caption Wizard - Windows installer for the CEP panel.
#
# Does exactly two things:
#   1. copies this folder into the per-user CEP extensions directory
#   2. sets HKCU\Software\Adobe\CSXS.11 PlayerDebugMode = 1 so CEP loads an
#      unsigned extension (Adobe's documented developer switch)
#
# It does not touch any other registry key, file, or application setting.

$ErrorActionPreference = 'Stop'

$source      = $PSScriptRoot
$extensions  = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$destination = Join-Path $extensions 'caption-wizard'
$csxsKey     = 'HKCU:\Software\Adobe\CSXS.11'

Write-Host ''
Write-Host 'Caption Wizard - install' -ForegroundColor Cyan
Write-Host '-----------------------------'

# --- sanity check -----------------------------------------------------------
$manifest = Join-Path $source 'CSXS\manifest.xml'
if (-not (Test-Path $manifest)) {
    Write-Host "CSXS\manifest.xml not found next to this script ($source)." -ForegroundColor Red
    Write-Host 'Run the script from inside the caption-wizard folder.'
    exit 1
}

# --- 1. copy the extension --------------------------------------------------
Write-Host "[1/2] Installing to: $destination"
New-Item -ItemType Directory -Force -Path $extensions | Out-Null
New-Item -ItemType Directory -Force -Path $destination | Out-Null

$skip = @('.git', 'node_modules', '.openclaw')
Get-ChildItem -LiteralPath $source -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
    $target = Join-Path $destination $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
}
Write-Host '      files copied.'

# --- 2. enable CEP debug loading -------------------------------------------
Write-Host "[2/2] Enabling unsigned extension loading ($csxsKey)"
if (-not (Test-Path $csxsKey)) {
    New-Item -Path $csxsKey -Force | Out-Null
    Write-Host '      created the CSXS.11 key.'
}

$current = (Get-ItemProperty -Path $csxsKey -Name 'PlayerDebugMode' -ErrorAction SilentlyContinue).PlayerDebugMode
if ($current -eq '1') {
    Write-Host '      PlayerDebugMode was already 1 - left unchanged.'
} else {
    New-ItemProperty -Path $csxsKey -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null
    Write-Host '      set PlayerDebugMode = 1.'
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host 'Next:'
Write-Host '  1. Restart After Effects'
Write-Host '  2. Window > Extensions (Legacy) > Caption Wizard'
Write-Host ''
