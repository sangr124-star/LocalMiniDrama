# MiniDrama 部署规范

> 本文档记录 MiniDrama 项目部署到 mj 服务器的流程、踩坑预防、回滚方案。

## 服务器配置概览

| 项 | 值 |
|---|---|
| 域名 | https://aimj.aijianshou.com |
| 服务器 IP | 115.191.45.199（mj 漫剧服务器） |
| SSH 用户 | deploy（免密 + 免密 sudo） |
| 项目路径 | /home/deploy/apps/MiniDrama |
| Node 版本 | v20.20.1（nvm） |
| PM2 进程名 | minidrama-backend |
| 后端端口 | 3011（仅监听 127.0.0.1） |
| Nginx 站点 | /etc/nginx/sites-available/aimj.aijianshou.com |
| HTTPS 证书 | Let's Encrypt（certbot 自动续期） |
| 数据库 | SQLite，路径 `backend-node/data/drama_generator.db` |
| 资源存储 | 本地磁盘，路径 `backend-node/data/storage` |
| Git 远程 | git@github.com:sangr124-star/LocalMiniDrama.git（origin） |

> ⚠️ 同一台 mj 服务器还跑着 adcast-backend（端口 3001）。两个项目共存，互不干扰。

---

## 关键架构决策

### 1. 后端自带前端 SPA
`backend-node/src/app.js` 会自动 serve `frontweb/dist`（只要目录存在）。
**Nginx 不需要单独 root + try_files**，把所有请求统统反代到 `127.0.0.1:3011` 即可。
后端内部已处理好 `/api`、`/static`、`/assets`、SPA 路由 fallback。

### 2. 配置文件分层
项目有 **`backend-node/configs/config.yaml`** 被 git 追踪（默认是开发配置）。
服务器上需要一份**生产配置**，做法：
- 服务器直接覆盖 `configs/config.yaml`（端口 3011、CORS 改成 https://aimj.aijianshou.com、host 127.0.0.1）
- 用 `git update-index --assume-unchanged configs/config.yaml` 让 `git pull` 不再覆盖此文件
- ⚠️ 如果以后开发时改了 config.yaml 的 schema，部署时要先 `git update-index --no-assume-unchanged`、pull、合并、再 `--assume-unchanged`

### 3. 敏感配置（AI Key）
miniDrama 的 AI Key 不放 .env，而是存在数据库表 `ai_service_configs` 里（前端"AI 配置"页面录入）。
**部署时一并 scp 本地数据库即可**，新机器要么从 Web UI 录入，要么从本地复制 db。

### 4. 数据库迁移
SQLite + better-sqlite3。**migrations 在每次启动时自动执行**（`src/db/migrate.js` 的 `runMigrationsAndEnsure`），不需要手动跑。
better-sqlite3 是原生模块，**必须在服务器上 `npm install` 重新编译**，不能 scp node_modules。

---

## 首次部署流程（已完成，归档参考）

1. **DNS**：阿里云解析 aimj.aijianshou.com A 记录 → 115.191.45.199（TTL 10 分钟）
2. **代码同步**：境内服务器拉 GitHub 不稳定，首次用 git bundle 推送：
   ```bash
   # 本地
   git bundle create /tmp/minidrama.bundle --all
   scp /tmp/minidrama.bundle deploy@115.191.45.199:/tmp/

   # 服务器
   cd /home/deploy/apps
   git clone /tmp/minidrama.bundle MiniDrama
   cd MiniDrama
   git remote remove origin
   git remote add origin git@github.com:sangr124-star/LocalMiniDrama.git
   git checkout main
   ```
3. **依赖**：`cd backend-node && npm install`（自动编译 better-sqlite3）
4. **生产配置**：服务器写 `backend-node/configs/config.yaml`（见下文模板），并 `git update-index --assume-unchanged`
5. **本地数据**：scp `backend-node/data/drama_generator.db` 和 `backend-node/data/storage/` 到服务器
6. **PM2**：`pm2 start ecosystem.config.cjs && pm2 save`
7. **Nginx**：写一份 80 端口反代 → certbot --nginx 自动签证书 + 改写为 443
8. **验证**：`curl https://aimj.aijianshou.com/health` 返回 `{"status":"ok"}`

---

## 日常部署流程（代码改动后）

> 前提：服务器 `git remote get-url origin` 指向 GitHub，且 SSH key 已配置。

