param(
  [string]$SourceRoot,
  [string]$NodeVersion = "v22.22.3",
  [ValidateSet('full', 'diff')]
  [string]$Mode = 'full',
  [ValidateSet('all', 'portable', 'installer', 'none')]
  [string]$PackageTargets = 'all',
  [switch]$RequireElevation
)

$ErrorActionPreference = 'Stop'

if (-not $SourceRoot) {
  $SourceRoot = Split-Path (Split-Path $PSCommandPath -Parent) -Parent
}

$tempRoot = [System.IO.Path]::GetTempPath().TrimEnd('\')

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-Elevated {
  param(
    [string]$ScriptPath,
    [string]$ResolvedSourceRoot,
    [string]$ResolvedNodeVersion,
    [string]$ResolvedMode,
    [string]$ResolvedPackageTargets
  )

  $argumentList = @(
    '-NoProfile'
    '-ExecutionPolicy', 'Bypass'
    '-File', ('"{0}"' -f $ScriptPath)
    '-SourceRoot', ('"{0}"' -f $ResolvedSourceRoot)
    '-NodeVersion', ('"{0}"' -f $ResolvedNodeVersion)
    '-Mode', ('"{0}"' -f $ResolvedMode)
    '-PackageTargets', ('"{0}"' -f $ResolvedPackageTargets)
  )

  $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argumentList -Wait -PassThru
  exit $process.ExitCode
}

if ($RequireElevation -and -not (Test-IsAdministrator)) {
  Restart-Elevated -ScriptPath $PSCommandPath -ResolvedSourceRoot $SourceRoot -ResolvedNodeVersion $NodeVersion -ResolvedMode $Mode -ResolvedPackageTargets $PackageTargets
}

$workRoot = Join-Path $tempRoot 'mdv-winbuild'
$nodeZip = Join-Path $tempRoot "node-$NodeVersion-win-x64.zip"
$nodeRoot = Join-Path $tempRoot "node-$NodeVersion-win-x64"
$artifactDest = Join-Path $SourceRoot 'release\windows-host'
$artifactStageDest = Join-Path $SourceRoot 'release\windows-host-staging'
$artifactBackupDest = Join-Path $SourceRoot 'release\windows-host-backup'
$localRunDest = Join-Path $env:LOCALAPPDATA 'MarkDownViewer\latest'
$localRunStageDest = Join-Path $env:LOCALAPPDATA 'MarkDownViewer\latest-staging'
$localRunBackupDest = Join-Path $env:LOCALAPPDATA 'MarkDownViewer\latest-backup'
$buildStatePath = Join-Path $tempRoot 'mdv-winbuild-state.json'

function Get-OptionalFileHash {
  param(
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  return (Get-FileHash -Path $Path -Algorithm SHA256).Hash
}

function Get-DependencyState {
  param(
    [string]$Root,
    [string]$ResolvedNodeVersion
  )

  return @{
    nodeVersion = $ResolvedNodeVersion
    packageJson = Get-OptionalFileHash (Join-Path $Root 'package.json')
    packageLockJson = Get-OptionalFileHash (Join-Path $Root 'package-lock.json')
  }
}

function Read-BuildState {
  param(
    [string]$StatePath
  )

  if (-not (Test-Path $StatePath)) {
    return $null
  }

  try {
    return (Get-Content $StatePath -Raw | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Write-BuildState {
  param(
    [string]$StatePath,
    [hashtable]$DependencyState
  )

  @{
    dependencies = $DependencyState
  } | ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8
}

function Test-DependenciesNeedInstall {
  param(
    [string]$Root,
    [string]$RequestedMode,
    [string]$StatePath,
    [string]$ResolvedNodeVersion
  )

  if ($RequestedMode -eq 'full') {
    return $true
  }

  if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    return $true
  }

  $previousState = Read-BuildState -StatePath $StatePath
  if (-not $previousState -or -not $previousState.dependencies) {
    return $true
  }

  $currentState = Get-DependencyState -Root $Root -ResolvedNodeVersion $ResolvedNodeVersion
  return $previousState.dependencies.nodeVersion -ne $currentState.nodeVersion -or $previousState.dependencies.packageJson -ne $currentState.packageJson -or $previousState.dependencies.packageLockJson -ne $currentState.packageLockJson
}

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

function Ensure-Directory {
  param(
    [string]$TargetPath
  )

  if (-not (Test-Path $TargetPath)) {
    New-Item -ItemType Directory -Path $TargetPath | Out-Null
  }
}

function Remove-DirectoryWithRetry {
  param(
    [string]$TargetPath
  )

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

function Swap-StagedDirectory {
  param(
    [string]$StagePath,
    [string]$LivePath,
    [string]$BackupPath
  )

  if (-not (Test-Path $StagePath)) {
    throw "Stage path does not exist: $StagePath"
  }

  if (Test-Path $BackupPath) {
    Remove-DirectoryWithRetry -TargetPath $BackupPath
  }

  $liveExisted = Test-Path $LivePath

  try {
    if ($liveExisted) {
      Rename-Item -Path $LivePath -NewName (Split-Path $BackupPath -Leaf)
    }

    Rename-Item -Path $StagePath -NewName (Split-Path $LivePath -Leaf)

    return @{
      livePath = $LivePath
      backupPath = if ($liveExisted) { $BackupPath } else { $null }
    }
  } catch {
    if ((-not (Test-Path $LivePath)) -and (Test-Path $BackupPath)) {
      Rename-Item -Path $BackupPath -NewName (Split-Path $LivePath -Leaf)
    }

    throw
  }
}

function Finalize-SwappedDirectory {
  param(
    [hashtable]$SwapResult
  )

  if ($SwapResult -and $SwapResult.backupPath -and (Test-Path $SwapResult.backupPath)) {
    Remove-DirectoryWithRetry -TargetPath $SwapResult.backupPath
  }
}

function Restore-SwappedDirectory {
  param(
    [hashtable]$SwapResult
  )

  if (-not $SwapResult -or -not $SwapResult.backupPath) {
    return
  }

  if (Test-Path $SwapResult.livePath) {
    Remove-DirectoryWithRetry -TargetPath $SwapResult.livePath
  }

  if (Test-Path $SwapResult.backupPath) {
    Rename-Item -Path $SwapResult.backupPath -NewName (Split-Path $SwapResult.livePath -Leaf)
  }
}

function Remove-LocalRunDestination {
  param(
    [string]$TargetPath
  )

  Stop-MarkDownViewerProcess

  Remove-DirectoryWithRetry -TargetPath $TargetPath
}

function Stop-MarkDownViewerProcess {
  $runningProcesses = Get-Process 'MarkDownViewer' -ErrorAction SilentlyContinue
  if ($runningProcesses) {
    $runningProcesses | Stop-Process -Force
    $runningProcesses | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
  }
}

function Get-PackageBuildPlans {
  param(
    [string]$RequestedTargets
  )

  switch ($RequestedTargets) {
    'portable' {
      return @(@{
        target = 'portable'
        output = 'release\portable'
        label = 'portable package'
      })
    }
    'installer' {
      return @(@{
        target = 'nsis'
        output = 'release\installer'
        label = 'installer package'
      })
    }
    'all' {
      return @(
        @{
          target = 'portable'
          output = 'release\portable'
          label = 'portable package'
        },
        @{
          target = 'nsis'
          output = 'release\installer'
          label = 'installer package'
        }
      )
    }
    default {
      return @()
    }
  }
}

function Clear-PackageOutputDirectories {
  param(
    [string]$Root
  )

  foreach ($relativePath in @('release\portable', 'release\installer')) {
    $targetPath = Join-Path $Root $relativePath
    if (Test-Path $targetPath) {
      Remove-DirectoryWithRetry -TargetPath $targetPath
    }
  }
}

if ($Mode -eq 'full' -and (Test-Path $workRoot)) {
  Remove-Item $workRoot -Recurse -Force
}

Ensure-Directory -TargetPath $workRoot
Write-Host "Prepared temp workspace at $workRoot (mode: $Mode)"

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
Clear-PackageOutputDirectories -Root $workRoot

if (Test-DependenciesNeedInstall -Root $workRoot -RequestedMode $Mode -StatePath $buildStatePath -ResolvedNodeVersion $NodeVersion) {
  if (Test-Path $buildStatePath) {
    Remove-Item $buildStatePath -Force
  }

  Write-Host "Installing npm dependencies in $workRoot"
  & "$nodeRoot\npm.cmd" install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with code $LASTEXITCODE"
  }

  Write-BuildState -StatePath $buildStatePath -DependencyState (Get-DependencyState -Root $workRoot -ResolvedNodeVersion $NodeVersion)
} else {
  Write-Host "Reusing existing npm dependencies in $workRoot"
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

$builtExe = Join-Path $workRoot 'release\win-unpacked\MarkDownViewer.exe'
$iconPath = Join-Path $workRoot 'build\icon.ico'
$rceditScriptPath = Join-Path $workRoot 'apply-rcedit.mjs'
@"
import { rcedit } from 'rcedit'

const [exePath, iconPath] = process.argv.slice(2)

await rcedit(exePath, {
  icon: iconPath,
  'version-string': {
    ProductName: 'MarkDownViewer',
    FileDescription: 'MarkDownViewer',
    InternalName: 'MarkDownViewer',
    OriginalFilename: 'MarkDownViewer.exe',
  },
})
"@ | Set-Content -Path $rceditScriptPath -Encoding UTF8

& "$nodeRoot\node.exe" $rceditScriptPath $builtExe $iconPath
if ($LASTEXITCODE -ne 0) {
  throw "rcedit failed with code $LASTEXITCODE"
}

$prepackagedPath = Join-Path $workRoot 'release\win-unpacked'
foreach ($plan in (Get-PackageBuildPlans -RequestedTargets $PackageTargets)) {
  Write-Host "Building Windows $($plan.label)"
  & "$nodeRoot\npm.cmd" exec electron-builder -- --prepackaged $prepackagedPath --win $plan.target "--config.directories.output=$($plan.output)" --config.win.signAndEditExecutable=false
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder --prepackaged --win $($plan.target) failed with code $LASTEXITCODE"
  }
}

if ($Mode -eq 'full') {
  $artifactDest = Prepare-ArtifactDestination -PreferredPath $artifactDest

  robocopy (Join-Path $workRoot 'release') $artifactDest /E > $null
  if ($LASTEXITCODE -gt 3) {
    throw "artifact copy failed with code $LASTEXITCODE"
  }
} else {
  Ensure-Directory -TargetPath (Split-Path $artifactStageDest -Parent)
  robocopy (Join-Path $workRoot 'release') $artifactStageDest /MIR > $null
  if ($LASTEXITCODE -gt 3) {
    throw "artifact staging failed with code $LASTEXITCODE"
  }

  Ensure-Directory -TargetPath (Split-Path $localRunStageDest -Parent)
  robocopy (Join-Path $workRoot 'release\win-unpacked') $localRunStageDest /MIR > $null
  if ($LASTEXITCODE -gt 3) {
    throw "local runnable staging failed with code $LASTEXITCODE"
  }

  Stop-MarkDownViewerProcess

  $artifactSwap = $null
  $localSwap = $null

  try {
    $artifactSwap = Swap-StagedDirectory -StagePath $artifactStageDest -LivePath $artifactDest -BackupPath $artifactBackupDest
    $localSwap = Swap-StagedDirectory -StagePath $localRunStageDest -LivePath $localRunDest -BackupPath $localRunBackupDest
  } catch {
    Restore-SwappedDirectory -SwapResult $localSwap
    Restore-SwappedDirectory -SwapResult $artifactSwap
    throw
  }

  Finalize-SwappedDirectory -SwapResult $localSwap
  Finalize-SwappedDirectory -SwapResult $artifactSwap
}

Write-Host "Artifacts copied to $artifactDest"

if ($Mode -eq 'full') {
  Remove-LocalRunDestination -TargetPath $localRunDest
  New-Item -ItemType Directory -Path $localRunDest | Out-Null
  robocopy (Join-Path $artifactDest 'win-unpacked') $localRunDest /E > $null
  if ($LASTEXITCODE -gt 3) {
    throw "local runnable copy failed with code $LASTEXITCODE"
  }
}

Write-Host "Runnable local copy updated at $localRunDest"

$localExe = Join-Path $localRunDest 'MarkDownViewer.exe'
Write-Host "Run the local Windows copy: $localExe"