#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# 服务器一次性初始化脚本
# 已支持：Alibaba Cloud Linux 3 / AnolisOS / RHEL / Rocky / AlmaLinux / CentOS
#         Ubuntu 22.04 / 24.04、Debian 12
#
# 用法：
#   1. 把 deploy/ 整个目录 scp 到服务器
#   2. 编辑下面的 EMAIL（DOMAIN 已固化为 yixiaojian.top）
#   3. bash server-init.sh
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

# ────────── 已固化，无需修改 ──────────
DOMAIN="yixiaojian.top"
EMAIL="1551361698@qq.com"
# ──────────────────────────────────────

WEB_ROOT="/var/www/teaching-workbench"
NGINX_CONF_NAME="teaching-workbench.conf"

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}▶ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
die()  { echo -e "${RED}✗ $*${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && die "请用 root 或 sudo 运行：sudo bash server-init.sh"

# ─── 检测发行版 ───
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
else
    die "无法识别发行版（缺少 /etc/os-release）"
fi

case "${ID,,}${ID_LIKE:-}" in
    *ubuntu*|*debian*)
        FAMILY=debian
        PKG="apt-get install -y"
        UPDATE="apt-get update -y"
        NGINX_USER="www-data"
        NGINX_CONF_DIR="/etc/nginx/sites-available"
        NGINX_ENABLE_DIR="/etc/nginx/sites-enabled"
        ;;
    *alinux*|*anolis*|*rhel*|*centos*|*rocky*|*alma*|*fedora*)
        FAMILY=rhel
        PKG="dnf install -y"
        UPDATE="dnf makecache"
        NGINX_USER="nginx"
        NGINX_CONF_DIR="/etc/nginx/conf.d"
        NGINX_ENABLE_DIR=""           # RHEL 系直接放 conf.d，没有 enabled 软链
        ;;
    *)
        die "不识别的发行版：ID=${ID} ID_LIKE=${ID_LIKE:-none}（手动安装 nginx + certbot 后再跑后续步骤）"
        ;;
esac
log "发行版：${PRETTY_NAME:-$ID} (family=$FAMILY)"

# ─── 安装基础包 ───
log "[1/7] 更新包索引"
$UPDATE

log "[2/7] 安装 Nginx + certbot + 工具"
if [[ "$FAMILY" == "debian" ]]; then
    $PKG nginx certbot python3-certbot-nginx ufw curl rsync
else
    # Alinux 3 / RHEL 系
    $PKG nginx curl rsync || die "Nginx 安装失败"
    # certbot 在 Alinux 3 主仓库里没有，先确保 EPEL 类源
    if ! command -v certbot >/dev/null 2>&1; then
        $PKG epel-release || true        # Alinux 3 自带兼容源，可能本身就有 certbot
        $PKG certbot python3-certbot-nginx || \
            warn "certbot 未通过包管理器装上；稍后改用 snap 或 pip 装也行（HTTPS 步骤会报错则提示你）"
    fi
fi

# ─── 网站目录 ───
log "[3/7] 创建网站目录 ${WEB_ROOT}"
mkdir -p "$WEB_ROOT"
chown -R "$NGINX_USER":"$NGINX_USER" "$WEB_ROOT" 2>/dev/null || chown -R "$NGINX_USER" "$WEB_ROOT"
cat >"${WEB_ROOT}/index.html" <<EOF
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Teaching Workbench</title></head>
<body style="font-family:sans-serif;padding:40px;">
<h1>Teaching Workbench</h1>
<p>Server initialized. Awaiting deployment via GitHub Actions.</p>
<p><small>${DOMAIN}</small></p>
</body></html>
EOF

# ─── 写入 Nginx 配置 ───
log "[4/7] 写入 Nginx 配置"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_CONF="${SCRIPT_DIR}/nginx.aliyun.conf"
[[ -f "$SRC_CONF" ]] || die "找不到 ${SRC_CONF}，请把 deploy/ 目录完整上传"

DEST_CONF="${NGINX_CONF_DIR}/${NGINX_CONF_NAME}"
sed "s/your-domain\.com/${DOMAIN}/g" "$SRC_CONF" > "$DEST_CONF"

if [[ "$FAMILY" == "debian" ]]; then
    ln -sf "$DEST_CONF" "${NGINX_ENABLE_DIR}/${NGINX_CONF_NAME%.conf}"
    rm -f /etc/nginx/sites-enabled/default
else
    # RHEL 系：禁掉默认欢迎页（默认 nginx.conf 里那个 default_server）
    if grep -q 'default_server' /etc/nginx/nginx.conf 2>/dev/null; then
        warn "/etc/nginx/nginx.conf 仍含 default_server，已注释掉避免抢占 80 端口"
        sed -i 's/^\(\s*listen.*default_server.*\)/# \1  # disabled by server-init/' /etc/nginx/nginx.conf || true
    fi
    rm -f /etc/nginx/conf.d/default.conf 2>/dev/null || true
fi

log "[5/7] 校验 + 重载 Nginx"
nginx -t
systemctl enable nginx
systemctl restart nginx

# ─── 防火墙 ───
log "[6/7] 配置主机防火墙"
if [[ "$FAMILY" == "debian" ]]; then
    ufw allow OpenSSH || true
    ufw allow 'Nginx Full' || true
    yes | ufw enable || true
    ufw status || true
elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
    firewall-cmd --permanent --add-service=ssh
    firewall-cmd --reload
    firewall-cmd --list-all
else
    warn "未启用 firewalld（Alibaba Cloud Linux 默认就是关的，靠 ECS 安全组）"
    warn "请确认 ECS 控制台 → 安全组 已放行 22/80/443 入站"
fi

# ─── HTTPS ───
log "[7/7] 申请 HTTPS 证书（Let's Encrypt）"
warn "请确认 ${DOMAIN} 与 www.${DOMAIN} 已 A 记录指向本机公网 IP，否则会签发失败"
warn "国内 ECS 还需 ICP 备案完成后阿里云才会放行 80 端口的入站访问"

if command -v certbot >/dev/null 2>&1; then
    certbot --nginx \
        -d "${DOMAIN}" -d "www.${DOMAIN}" \
        --non-interactive --agree-tos --email "${EMAIL}" \
        --redirect \
        || warn "certbot 自动签发失败 ─ 常见原因：DNS 未生效 / 备案未通过 / 80 端口被防火墙挡。先把这些处理好再跑：certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --redirect"
else
    warn "certbot 未安装，跳过 HTTPS。后续手动安装：dnf install -y certbot python3-certbot-nginx"
fi

log "✓ 服务器初始化完成"
echo
echo "下一步："
echo "  1. 浏览器访问 http://${DOMAIN} 应能看到占位页"
echo "  2. 把本地 SSH 公钥加到 ~/.ssh/authorized_keys 后，"
echo "     在 GitHub 仓库配置 Secrets，push 到 main 自动部署"
echo "  3. 详见仓库 DEPLOY_ALIYUN.md §9.1"
