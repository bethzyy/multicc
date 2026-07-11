# multicc 每日全量回归测试（由 Windows 任务计划程序每天 17:30 调用）
# 绿了安静；红了通过工作区 notify.py 弹通知。日志写在 %LOCALAPPDATA%\multicc\nightly-test.log（不进仓库）。
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot

$logDir = Join-Path $env:LOCALAPPDATA 'multicc'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }
$log = Join-Path $logDir 'nightly-test.log'

Set-Location $repo
"===== nightly test $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') =====" | Out-File $log -Encoding utf8
cmd /c "npm test 2>&1" | Out-File $log -Append -Encoding utf8
$failed = $LASTEXITCODE -ne 0
"exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

if ($failed) {
  $notify = Join-Path (Split-Path -Parent $repo) '.claude\scripts\notify.py'
  $python = "$env:LOCALAPPDATA\Microsoft\WindowsApps\python.exe"
  if (-not (Test-Path $python)) { $python = 'python' }
  if (Test-Path $notify) {
    & $python $notify "【multicc 测试失败】每日回归红了，日志: $log"
  }
}