```bash
# 1. 本地：构建前端 + 提交推送
cd D:/claude/miniDrama
cd frontweb && npm run build && cd ..
git add . && git commit -m "feat/fix: xxx"
git push origin main

# 2. 服务器：拉代码
ssh deploy@115.191.45.199 "cd /home/deploy/apps/MiniDrama && git pull origin main"

# 3. 上传前端构建产物（dist 在 .gitignore 中）
scp -r D:/claude/miniDrama/frontweb/dist deploy@115.191.45.199:/home/deploy/apps/MiniDrama/frontweb/

# 4. 后端依赖变更时
ssh deploy@115.191.45.199 "cd /home/deploy/apps/MiniDrama/backend-node && export PATH=/home/deploy/.nvm/versions/node/v20.20.1/bin:\$PATH && npm install"

# 5. 重启
ssh deploy@115.191.45.199 "export PATH=/home/deploy/.nvm/versions/node/v20.20.1/bin:\$PATH && pm2 restart minidrama-backend --update-env"

# 6. 验证
curl https://aimj.aijianshou.com/health
ssh deploy@115.191.45.199 "export PATH=/home/deploy/.nvm/versions/node/v20.20.1/bin:\$PATH && pm2 logs minidrama-backend --lines 30 --nostream"
```

> 如果 GitHub 在境内拉不下来，可临时改为 git bundle 模式（见首次部署）。

---

## 生产 config.yaml 模板（服务器上的版本）

```yaml
app:
  name: LocalMiniDrama API
  version: 1.0.0
  debug: false
  language: zh
server:
  port: 3011
  host: 127.0.0.1                       # 仅监听本地，由 Nginx 反代
  cors_origins:
    - https://aimj.aijianshou.com
  read_timeout: 600
  write_timeout: 600
database:
  type: sqlite
  path: ./data/drama_generator.db
  max_idle: 10
  max_open: 100
storage:
  type: local
  local_path: ./data/storage
  base_url: https://aimj.aijianshou.com/static
ai:
  default_text_provider: openai
  default_image_provider: openai
  default_video_provider: doubao
# style/vendor_lock 段保持开发版默认即可
```

---

## Nginx 站点配置（参考）

certbot 自动改写后的最终形态见 `/etc/nginx/sites-available/aimj.aijianshou.com`。
关键：**所有请求都反代到 127.0.0.1:3011**，由后端处理 SPA 路由 + API + 静态资源。

```nginx
server {
    server_name aimj.aijianshou.com;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    location / {
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_buffering off;
        client_max_body_size 100M;        # 视频上传大于此值时调高
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/aimj.aijianshou.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aimj.aijianshou.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = aimj.aijianshou.com) { return 301 https://$host$request_uri; }
    listen 80;
    server_name aimj.aijianshou.com;
    return 404;
}
```

修改后：`sudo nginx -t && sudo systemctl reload nginx`。

---

## PM2 ecosystem.config.cjs（服务器上）

```javascript
module.exports = {
  apps: [{
    name: 'minidrama-backend',
    script: 'src/server.js',
    cwd: '/home/deploy/apps/MiniDrama/backend-node',
    max_memory_restart: '4G',
    node_args: '--max-old-space-size=4096',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: {
      NODE_ENV: 'production',
      PORT: 3011,
    },
  }],
};
```

PM2 已 `pm2 save`，开机会被 systemd unit 自动拉起（adcast 已配置好，沿用即可）。

---

## 部署后验证清单

```bash
# 1. 服务在线
ssh deploy@115.191.45.199 "export PATH=/home/deploy/.nvm/versions/node/v20.20.1/bin:\$PATH && pm2 list | grep minidrama"
# 期望：status=online

# 2. 健康检查
curl https://aimj.aijianshou.com/health
# 期望：{"status":"ok",...}

# 3. API 冒烟测试
curl https://aimj.aijianshou.com/api/v1/dramas
# 期望：{"success":true,"data":{"items":[...]}}

# 4. 前端
curl -I https://aimj.aijianshou.com/
# 期望：HTTP/1.1 200 OK，Content-Type: text/html

# 5. 静态资源
curl -I https://aimj.aijianshou.com/static/projects/<某个文件>.png
# 期望：200 + image/*

# 6. 日志无报错
ssh deploy@115.191.45.199 "export PATH=/home/deploy/.nvm/versions/node/v20.20.1/bin:\$PATH && pm2 logs minidrama-backend --lines 50 --nostream"
```

