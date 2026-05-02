# 教学工作台 × 微信 ClawBot 连接器

通过腾讯官方 **ClawBot（iLink 协议）**，让工作台 AI 助手出现在老师的微信联系人中。

## 支持的微信指令

| 发送 | 效果 |
|------|------|
| `帮助` | 查看所有指令 |
| `任务列表` | 最近 7 天转写任务 |
| `今日任务` | 今天的任务 |
| `待反馈` | 未生成反馈的任务 |
| `查 张三` | 查询张三的学习记录 |
| `生成反馈 张三` | AI 生成反馈并保存到工作台 |
| `统计` | 本周数据统计 |
| 任意问题 | 通用 AI 回答（Kimi） |

## 部署步骤

### 1. 配置环境变量

```bash
cd wechat-agent
cp .env.example .env
nano .env   # 填入 Supabase URL/Key、Kimi API Key
```

### 2. 上传到服务器

```bash
# 在本地项目根目录执行
rsync -avz wechat-agent/ root@47.242.163.135:/opt/teaching-workbench/wechat-agent/
```

### 3. 在服务器上部署

```bash
ssh root@47.242.163.135
cd /opt/teaching-workbench/wechat-agent
bash deploy.sh
```

### 4. 更新 Nginx（如未自动更新）

把 `deploy/nginx.aliyun.conf` 里的 `/wechat-agent/` 块复制到服务器 Nginx 配置：

```bash
# 在服务器上
nano /etc/nginx/sites-available/teaching-workbench
nginx -t && systemctl reload nginx
```

### 5. 扫码绑定微信

```bash
# 在服务器上
weclaw login
```

终端显示二维码 → 用微信扫码 → 确认绑定。

绑定后 AI 助手会出现在微信联系人列表，给它发消息即可。

### 6. 验证

```bash
# 检查 Agent Server
curl https://yixiaojian.top/wechat-agent/health

# 检查 weclaw 状态
weclaw status

# 查看日志
pm2 logs wechat-agent
```

## 常见问题

**Q: 发消息没有回复**
- `pm2 logs wechat-agent` 查看 Agent Server 是否有请求进来
- `weclaw status` 检查微信连接状态

**Q: 回复"数据库未配置"**
- 检查 `.env` 中的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_KEY`

**Q: 重启服务器后 weclaw 断连**
- `pm2 startup` 已设置自动重启
- 但 weclaw 需要重新登录：`weclaw login`（iLink token 有效期约 24h，会自动续期）
