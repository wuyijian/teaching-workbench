# ─────────────────────────────────────────────────────────────────────
# 本地一键发版脚本（Windows PowerShell）
# 流程：smoke → build:web → scp 到服务器 → reload nginx
# 用法（在仓库根目录执行）：
#   $env:DEPLOY_HOST="your-domain.com"   # 或服务器 IP
#   $env:DEPLOY_USER="root"              # 默认 root
#   $env:DEPLOY_PATH="/var/www/teaching-workbench"  # 默认值
#   .\deploy\deploy.ps1
#
# 前置：Win10/11 自带 OpenSSH（ssh / scp 命令开箱即用）
# ─────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'

function Log    ($m) { Write-Host "▶ $m" -ForegroundColor Green }
function Warn   ($m) { Write-Host "⚠ $m" -ForegroundColor Yellow }
function Die    ($m) { Write-Host "✗ $m" -ForegroundColor Red; exit 1 }

$Host_     = if ($env:DEPLOY_HOST) { $env:DEPLOY_HOST } else { 'yixiaojian.top' }
$User      = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { 'root' }
$RemotePath= if ($env:DEPLOY_PATH) { $env:DEPLOY_PATH } else { '/var/www/teaching-workbench' }
$SkipSmoke = $env:SKIP_SMOKE -eq '1'

if (-not $Host_) {
    Die "请设置 `$env:DEPLOY_HOST 或修改脚本默认域名"
}

# 切到仓库根目录
Set-Location (Join-Path $PSScriptRoot '..')
Log "工作目录：$(Get-Location)"

if (-not $SkipSmoke) {
    Log "[1/3] 烟测：tsc + 讯飞 + LLM"
    npm run smoke
    if ($LASTEXITCODE -ne 0) { Die "smoke 失败，发版中止（如要跳过：`$env:SKIP_SMOKE='1'`）" }
} else {
    Warn "[1/3] 已跳过 smoke (SKIP_SMOKE=1)"
}

Log "[2/3] 构建 Web 产物"
npm run build:web
if ($LASTEXITCODE -ne 0) { Die "构建失败" }
if (-not (Test-Path 'dist')) { Die "dist/ 不存在" }

Log "[3/3] 上传 dist/ 到 ${User}@${Host_}:${RemotePath}"
# Windows 不带 rsync，用 scp -r 上传；先在服务器清空旧目录避免残留
ssh "${User}@${Host_}" "mkdir -p '$RemotePath' && find '$RemotePath' -mindepth 1 -delete"
if ($LASTEXITCODE -ne 0) { Die "无法连接服务器或清理旧文件失败（请检查 SSH 密钥）" }

scp -r ./dist/* "${User}@${Host_}:${RemotePath}/"
if ($LASTEXITCODE -ne 0) { Die "scp 上传失败" }

Log "重载 Nginx"
ssh "${User}@${Host_}" "nginx -t && systemctl reload nginx"
if ($LASTEXITCODE -ne 0) { Warn "重载失败，请手动登录服务器执行 nginx -s reload" }

Log "✓ 发版完成 ─ https://${Host_}"
