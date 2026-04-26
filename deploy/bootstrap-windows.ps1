# ─────────────────────────────────────────────────────────────────────
# 本机一键准备脚本（Windows PowerShell）
#
# 这一段会做：
#   1. 生成专用部署 SSH 密钥（~/.ssh/teaching-workbench-deploy）
#   2. 把公钥推到服务器 root@121.40.150.120 的 authorized_keys
#   3. 抓服务器 host key 写入 known_hosts，并打印"GitHub Secret 用值"
#   4. 把 deploy/ 整个目录 scp 上去
#   5. 提示你 SSH 进去跑 server-init.sh
#
# 跑之前你必须有 root@121.40.150.120 的密码（首次推公钥要用）
#
# 用法（在仓库根目录）：
#   .\deploy\bootstrap-windows.ps1
# ─────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'

function Log  ($m) { Write-Host "▶ $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "⚠ $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "✗ $m" -ForegroundColor Red; exit 1 }

# ────────── 配置（已固化）──────────
$SERVER_IP   = '121.40.150.120'
$SERVER_USER = 'root'
$DOMAIN      = 'yixiaojian.top'
$KEY_NAME    = 'teaching-workbench-deploy'
$KEY_PATH    = Join-Path $HOME ".ssh\$KEY_NAME"
# ────────────────────────────────────

# 切到仓库根
Set-Location (Join-Path $PSScriptRoot '..')
Log "仓库目录：$(Get-Location)"

# ─── 1. 生成密钥 ───
if (Test-Path $KEY_PATH) {
    Warn "密钥已存在：$KEY_PATH，跳过生成"
} else {
    Log "[1/5] 生成 ed25519 部署密钥到 $KEY_PATH"
    if (-not (Test-Path (Join-Path $HOME '.ssh'))) { New-Item -ItemType Directory -Path (Join-Path $HOME '.ssh') | Out-Null }
    & ssh-keygen -t ed25519 -f $KEY_PATH -C "github-actions@$DOMAIN" -N '""'
    if ($LASTEXITCODE -ne 0) { Die "ssh-keygen 失败" }
}

$pubKey = Get-Content "$KEY_PATH.pub" -Raw

# ─── 2. 推公钥（需要你输入 root 密码，仅这一次）───
Log "[2/5] 把公钥推到 $SERVER_USER@$SERVER_IP（接下来会让你输入 root 密码，仅这一次）"
$cmd = @"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
grep -qF '$($pubKey.Trim())' ~/.ssh/authorized_keys 2>/dev/null || echo '$($pubKey.Trim())' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
"@
ssh "$SERVER_USER@$SERVER_IP" $cmd
if ($LASTEXITCODE -ne 0) { Die "推送公钥失败（密码错？或服务器 22 端口不通？）" }

# ─── 3. 抓 known_hosts ───
Log "[3/5] 抓服务器 host key"
$knownHosts = & ssh-keyscan -H -T 10 $SERVER_IP $DOMAIN "www.$DOMAIN" 2>$null
$knownPath = Join-Path $HOME ".ssh\known_hosts"
if (-not (Test-Path $knownPath)) { New-Item -ItemType File -Path $knownPath | Out-Null }
foreach ($line in $knownHosts) {
    if ($line -and -not (Select-String -Path $knownPath -Pattern ([regex]::Escape($line)) -Quiet -ErrorAction SilentlyContinue)) {
        Add-Content -Path $knownPath -Value $line
    }
}

# ─── 4. 验证免密登录 ───
Log "[4/5] 用新密钥免密登录验证"
& ssh -i $KEY_PATH -o StrictHostKeyChecking=no -o BatchMode=yes "$SERVER_USER@$SERVER_IP" 'echo ok'
if ($LASTEXITCODE -ne 0) { Die "免密登录失败，请人工排查" }

# ─── 5. 把 deploy/ 推到服务器 ───
Log "[5/5] 上传 deploy/ 到服务器 /root/deploy/"
& scp -i $KEY_PATH -r ./deploy "${SERVER_USER}@${SERVER_IP}:/root/"
if ($LASTEXITCODE -ne 0) { Die "scp 上传失败" }

# ─── 输出 GitHub Secret 用值 ───
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " GitHub Secrets 配置（仓库 → Settings → Secrets → Actions）" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "DEPLOY_HOST" -ForegroundColor Yellow
Write-Host $DOMAIN
Write-Host ""
Write-Host "DEPLOY_USER" -ForegroundColor Yellow
Write-Host $SERVER_USER
Write-Host ""
Write-Host "DEPLOY_SSH_KEY  ── 私钥全文（含首尾两行）" -ForegroundColor Yellow
Write-Host (Get-Content $KEY_PATH -Raw)
Write-Host ""
Write-Host "DEPLOY_KNOWN_HOSTS" -ForegroundColor Yellow
$knownHosts -join "`n" | Write-Host
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Log "本机准备完成"
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "  1. 上面 4 个值贴到 GitHub Secrets" -ForegroundColor Gray
Write-Host "  2. 还需配前端构建 Secrets：VITE_SUPABASE_URL / _ANON_KEY / _XF_APP_ID / _XF_ACCESS_KEY_ID / _XF_ACCESS_KEY_SECRET / VITE_LLM_API_KEY 等" -ForegroundColor Gray
Write-Host "     （详见 DEPLOY_ALIYUN.md §9.1.2）" -ForegroundColor Gray
Write-Host "  3. SSH 上服务器跑初始化：" -ForegroundColor Gray
Write-Host "       ssh -i $KEY_PATH $SERVER_USER@$SERVER_IP" -ForegroundColor Gray
Write-Host "       bash /root/deploy/server-init.sh" -ForegroundColor Gray
Write-Host "  4. GitHub → Actions → Deploy Web to Aliyun → Run workflow" -ForegroundColor Gray
