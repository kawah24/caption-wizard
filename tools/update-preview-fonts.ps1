# Regenerates preview/fonts.js from the font families installed on this machine.
#
# The browser preview needs a font list, but only After Effects can say which
# fonts the host can actually use. This writes a representative list so the
# preview page renders a realistic font picker. Re-run it after installing or
# removing fonts, then reload the preview page.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$out  = Join-Path $root 'preview\fonts.js'

$families = @()

try {
    Add-Type -AssemblyName System.Drawing
    $collection = New-Object System.Drawing.Text.InstalledFontCollection
    $families = $collection.Families | ForEach-Object { $_.Name }
    Write-Host "font list source: System.Drawing.InstalledFontCollection"
} catch {
    Write-Host "System.Drawing unavailable, falling back to the font registry"
    $keys = @(
        'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts',
        'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
    )
    $raw = @()
    foreach ($key in $keys) {
        if (Test-Path $key) { $raw += (Get-Item $key).GetValueNames() }
    }

    $styleWords = 'Thin|ExtraLight|UltraLight|Light|SemiLight|DemiLight|Book|Regular|Normal|' +
                  'Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy|' +
                  'Italic|Oblique|Narrow|Condensed|Expanded|Extended'

    $families = foreach ($name in $raw) {
        $clean = $name -replace '\s*\((TrueType|OpenType|Type 1|All res)\)\s*$', ''
        $clean = $clean -replace "(?i)\s+($styleWords)(\s+($styleWords))*\s*$", ''
        $clean
    }
}

$clean = $families |
    Where-Object { $_ -and $_.Trim().Length -gt 0 } |
    ForEach-Object { $_.Trim() } |
    Sort-Object -Unique

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')

$lines = @()
$lines += '/**'
$lines += ' * Font families installed on this machine, for the browser preview only.'
$lines += " * Generated $stamp by tools/update-preview-fonts.ps1."
$lines += ' * The real panel asks After Effects for its font list; this file exists so the'
$lines += ' * preview page can render a representative font picker without a host.'
$lines += ' * Regenerate with:  powershell -File tools\update-preview-fonts.ps1'
$lines += ' */'
$lines += "window.LCP_PREVIEW_FONTS_GENERATED = '$stamp';"
$lines += 'window.LCP_PREVIEW_FONTS = ['

for ($i = 0; $i -lt $clean.Count; $i++) {
    $comma = if ($i -lt $clean.Count - 1) { ',' } else { '' }
    $escaped = $clean[$i].Replace("'", "\'")
    $lines += "  '$escaped'$comma"
}

$lines += '];'

$dir = Split-Path $out -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
Set-Content -LiteralPath $out -Value $lines -Encoding UTF8

Write-Host "wrote $($clean.Count) font families to preview\fonts.js"
