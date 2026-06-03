param(
  [string]$SourceRoot,
  [string]$NodeVersion = "v22.22.3",
  [ValidateSet('generate', 'deploy', 'promote')]
  [string]$Action = 'generate',
  [ValidateSet('all', 'portable', 'installer', 'none')]
  [string]$PackageTargets = 'all',
  [ValidateSet('release', 'candidate')]
  [string]$ArtifactSource = 'release',
  [switch]$Clean,
  [switch]$RequireElevation
)

$ErrorActionPreference = 'Stop'

if (-not $SourceRoot) {
  $SourceRoot = Split-Path (Split-Path $PSCommandPath -Parent) -Parent
}

$tempRoot = [System.IO.Path]::GetTempPath().TrimEnd('\')
$workRoot = Join-Path $tempRoot 'mdv-winbuild'
$nodeZip = Join-Path $tempRoot "node-$NodeVersion-win-x64.zip"
$nodeRoot = Join-Path $tempRoot "node-$NodeVersion-win-x64"
$releaseArtifactDest = Join-Path $SourceRoot 'release\windows-host'
$candidateArtifactDest = Join-Path $SourceRoot 'release\windows-host-candidate'
$artifactStageDest = Join-Path $SourceRoot 'release\windows-host-staging'
$artifactBackupDest = Join-Path $SourceRoot 'release\windows-host-backup'
$localRunDest = Join-Path $env:LOCALAPPDATA 'MarkDownViewer\latest'
$localRunStageDest = Join-Path $env:LOCALAPPDATA 'MarkDownViewer\latest-staging'
$localRunBackupDest = Join-Path $env:LOCALAPPDATA 'MarkDownViewer\latest-backup'
$buildStatePath = Join-Path $tempRoot 'mdv-winbuild-state.json'

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
    [string]$ResolvedAction,
    [string]$ResolvedPackageTargets,
    [string]$ResolvedArtifactSource,
    [bool]$ResolvedClean
  )

  $argumentList = @(
    '-NoProfile'
    '-ExecutionPolicy', 'Bypass'
    '-File', ('"{0}"' -f $ScriptPath)
    '-SourceRoot', ('"{0}"' -f $ResolvedSourceRoot)
    '-NodeVersion', ('"{0}"' -f $ResolvedNodeVersion)
    '-Action', ('"{0}"' -f $ResolvedAction)
    '-PackageTargets', ('"{0}"' -f $ResolvedPackageTargets)
    '-ArtifactSource', ('"{0}"' -f $ResolvedArtifactSource)
  )

  if ($ResolvedClean) {
    $argumentList += '-Clean'
  }

  $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argumentList -Wait -PassThru
  exit $process.ExitCode
}

if ($RequireElevation -and -not (Test-IsAdministrator)) {
  Restart-Elevated -ScriptPath $PSCommandPath -ResolvedSourceRoot $SourceRoot -ResolvedNodeVersion $NodeVersion -ResolvedAction $Action -ResolvedPackageTargets $PackageTargets -ResolvedArtifactSource $ArtifactSource -ResolvedClean $Clean.IsPresent
}