---

## 常见踩坑

### 坑 1：境内服务器拉 GitHub 失败
**现象**：`git clone https://github.com/...` 报 `GnuTLS recv error (-110)`。
**原因**：境内对 GitHub HTTPS 的 TLS 干扰。
**解决**：
- 优先用 SSH（`git@github.com:...`），AdCast 已经在用，验证可行
- 实在不行用 git bundle 从本地推（见首次部署流程）

### 坑 2：`config.yaml` 被 git pull 覆盖
**现象**：服务器配置改完 push 别的提交时，pull 把生产配置覆盖回开发版。
**原因**：config.yaml 是 git 追踪文件。
**解决**：服务器上 `git update-index --assume-unchanged backend-node/configs/config.yaml`。
**长期方案**（待做）：在项目里把 config.yaml 加入 .gitignore，提供 `config.yaml.example` 模板。

### 坑 3：better-sqlite3 报 NODE_MODULE_VERSION 错
**现象**：`The module was compiled against a different Node.js version`。
**原因**：scp 了本地 node_modules 上去，原生模块是 win 编译的。
**解决**：服务器删 node_modules，`npm install` 重新编译。

### 坑 4：前端访问 API 跨域 403/CORS
**现象**：浏览器控制台 `CORS error`。
**原因**：`config.yaml` 里 `cors_origins` 没加生产域名。
**解决**：加上 `https://aimj.aijianshou.com`，重启后端。

### 坑 5：Nginx warn `conflicting server name`
**现象**：`nginx -t` 提示 `conflicting server name "mj.aijianshou.com" ignored`。
**原因**：adcast 的 `default` 站点配置和 `mjlf-langfuse` 之间有重复 server_name。
**与 miniDrama 无关**，不影响我们的站点工作。如果要清理，让 adcast 维护者处理。

### 坑 6：PM2 远程命令 `command not found`
**现象**：`ssh deploy@... "pm2 ..."` 报 pm2 找不到。
**原因**：非交互 SSH 不加载 nvm 环境。
**解决**：每条命令前加 `export PATH=/home/deploy/.nvm/versions/node/v20.20.1/bin:$PATH &&`。

### 坑 7：Let's Encrypt 续期失败
**现象**：90 天后证书过期，访问报不安全。
**自动续期**：certbot 装好了 systemd timer（`systemctl list-timers | grep certbot`），通常自动跑。
**手动检查**：`sudo certbot renew --dry-run`，能模拟续期成功就放心。

### 坑 8：上传大文件 413 Request Entity Too Large
**现象**：上传超过 100M 的视频/zip 时报 413。
**原因**：`client_max_body_size 100M` 太小。
**解决**：改 nginx 配置到 `5G`，`sudo nginx -t && sudo systemctl reload nginx`。

---

## 回滚

```bash
# 1. 看最近提交
ssh deploy@115.191.45.199 "cd /home/deploy/apps/MiniDrama && git log --oneline -5"

# 2. 回到上一版
ssh deploy@115.191.45.199 "cd /home/deploy/apps/MiniDrama && git checkout HEAD~1"

# 3. 前端回滚：本地切到旧 commit，重新 build + scp dist

# 4. 重启
ssh deploy@115.191.45.199 "export PATH=/home/deploy/.nvm/versions/node/v20.20.1/bin:\$PATH && pm2 restart minidrama-backend --update-env"
```

数据库回滚：从 `backend-node/data/drama_generator.db` 备份恢复（首次部署时 scp 的版本可作为基线）。

---

## 待办（部署后改进）

- [ ] 把 `backend-node/configs/config.yaml` 加入 `.gitignore`，提供 `config.yaml.example` 模板（避免坑 2）
- [ ] 写一个 `scripts/deploy.sh` 自动跑日常部署四步（push / pull / scp dist / pm2 restart）
- [ ] 数据库自动备份：crontab 定期 cp `drama_generator.db` 到 `backups/` 带时间戳
- [ ] 监控：考虑接入简单的 PM2 health hook 或 uptime 监控（Uptime Kuma 之类）
- [ ] 视频/图像生成产物如果增长快，考虑接 TOS 对象存储（参考 adcast 模式）

---

更新日期：2026-05-02（首次部署完成）
