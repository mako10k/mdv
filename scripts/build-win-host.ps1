param(
  [string]$SourceRoot = "\\wsl.localhost\Ubuntu\home\katsumata-m\mdv",
  [string]$NodeVersion = "v22.22.3",
  [switch]$RequireElevation
)

$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-Elevated {
  param(
    [string]$ScriptPath,
    [string]$ResolvedSourceRoot,
    [string]$ResolvedNodeVersion
  )

  $argumentList = @(
    '-NoProfile'
    '-ExecutionPolicy', 'Bypass'
    '-File', ('"{0}"' -f $ScriptPath)
    '-SourceRoot', ('"{0}"' -f $ResolvedSourceRoot)
    '-NodeVersion', ('"{0}"' -f $ResolvedNodeVersion)
  )

  $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argumentList -Wait -PassThru
  exit $process.ExitCode
}

if ($RequireElevation -and -not (Test-IsAdministrator)) {
  Restart-Elevated -ScriptPath $PSCommandPath -ResolvedSourceRoot $SourceRoot -ResolvedNodeVersion $NodeVersion
}

$workRoot = Join-Path $env:TEMP 'mdv-winbuild'
$nodeZip = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
$nodeRoot = Join-Path $env:TEMP "node-$NodeVersion-win-x64"
$artifactDest = Join-Path $SourceRoot 'release\windows-host'
$localRunDest = Join-Path $env:LOCALAPPDATA 'MDV-Editor\latest'

function Prepare-ArtifactDestination {
  param(
    [string]$PreferredPath
  )

  try {
    if (Test-Path $PreferredPath) {
      Remove-Item $PreferredPath -Recurse -Force
    }

    New-Item -ItemType Directory -Path $PreferredPath | Out-Null
    return $PreferredPath
  } catch {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $fallbackPath = Join-Path (Split-Path $PreferredPath -Parent) "windows-host-$timestamp"
    New-Item -ItemType Directory -Path $fallbackPath | Out-Null
    Write-Warning "Preferred artifact directory is locked. Using $fallbackPath"
    return $fallbackPath
  }
}

function Remove-LocalRunDestination {
  param(
    [string]$TargetPath
  )

  $runningProcesses = Get-Process 'MDV-Editor' -ErrorAction SilentlyContinue
  if ($runningProcesses) {
    $runningProcesses | Stop-Process -Force
    $runningProcesses | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
  }

  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    try {
      if (Test-Path $TargetPath) {
        Remove-Item $TargetPath -Recurse -Force
      }
      return
    } catch {
      if ($attempt -eq 4) {
        throw
      }

      Start-Sleep -Seconds 1
    }
  }
}

if (Test-Path $workRoot) {
  Remove-Item $workRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $workRoot | Out-Null
Write-Host "Prepared temp workspace at $workRoot"

robocopy $SourceRoot $workRoot /MIR /XD node_modules dist release .git > $null
if ($LASTEXITCODE -gt 3) {
  throw "robocopy failed with code $LASTEXITCODE"
}

Write-Host "Copied source from $SourceRoot"

if (-not (Test-Path $nodeRoot)) {
  if (-not (Test-Path $nodeZip)) {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $nodeZip
  }

  Expand-Archive -Path $nodeZip -DestinationPath $env:TEMP -Force
}

$env:Path = "$nodeRoot;$nodeRoot\node_modules\npm\bin;" + $env:Path

Set-Location $workRoot

Write-Host "Installing npm dependencies in $workRoot"
& "$nodeRoot\npm.cmd" install
if ($LASTEXITCODE -ne 0) {
  throw "npm install failed with code $LASTEXITCODE"
}

Write-Host "Building Windows unpacked app"
Write-Host "Building renderer assets"
& "$nodeRoot\npm.cmd" run build
if ($LASTEXITCODE -ne 0) {
  throw "build failed with code $LASTEXITCODE"
}

$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
& "$nodeRoot\npm.cmd" exec electron-builder -- --win --dir --config.win.signAndEditExecutable=false
if ($LASTEXITCODE -ne 0) {
  throw "electron-builder --win --dir failed with code $LASTEXITCODE"
}

$artifactDest = Prepare-ArtifactDestination -PreferredPath $artifactDest

robocopy (Join-Path $workRoot 'release') $artifactDest /E > $null
if ($LASTEXITCODE -gt 3) {
  throw "artifact copy failed with code $LASTEXITCODE"
}

Write-Host "Artifacts copied to $artifactDest"

Remove-LocalRunDestination -TargetPath $localRunDest

New-Item -ItemType Directory -Path $localRunDest | Out-Null

robocopy (Join-Path $artifactDest 'win-unpacked') $localRunDest /E > $null
if ($LASTEXITCODE -gt 3) {
  throw "local runnable copy failed with code $LASTEXITCODE"
}

Write-Host "Runnable local copy updated at $localRunDest"

$localExe = Join-Path $localRunDest 'MDV-Editor.exe'
Write-Host "Run the local Windows copy: $localExe"