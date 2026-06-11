# OPC Brain Docker 一键部署

这个仓库已经内置 Docker 一键部署配置。容器内会同时启动两个进程：

- Gateway：智能体运行时，默认监听容器内 `18789`
- UI Server：Web 页面、REST API、WebSocket 适配层，默认监听容器内 `3001`

浏览器只需要访问宿主机暴露的 Web 端口，默认是 `http://localhost:3001`。

## 1. 准备环境变量

最快方式：

```bash
./scripts/docker-up.sh
```

第一次运行会自动创建 `.env` 并停止。你可以先填写 `OPCBRAIN_API_KEY`，也可以保留占位符，启动后在 Web UI 里完成模型配置。

手动方式：

```bash
cp .env.example .env
```

编辑 `.env`，推荐先填写：

```env
OPCBRAIN_API_KEY=你的 API Key
```

如果暂时不填，保持 `PLACEHOLDER_RUN_ONBOARDING_TO_REPLACE` 即可，首次打开页面会进入配置流程。

默认使用 OpenRouter。常见模型配置示例：

```env
# OpenRouter
OPCBRAIN_MODEL=openrouter/deepseek/deepseek-v4-flash
OPCBRAIN_LIGHT_MODEL=openrouter/qwen/qwen3-8b
OPCBRAIN_API_URL=https://openrouter.ai/api/v1

# DeepSeek
OPCBRAIN_MODEL=deepseek/deepseek-v4-flash
OPCBRAIN_LIGHT_MODEL=deepseek/deepseek-v4-flash
OPCBRAIN_API_URL=https://api.deepseek.com/v1

# Kimi / Moonshot
OPCBRAIN_MODEL=moonshot/kimi-k2.6
OPCBRAIN_LIGHT_MODEL=moonshot/kimi-k2.6
OPCBRAIN_API_URL=https://api.moonshot.cn/v1
```

## 2. 一键启动

```bash
./scripts/docker-up.sh
```

或直接使用 Compose：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
docker compose logs -f opcbrain
```

打开：

```text
http://localhost:3001
```

如果你在服务器上部署，把 `localhost` 换成服务器 IP 或域名。

## 3. 数据持久化

Compose 会创建并挂载 Docker volume：

```text
opcbrain-home -> /root/.opcbrain
```

这里会保存：

- `opcbrain.yaml` 模型配置
- 登录/本地用户数据库
- 会话、项目、附件
- 记忆数据
- 路由统计
- skills/plugins
- Always-On 与 cron 数据

删除容器不会删除这些数据。需要完整清空时执行：

```bash
docker compose down -v
```

## 4. 工作区挂载

`.env` 里的：

```env
OPCBRAIN_WORKSPACE=./workspace
```

会挂载到容器内：

```text
/workspace
```

生产环境建议改成绝对路径：

```env
OPCBRAIN_WORKSPACE=/data/opcbrain-workspace
```

智能体只能直接访问容器内的文件。如果希望它操作某个宿主机项目，需要把该项目或上级目录挂载进容器。

## 5. 使用已有配置文件

如果你已经有宿主机上的配置：

```text
~/.opcbrain/opcbrain.yaml
```

可以在 `docker-compose.yml` 里打开这行：

```yaml
- ${OPCBRAIN_CONFIG:-${HOME}/.opcbrain/opcbrain.yaml}:/root/.opcbrain/opcbrain.yaml:ro
```

注意：宿主机文件必须先存在，否则 Docker 可能会创建同名目录，导致启动失败。

## 6. 常用运维命令

```bash
# 启动/更新
docker compose up -d --build

# 查看日志
docker compose logs -f opcbrain

# 重启
docker compose restart opcbrain

# 停止
docker compose down

# 清空容器和持久化数据
docker compose down -v

# 进入容器
docker compose exec opcbrain bash
```

## 7. 反向代理

Nginx 反向代理到：

```text
http://127.0.0.1:3001
```

需要保留 WebSocket 头：

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## 8. 健康检查

```bash
curl http://localhost:3001/health
```

返回 `{"status":"ok" ...}` 表示 UI server 已启动。Gateway 由容器内进程管理，UI server 会通过 `ws://127.0.0.1:18789/ws` 连接它。