function Get-OptionalFileHash {
  param(
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  if (Get-Command 'Get-FileHash' -ErrorAction SilentlyContinue) {
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash
  }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Test-ExternalCommandFailed {
  if (-not $?) {
    return $true
  }

  if ($null -eq $LASTEXITCODE) {
    return $false
  }

  return $LASTEXITCODE -ne 0
}

function Get-DependencyState {
  param(
    [string]$Root,
    [string]$ResolvedNodeVersion
  )

  return @{
    nodeVersion = $ResolvedNodeVersion
    gitmodules = Get-OptionalFileHash (Join-Path $Root '.gitmodules')
    packageJson = Get-OptionalFileHash (Join-Path $Root 'package.json')
    packageLockJson = Get-OptionalFileHash (Join-Path $Root 'package-lock.json')
    mdastPackageJson = Get-OptionalFileHash (Join-Path $Root 'vendor\mdast-control\package.json')
    mdastPackageLockJson = Get-OptionalFileHash (Join-Path $Root 'vendor\mdast-control\package-lock.json')
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
    [string]$StatePath,
    [string]$ResolvedNodeVersion
  )

  if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    return $true
  }

  $previousState = Read-BuildState -StatePath $StatePath
  if (-not $previousState -or -not $previousState.dependencies) {
    return $true
  }

  $currentState = Get-DependencyState -Root $Root -ResolvedNodeVersion $ResolvedNodeVersion
  return $previousState.dependencies.nodeVersion -ne $currentState.nodeVersion -or $previousState.dependencies.gitmodules -ne $currentState.gitmodules -or $previousState.dependencies.packageJson -ne $currentState.packageJson -or $previousState.dependencies.packageLockJson -ne $currentState.packageLockJson -or $previousState.dependencies.mdastPackageJson -ne $currentState.mdastPackageJson -or $previousState.dependencies.mdastPackageLockJson -ne $currentState.mdastPackageLockJson
}

function Prepare-ArtifactDestination {
  param(
    [string]$PreferredPath
  )

  if (Test-Path $PreferredPath) {
    Remove-DirectoryWithRetry -TargetPath $PreferredPath
  }

  New-Item -ItemType Directory -Path $PreferredPath | Out-Null
  return $PreferredPath
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

function Stop-MarkDownViewerProcess {
  $runningProcesses = Get-Process 'MarkDownViewer' -ErrorAction SilentlyContinue
  if ($runningProcesses) {
    $runningProcesses | Stop-Process -Force
    $runningProcesses | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
  }
}

function Sync-Directory {
  param(
    [string]$SourcePath,
    [string]$DestinationPath,
    [string]$Mode = '/MIR',
    [string]$ErrorLabel
  )

  robocopy $SourcePath $DestinationPath $Mode > $null
  if ($LASTEXITCODE -gt 3) {
    throw "$ErrorLabel failed with code $LASTEXITCODE"
  }
}

function Get-ArtifactDirectory {
  param(
    [string]$Kind
  )

  switch ($Kind) {
    'release' {
      return $releaseArtifactDest
    }
    'candidate' {
      return $candidateArtifactDest
    }
    default {
      throw "Unsupported artifact source: $Kind"
    }
  }
}

function Read-PackageVersion {
  $packageJsonPath = Join-Path $SourceRoot 'package.json'
  $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json

  if (-not $packageJson.version) {
    throw "package.json at $packageJsonPath does not contain a version"
  }

  return [string]$packageJson.version
}

function Write-ArtifactMetadata {
  param(
    [string]$ArtifactRoot,
    [ValidateSet('release', 'candidate')]
    [string]$ArtifactSource
  )

  $version = Read-PackageVersion
  $versionedExeName = "MarkDownViewer-$version-win.exe"
  $metadataPath = Join-Path $ArtifactRoot 'artifact-metadata.json'
  $metadata = [ordered]@{
    productName = 'MarkDownViewer'
    version = $version
    releaseTag = "v$version"
    artifactSource = $ArtifactSource
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    artifacts = [ordered]@{
      portableExe = "portable/$versionedExeName"
      installerExe = "installer/$versionedExeName"
      installerBlockmap = "installer/$versionedExeName.blockmap"
      updaterManifest = 'installer/latest.yml'
      winUnpackedExe = 'win-unpacked/MarkDownViewer.exe'
      appArchive = 'win-unpacked/resources/app.asar'
    }
  }

  $metadataJson = ($metadata | ConvertTo-Json -Depth 4) + "`n"
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($metadataPath, $metadataJson, $utf8NoBom)
}

function Write-UpdateManifest {
  param(
    [ValidateSet('release', 'candidate')]
    [string]$ArtifactSource
  )

  $scriptPath = Join-Path $workRoot 'scripts\write-windows-update-manifest.mjs'
  & "$nodeRoot\node.exe" $scriptPath --root $SourceRoot --artifact-source $ArtifactSource
  if (Test-ExternalCommandFailed) {
    throw "write-windows-update-manifest failed with code $LASTEXITCODE"
  }
}

function Assert-PromotableCandidateArtifacts {
  $version = Read-PackageVersion
  $versionedExeName = "MarkDownViewer-$version-win.exe"
  $requiredPaths = @(
    (Join-Path $candidateArtifactDest "portable\$versionedExeName"),
    (Join-Path $candidateArtifactDest "installer\$versionedExeName"),
    (Join-Path $candidateArtifactDest "installer\$versionedExeName.blockmap"),
    (Join-Path $candidateArtifactDest 'installer\latest.yml'),
    (Join-Path $candidateArtifactDest 'win-unpacked\MarkDownViewer.exe'),
    (Join-Path $candidateArtifactDest 'win-unpacked\resources\app.asar'),
    (Join-Path $candidateArtifactDest 'artifact-metadata.json')
  )

  $missingPaths = @($requiredPaths | Where-Object { -not (Test-Path $_) })
  if ($missingPaths.Count -gt 0) {
    throw "Candidate artifacts are incomplete for promotion:`n$($missingPaths -join "`n")"
  }
}

function Update-LocalRunnableCopy {
  param(
    [string]$ArtifactRoot
  )

  $unpackedSource = Join-Path $ArtifactRoot 'win-unpacked'
  if (-not (Test-Path $unpackedSource)) {
    throw "win-unpacked executable is missing at $unpackedSource"
  }

  Ensure-Directory -TargetPath (Split-Path $localRunStageDest -Parent)
  if (Test-Path $localRunStageDest) {
    Remove-DirectoryWithRetry -TargetPath $localRunStageDest
  }

  Sync-Directory -SourcePath $unpackedSource -DestinationPath $localRunStageDest -ErrorLabel 'local runnable staging'

  Stop-MarkDownViewerProcess

  $localSwap = $null
  try {
    $localSwap = Swap-StagedDirectory -StagePath $localRunStageDest -LivePath $localRunDest -BackupPath $localRunBackupDest
  } catch {
    Restore-SwappedDirectory -SwapResult $localSwap
    throw
  }

  Finalize-SwappedDirectory -SwapResult $localSwap
  Write-Host "Runnable local copy updated at $localRunDest"
  Write-Host "Run the local Windows copy: $localRunDest\MarkDownViewer.exe"
}

function Promote-CandidateArtifacts {
  if (-not (Test-Path $candidateArtifactDest)) {
    throw "Candidate artifacts do not exist at $candidateArtifactDest"
  }

  Assert-PromotableCandidateArtifacts

  Ensure-Directory -TargetPath (Split-Path $artifactStageDest -Parent)
  if (Test-Path $artifactStageDest) {
    Remove-DirectoryWithRetry -TargetPath $artifactStageDest
  }

  Sync-Directory -SourcePath $candidateArtifactDest -DestinationPath $artifactStageDest -ErrorLabel 'artifact staging'
  Write-ArtifactMetadata -ArtifactRoot $artifactStageDest -ArtifactSource 'release'

  $artifactSwap = $null
  try {
    $artifactSwap = Swap-StagedDirectory -StagePath $artifactStageDest -LivePath $releaseArtifactDest -BackupPath $artifactBackupDest
  } catch {
    Restore-SwappedDirectory -SwapResult $artifactSwap
    throw
  }

  Finalize-SwappedDirectory -SwapResult $artifactSwap
  Write-Host "Canonical release artifacts updated at $releaseArtifactDest"
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

function Validate-ActionArguments {
  if ($Action -eq 'generate') {
    if ($ArtifactSource -ne 'release') {
      throw 'ArtifactSource is only supported for deploy.'
    }

    return
  }

  if ($Clean) {
    throw 'Clean is only supported for generate.'
  }

  if ($PackageTargets -ne 'all') {
    throw 'PackageTargets is only supported for generate.'
  }

  if ($Action -eq 'promote' -and $ArtifactSource -ne 'release') {
    throw 'ArtifactSource is only supported for deploy.'
  }
}

Validate-ActionArguments

if ($Action -eq 'deploy') {
  $artifactRoot = Get-ArtifactDirectory -Kind $ArtifactSource
  if (-not (Test-Path $artifactRoot)) {
    throw "Artifact source does not exist: $artifactRoot"
  }

  Update-LocalRunnableCopy -ArtifactRoot $artifactRoot
  exit 0
}

if ($Action -eq 'promote') {
  Promote-CandidateArtifacts
  exit 0
}

if ($Clean -and (Test-Path $workRoot)) {
  Remove-Item $workRoot -Recurse -Force
}

Ensure-Directory -TargetPath $workRoot
Write-Host "Prepared temp workspace at $workRoot (action: $Action)"

robocopy $SourceRoot $workRoot /MIR /XD node_modules dist release .git > $null
if ($LASTEXITCODE -gt 3) {
  throw "robocopy failed with code $LASTEXITCODE"
}

$sourceBuildResources = Join-Path $SourceRoot 'build'
$workBuildResources = Join-Path $workRoot 'build'
if (Test-Path $sourceBuildResources) {
  Sync-Directory -SourcePath $sourceBuildResources -DestinationPath $workBuildResources -ErrorLabel 'build resource copy'
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

$mdastPackageJson = Join-Path $workRoot 'vendor\mdast-control\package.json'
if (-not (Test-Path $mdastPackageJson)) {
  throw "mdast-control submodule is not initialized in the source tree. Run 'git submodule update --init --recursive vendor/mdast-control' before Windows host packaging."
}

if (Test-DependenciesNeedInstall -Root $workRoot -StatePath $buildStatePath -ResolvedNodeVersion $NodeVersion) {
  if (Test-Path $buildStatePath) {
    Remove-Item $buildStatePath -Force
  }

  Write-Host "Installing npm dependencies in $workRoot"
  $env:MDV_SKIP_MDAST_POSTINSTALL = '1'
  & "$nodeRoot\npm.cmd" install
  $env:MDV_SKIP_MDAST_POSTINSTALL = $null
  if (Test-ExternalCommandFailed) {
    throw "npm install failed with code $LASTEXITCODE"
  }

  Write-BuildState -StatePath $buildStatePath -DependencyState (Get-DependencyState -Root $workRoot -ResolvedNodeVersion $NodeVersion)
} else {
  Write-Host "Reusing existing npm dependencies in $workRoot"
}

$mdastNodeModules = Join-Path $workRoot 'vendor\mdast-control\node_modules'
$mdastInstallState = Join-Path $mdastNodeModules '.mdv-install-state.json'
if ((-not (Test-Path $mdastNodeModules)) -or (-not (Test-Path $mdastInstallState)) -or (Test-DependenciesNeedInstall -Root $workRoot -StatePath $buildStatePath -ResolvedNodeVersion $NodeVersion)) {
  Write-Host "Installing mdast submodule dependencies in $workRoot\vendor\mdast-control"
  & "$nodeRoot\node.exe" (Join-Path $workRoot 'scripts\mdast-submodule.mjs') install
  if (Test-ExternalCommandFailed) {
    throw "mdast install failed with code $LASTEXITCODE"
  }
}

Write-Host 'Building Windows unpacked app'
Write-Host 'Building renderer assets'
& "$nodeRoot\npm.cmd" run build
if (Test-ExternalCommandFailed) {
  throw "build failed with code $LASTEXITCODE"
}

$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
& "$nodeRoot\npm.cmd" exec electron-builder -- --win --dir --config.win.signAndEditExecutable=false
if (Test-ExternalCommandFailed) {
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
if (Test-ExternalCommandFailed) {
  throw "rcedit failed with code $LASTEXITCODE"
}

$prepackagedPath = Join-Path $workRoot 'release\win-unpacked'
foreach ($plan in (Get-PackageBuildPlans -RequestedTargets $PackageTargets)) {
  Write-Host "Building Windows $($plan.label)"
  & "$nodeRoot\npm.cmd" exec electron-builder -- --prepackaged $prepackagedPath --win $plan.target "--config.directories.output=$($plan.output)" --config.win.signAndEditExecutable=false
  if (Test-ExternalCommandFailed) {
    throw "electron-builder --prepackaged --win $($plan.target) failed with code $LASTEXITCODE"
  }
}

$candidateOutputPath = Prepare-ArtifactDestination -PreferredPath $candidateArtifactDest
Sync-Directory -SourcePath (Join-Path $workRoot 'release') -DestinationPath $candidateOutputPath -Mode '/E' -ErrorLabel 'candidate artifact copy'

if ($PackageTargets -eq 'all') {
  Write-UpdateManifest -ArtifactSource 'candidate'
  Write-ArtifactMetadata -ArtifactRoot $candidateOutputPath -ArtifactSource 'candidate'
}

Write-Host "Candidate artifacts copied to $candidateOutputPath"
Write-Host 'Use deploy to refresh the local runnable copy or promote to replace canonical release artifacts.'