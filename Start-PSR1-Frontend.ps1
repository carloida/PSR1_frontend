$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 5175
$ApiPort = 8002
$Url = "http://127.0.0.1:$Port/"
$Npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$BackendRoot = Resolve-Path -LiteralPath (Join-Path $Root "..\psr-fdc-dashboard\backend") -ErrorAction SilentlyContinue

Set-Location $Root

if (-not (Test-Path -LiteralPath (Join-Path $Root "node_modules"))) {
  & $Npm install
}

$apiListener = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
if (-not $apiListener -and $BackendRoot) {
  $backendPython = Join-Path $BackendRoot.Path ".venv\Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $backendPython)) {
    $backendPython = (Get-Command python.exe -ErrorAction Stop).Source
  }

  Start-Process -FilePath $backendPython `
    -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "$ApiPort") `
    -WorkingDirectory $BackendRoot.Path `
    -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  $outLog = Join-Path $Root "vite-5175.out.log"
  $errLog = Join-Path $Root "vite-5175.err.log"
  Start-Process -FilePath $Npm `
    -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$Port") `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

Start-Process $Url
