param(
  [string]$Tag = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [string]$Image = 'comhub-app-export',
  [string]$NodeVersion = '24.18.0',
  [switch]$NoCnMirror
)

$ErrorActionPreference = 'Stop'

$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dist = Join-Path $repo 'dist-deploy'
$packageName = "comhub-$Tag-app"
$exportDir = Join-Path $dist $packageName
$tarName = "$packageName.tar.gz"
$tarPath = Join-Path $dist $tarName
$imageTag = "${Image}:$Tag"
$container = "comhub-export-$Tag"

function Remove-DockerContainerIfExists {
  param([string]$Name)

  $existing = docker ps -a --filter "name=^/$Name$" --format '{{.ID}}'
  if ($existing) {
    docker rm -f $Name | Out-Null
  }
}

function Assert-UnderPath {
  param([string]$Path, [string]$Parent)

  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent)
  if (!$resolvedPath.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside $resolvedParent`: $resolvedPath"
  }
}

Push-Location $repo
try {
  $dockerOs = docker info --format '{{.OSType}} {{.Architecture}}'
  if ($dockerOs -notmatch '^linux ') {
    throw "Docker must be using a Linux engine. Current: $dockerOs"
  }

  $mirror = if ($NoCnMirror) { 'false' } else { 'true' }

  docker build `
    --target app `
    --build-arg NODEJS_VERSION=$NodeVersion `
    --build-arg USE_CN_MIRROR=$mirror `
    -t $imageTag .

  if (!(Test-Path $dist)) {
    New-Item -ItemType Directory -Path $dist | Out-Null
  }

  if (Test-Path $exportDir) {
    Assert-UnderPath -Path $exportDir -Parent $dist
    Remove-Item -LiteralPath $exportDir -Recurse -Force
  }
  if (Test-Path $tarPath) {
    Assert-UnderPath -Path $tarPath -Parent $dist
    Remove-Item -LiteralPath $tarPath -Force
  }

  Remove-DockerContainerIfExists -Name $container
  docker create --name $container $imageTag | Out-Null
  docker cp "${container}:/app" $exportDir
  docker rm $container | Out-Null

  $manifest = Join-Path $exportDir '.next\server\app-paths-manifest.json'
  if (!(Test-Path $manifest)) {
    throw "Missing app route manifest: $manifest"
  }

  $manifestText = Get-Content $manifest -Raw
  foreach ($needle in @(
      'spa/[variants]/[[...path]]/route',
      '[variants]/(auth)/signin/page',
      '(backend)/api/version/route',
      '(backend)/trpc/lambda/[trpc]/route'
    )) {
    if (!$manifestText.Contains($needle)) {
      throw "Build artifact route manifest is incomplete. Missing: $needle"
    }
  }

  $wslDist = wsl wslpath -a ($dist -replace '\\', '/')
  wsl -e bash -lc "set -e; cd '$wslDist'; tar --numeric-owner -czf '$tarName' -C '$packageName' .; ls -lh '$tarName'"

  Write-Host ""
  Write-Host "Package ready: $tarPath"
  Write-Host "Remote upload target: /tmp/$tarName"
}
finally {
  Remove-DockerContainerIfExists -Name $container
  Pop-Location
}
