<#
  Brightframe for Samsung TV: build, sign, install and launch the development app (supervised home pilot).

  Run from this folder in PowerShell, on the PC with Tizen Studio and the TV in Developer Mode:

    .\build-and-install.ps1 -Site https://<stable-staging-host> -CertProfile <certificate-profile> -TvIp <tv-ip>

  -Site      the stable staging address (never production; see README.md). Default below.
  -CertProfile  the Samsung certificate profile name from Tizen Studio's Certificate Manager.
  -TvIp      the TV's IP address (TV: Settings > Connection > Network > Network Status > IP Settings).
  -Bypass    optional: the Vercel "Protection Bypass for Automation" secret, if the staging site is protected.
             Or set $env:BF_TV_BYPASS. It ends up inside the .wgt: don't share the package or commit it.
  -TizenStudio  where Tizen Studio is installed (default C:\tizen-studio).
  -BuildOnly    package only; don't install.

  If PowerShell refuses to run scripts:  powershell -ExecutionPolicy Bypass -File .\build-and-install.ps1 ...
#>
param(
  [string]$Site = "https://brightframe-tv-staging.vercel.app",
  [Parameter(Mandatory = $true)][string]$CertProfile,
  [string]$TvIp = "",
  [string]$Bypass = $env:BF_TV_BYPASS,
  [string]$TizenStudio = "C:\tizen-studio",
  [switch]$BuildOnly
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = "0.2.0"

# ---- the site: https, a plain host, and never production --------------------------------------------
$Site = $Site.TrimEnd("/")
if ($Site -notmatch '^https://([a-z0-9.-]+)$') { throw "Site must be https://<host> with no path, e.g. https://brightframe-tv-staging.vercel.app" }
$hostName = $Matches[1].ToLower()
$blocked = @("brightframekids.com", "www.brightframekids.com", "shiftkids.vercel.app", "siftkids.com")
if ($blocked -contains $hostName -or $hostName.EndsWith(".brightframekids.com")) { throw "Refusing $hostName : the TV pilot must use the staging site, not production." }
if ($Bypass -and $Bypass -notmatch '^[A-Za-z0-9_-]{16,}$') { throw "That doesn't look like a Vercel bypass secret." }

# ---- tools ------------------------------------------------------------------------------------------
$tizen = Join-Path $TizenStudio "tools\ide\bin\tizen.bat"
$sdb = Join-Path $TizenStudio "tools\sdb.exe"
if (-not (Test-Path $tizen)) { throw "Tizen CLI not found at $tizen (use -TizenStudio)" }
if (-not (Test-Path $sdb)) { throw "sdb not found at $sdb (use -TizenStudio)" }

# ---- build folder -----------------------------------------------------------------------------------
$build = Join-Path $here "build\Brightframe"
if (Test-Path (Join-Path $here "build")) { Remove-Item -Recurse -Force (Join-Path $here "build") }
New-Item -ItemType Directory -Force -Path $build | Out-Null
Copy-Item -Path (Join-Path $here "app\*") -Destination $build -Recurse -Force
Get-ChildItem -Path (Join-Path $here "app") -Force -Filter ".*project" | Copy-Item -Destination $build -Force
$cfgXml = Join-Path $build "config.xml"
(Get-Content -Raw $cfgXml).Replace("__SITE_HOST__", $hostName) | Set-Content -NoNewline -Encoding UTF8 $cfgXml
$bypassJs = if ($Bypass) { $Bypass } else { "" }
"window.BF_SHELL = { site: `"$Site`", bypass: `"$bypassJs`", version: `"$version`" };" | Set-Content -Encoding UTF8 (Join-Path $build "shell-config.js")
Write-Host "Built $build for $Site$(if ($Bypass) { ' (with bypass secret)' })"

# ---- sign + package ---------------------------------------------------------------------------------
Push-Location $build
try { & $tizen package -t wgt -s $CertProfile -- $build; if ($LASTEXITCODE) { throw "tizen package failed ($LASTEXITCODE). Is '$CertProfile' the active Samsung certificate profile with this TV's DUID?" } }
finally { Pop-Location }
$wgt = Get-ChildItem -Path $build -Filter *.wgt | Select-Object -First 1
if (-not $wgt) { throw "No .wgt produced" }
Write-Host "Signed package: $($wgt.FullName)"
if ($BuildOnly) { return }

# ---- install + launch -------------------------------------------------------------------------------
if (-not $TvIp) { throw "Give -TvIp to install (or use -BuildOnly)" }
& $sdb connect "$($TvIp):26101" | Write-Host
$device = (& $sdb devices | Select-String -Pattern "^\S*$([regex]::Escape($TvIp))\S*\s+device\s+(\S+)" | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
if (-not $device) { & $sdb devices | Write-Host; throw "The TV isn't listed by 'sdb devices'. Check Developer Mode's Host PC IP is this PC, then restart the TV." }
& $tizen install -n $wgt.Name -t $device -- $build
if ($LASTEXITCODE) { throw "tizen install failed ($LASTEXITCODE). An app with the same id signed by another certificate must be uninstalled first." }
& $tizen run -p BrFrameDv1.Brightframe -t $device
Write-Host "Installed and started 'Brightframe Dev' on $device."
