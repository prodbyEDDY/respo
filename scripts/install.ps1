# Respo installer bootstrap for Windows.
#
#   irm https://raw.githubusercontent.com/prodbyEDDY/respo/main/scripts/install.ps1 | iex
#
# Downloads the latest `Respo-Setup-<version>.exe` from GitHub Releases into %TEMP%
# and runs it. The installer is per-user (no administrator rights) and the app
# updates itself from the same releases afterwards. Nothing else is touched.

$ErrorActionPreference = 'Stop'
$repo = 'prodbyEDDY/respo'

Write-Host "Respo: looking up the latest release of $repo..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'respo-install' }
$asset = $release.assets | Where-Object { $_.name -like 'Respo-Setup-*.exe' } | Select-Object -First 1
if (-not $asset) { throw "No Windows installer found in release $($release.tag_name)." }

$target = Join-Path $env:TEMP $asset.name
Write-Host "Respo: downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target -Headers @{ 'User-Agent' = 'respo-install' }

Write-Host "Respo: starting the installer. If SmartScreen appears, choose 'More info' -> 'Run anyway' (the build is not code-signed yet)."
Start-Process -FilePath $target -Wait
Write-Host "Respo $($release.tag_name) is installed. Find it in the Start menu."
