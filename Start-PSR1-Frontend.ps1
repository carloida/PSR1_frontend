$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 5175
$Url = "http://127.0.0.1:$Port/"
$Npm = (Get-Command npm.cmd -ErrorAction Stop).Source

Set-Location $Root

if (-not (Test-Path -LiteralPath (Join-Path $Root "node_modules"))) {
  & $Npm install
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
