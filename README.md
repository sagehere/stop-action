# Stop Action

`stop-action` 是一个移动端优先、离线优先的射精控制训练 PWA。核心围绕 Stop–Start（动停法）、正念、呼吸和盆底肌协调训练，并提供本地训练记录、趋势分析、自适应训练规则和可选的 Coach Relay。

> 本项目用于行为训练和记录，不用于疾病诊断。若存在持续疼痛、射精疼痛、新出现的明显泌尿症状或性功能突然明显变化，应优先寻求专业医疗评估。

## 主要特性

- 0–9 主观兴奋度记录与 Stop → Recovery → Resume 控制循环
- ART、Overshoot、主观控制感和身体信号趋势
- 呼吸、正念、盆底协调、盆底释放等模块自由组合
- 自然月日历；4/8/12周内置模板及1–52周自定义计划
- 阶段与参数建议需确认；一个主计划可叠加自由训练
- Local-first：训练数据默认保存在浏览器 IndexedDB
- 可选 Coach Relay；原始逐秒 Event Stream 不发送给外部模型
- 实机测试数据采集与 JSON / CSV 导出，默认关闭、主动开启
- 加密完整备份、原子导入与冲突预览；保留明文与CSV导出
- 按钮操作、独立首次演练、遮屏、后台暂停和检查点恢复
- 可追溯中文内容与来源；模板周期属于产品组织安排
- PWA / 离线缓存 / 训练结束后更新
- `linux/amd64` + `linux/arm64` Docker 镜像自动发布到 GitHub Container Registry

## 轻量部署

本仓库只负责本项目自身和 Redis：

```text
External NPM / Caddy / Traefik / other proxy
                 │
                 ▼
        stop-action :8787
                 │
                 ▼
               redis
```

反向代理、域名、证书和 ACME **不包含在本项目 Compose 中**。

### Docker Compose

```bash
cd deploy
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
printf '%s' 'YOUR_OPENAI_API_KEY' > secrets/openai_api_key.txt
printf '%s' '' > secrets/relay_bearer_token.txt
chmod 644 secrets/openai_api_key.txt secrets/relay_bearer_token.txt

docker compose pull
docker compose up -d
```

默认监听：

```text
127.0.0.1:8787
```

然后用你已经部署的 Nginx Proxy Manager、Caddy 等代理到该端口即可。更多说明见 [`deploy/README.md`](deploy/README.md)。

## 使用 Dockge 部署

如果你已经在服务器上使用 [Dockge](https://github.com/louislam/dockge) 管理 Docker Compose，推荐把 Stop Action 作为一个独立 Stack 部署。Dockge 只负责管理本项目的 Compose；Nginx Proxy Manager、Caddy、Traefik、证书和 ACME 继续独立维护。

### 1. 推荐结构

~~~text
Internet
   │
   ▼
NPM / Caddy / Traefik
   │
   ▼
stop-action:8787
   │
   ▼
redis:6379
~~~

本 Stack 只包含 **stop-action + Redis**。Redis 仅用于 Coach Relay 的限流，不保存训练历史。

### 2. 在 Dockge 创建 Stack

1. 打开 Dockge，选择 **New Stack**。
2. Stack 名称填写 **stop-action**。
3. 将仓库中的 deploy/docker-compose.yml 内容复制到 Dockge 的 Compose 编辑器。
4. 保存后不要立即启动，先配置 ENV 和 Secret。

Dockge 默认的 Stack 目录通常类似：

~~~text
/opt/stacks/stop-action/
├── compose.yaml
├── .env
└── secrets/
~~~

如果你的 Dockge 修改过 Stacks Directory，以实际目录为准。

### 3. 配置 ENV

在 Dockge 的 ENV 编辑器中填入：

~~~dotenv
STOP_ACTION_IMAGE=ghcr.io/sagehere/stop-action:latest

APP_BIND=127.0.0.1
APP_PORT=8787

ALLOWED_ORIGINS=https://training.example.com

OPENAI_MODEL=gpt-5.6-luna
ALLOWED_MODELS=gpt-5.6-luna
OPENAI_BASE_URL=https://api.openai.com/v1

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=20
RATE_LIMIT_FAIL_CLOSED=1
REDIS_CONNECT_TIMEOUT_MS=1200

UPSTREAM_TIMEOUT_MS=18000
UPSTREAM_TOTAL_TIMEOUT_MS=30000
UPSTREAM_RETRY_COUNT=1
~~~

其中最重要的是 **APP_BIND、APP_PORT、ALLOWED_ORIGINS**。

#### APP_BIND 怎么选

如果 NPM / Caddy 直接运行在宿主机上，推荐：

~~~dotenv
APP_BIND=127.0.0.1
APP_PORT=8787
~~~

这样 8787 不直接暴露公网。

如果反向代理本身也运行在 Docker 中，它通常无法直接访问宿主机的 127.0.0.1。此时有两种做法。

**方案 A：监听宿主机端口**

~~~dotenv
APP_BIND=0.0.0.0
APP_PORT=8787
~~~

然后让反向代理访问 宿主机IP:8787。使用这种方式时，建议用防火墙限制 8787 的公网访问。

**方案 B：共享 Docker 外部网络，推荐**

先创建一个公共反代网络：

~~~bash
docker network create proxy
~~~

然后在 Compose 中为 stop-action 增加外部网络：

~~~yaml
services:
  stop-action:
    networks:
      - default
      - proxy

networks:
  proxy:
    external: true
~~~

并让 NPM / Caddy 也加入同一个 proxy 网络。这样反代可以直接访问：

~~~text
stop-action:8787
~~~

如果完全通过共享 Docker 网络反代，还可以删除 stop-action 的 ports 映射，让 8787 只存在于 Docker 网络内部。

#### ALLOWED_ORIGINS

填写最终访问本项目的公网 Origin，必须带协议：

~~~dotenv
ALLOWED_ORIGINS=https://training.example.com
~~~

多个域名用英文逗号分隔：

~~~dotenv
ALLOWED_ORIGINS=https://training.example.com,https://training2.example.com
~~~

不要加入路径。

### 4. 创建 Secret 文件

Compose 使用文件 Secret。需要注意：Docker Compose 对 `file:` Secret 使用单文件 bind mount，宿主机文件权限会直接影响容器内读取；本镜像以非 root 的 `node` 用户运行，因此 **Secret 文件不能设为 600(root-only)**。

通过 Dockge Terminal 或 SSH 进入 Stack 目录：

~~~bash
cd /opt/stacks/stop-action
mkdir -p secrets
chmod 700 secrets
~~~

如果暂时不用外部 AI Coach，也需要创建两个空文件：

~~~bash
: > secrets/openai_api_key.txt
: > secrets/relay_bearer_token.txt
chmod 644 secrets/openai_api_key.txt secrets/relay_bearer_token.txt
~~~

如果要启用外部 AI Coach：

~~~bash
printf '%s' 'YOUR_OPENAI_API_KEY' > secrets/openai_api_key.txt
chmod 644 secrets/openai_api_key.txt
~~~

可选地为 Relay 生成 Bearer Token：

~~~bash
openssl rand -hex 32 > secrets/relay_bearer_token.txt
chmod 644 secrets/relay_bearer_token.txt
~~~

这里采用 **目录 700 + 文件 644**：宿主机普通用户无法穿过 `secrets/` 目录，但容器内非 root 用户仍能读取 bind-mounted Secret。不要把真实 API Key 或 Token 写入 compose.yaml、.env、README 或 Git 仓库。

### 5. 在 Dockge 启动

回到 stop-action Stack，点击 **Deploy**。启动后应看到两个服务：

~~~text
stop-action    Running / Healthy
redis          Running / Healthy
~~~

也可以在终端检查：

~~~bash
docker compose ps
curl http://127.0.0.1:8787/api/ready
curl http://127.0.0.1:8787/api/health
~~~

`/api/ready`只检查核心静态应用，无模型密钥仍可正常部署。`/api/coach/ready`检查模型配置与限流；`/api/health`保留兼容字段。Coach状态检测不使用缓存。

### 6. Nginx Proxy Manager 配置

如果通过宿主机端口连接：

~~~text
Domain Names:       training.example.com
Scheme:             http
Forward Hostname:   宿主机 IP
Forward Port:       8787
~~~

如果 NPM 与 Stop Action 共享 proxy 网络：

~~~text
Forward Hostname:   stop-action
Forward Port:       8787
Scheme:             http
~~~

然后在 NPM 中申请 HTTPS 证书并开启 Force SSL。

### 7. Caddy 配置

如果 Caddy 运行在宿主机：

~~~caddyfile
training.example.com {
    reverse_proxy 127.0.0.1:8787
}
~~~

如果 Caddy 与应用共享 proxy 网络：

~~~caddyfile
training.example.com {
    reverse_proxy stop-action:8787
}
~~~

域名变化后记得同步修改 ALLOWED_ORIGINS，然后重新 Deploy。

### 8. 首次部署检查

建议逐项确认：

- 首页能正常打开。
- 我的 → 数据存储 显示 IndexedDB 正常。
- 可以开始并完成一次训练。
- 刷新网页后训练记录仍存在。
- PWA 可以安装。
- 如果启用外部 Coach，Relay Health 检查通过。
- 实机测试 JSON / CSV 可以正常导出。

### 9. 在 Dockge 中更新

默认镜像：

~~~text
ghcr.io/sagehere/stop-action:latest
~~~

GitHub Actions 发布新镜像后，在 Dockge 中执行 **Update / Pull / Redeploy** 即可。也可以使用终端：

~~~bash
docker compose pull
docker compose up -d
docker compose images
~~~

更新服务器镜像不会清空浏览器中的训练记录，因为训练历史默认保存在客户端 IndexedDB。

### 10. 固定版本与回滚

测试环境可以使用 latest；生产环境建议固定版本 Tag 或提交镜像。

例如：

~~~dotenv
STOP_ACTION_IMAGE=ghcr.io/sagehere/stop-action:v1.0.0
~~~

或者：

~~~dotenv
STOP_ACTION_IMAGE=ghcr.io/sagehere/stop-action:sha-xxxxxxx
~~~

回退前先保留新版本完整备份与升级前备份。把 STOP_ACTION_IMAGE 改回旧镜像摘要并重新部署；客户端恢复步骤与限制见 docs/MIGRATION_AND_BACKUP.md。仅回退服务器不会回退浏览器数据。

### 11. 备份与迁移

服务器端建议备份：

~~~text
/opt/stacks/stop-action/
├── compose.yaml
├── .env
└── secrets/
~~~

Redis 默认没有业务持久化数据；训练记录保存在用户浏览器 IndexedDB。

如果要更换域名、手机或浏览器，建议先在应用中导出训练 JSON 备份，再在新环境恢复。

### 12. 常见故障

#### Secret 文件不存在或出现 EACCES permission denied

检查：

~~~bash
cd /opt/stacks/stop-action
ls -ld secrets
ls -l secrets/
~~~

至少应该存在 `openai_api_key.txt` 和 `relay_bearer_token.txt`；即使不使用外部 Coach，也要创建空文件。

如果日志出现：

~~~text
OPENAI_API_KEY_FILE could not be read: EACCES: permission denied
~~~

修复权限：

~~~bash
chmod 700 secrets
chmod 644 secrets/openai_api_key.txt secrets/relay_bearer_token.txt
docker compose up -d --force-recreate
~~~

不要把 Secret 文件设置为 `600 root:root`，因为容器以非 root 用户运行，而 Compose 的 file-backed Secret 会保留 bind mount 的文件权限。

#### NPM / Caddy 出现 502

先在宿主机测试：

~~~bash
curl http://127.0.0.1:8787/api/ready
~~~

如果本机正常而反代失败，通常是反代容器无法访问宿主机 127.0.0.1。可改用 APP_BIND=0.0.0.0，或更推荐让反代和应用共享 Docker 网络。

#### GHCR 拉取 denied / unauthorized

确认 Package 是否允许公开读取。如果需要认证：

~~~bash
docker login ghcr.io
~~~

登录后在 Dockge 中重新 Pull / Deploy。

#### 页面正常但外部 Coach 不工作

检查：

- secrets/openai_api_key.txt 是否为空。
- OPENAI_MODEL 与 ALLOWED_MODELS 是否一致。
- ALLOWED_ORIGINS 是否与实际 HTTPS 域名完全一致。
- 修改 Secret 后是否重新 Deploy。
- 反代是否允许 /api/coach、/api/coach/ready、/api/health、/api/ready。

#### PWA 无法安装

公网环境应使用 HTTPS。普通 HTTP 站点通常不会被浏览器视为可安装 PWA，localhost 开发环境除外。

#### ARM 服务器能否运行

可以。GitHub Actions 同时构建 linux/amd64 和 linux/arm64，Docker 会自动选择当前服务器架构对应的镜像。

### 13. 推荐的最终部署方式

- Dockge 只管理 Stop Action + Redis。
- NPM / Caddy 独立部署。
- 反代与应用优先通过共享 Docker 外部网络通信。
- 不把 8787 直接暴露公网。
- API Key 只通过 Secret 文件提供。
- 测试环境跟随 latest；生产环境固定 vX.Y.Z 或 sha 标签。
- 训练数据保持 Local-first，并定期使用应用内 JSON 导出备份。


## Docker 镜像

GitHub Actions 先在 Windows/Linux 跑 QA，再在 Linux 跑 Chromium/WebKit 浏览器检查；通过后在 `main` 更新和 `v*` 标签推送时构建：

```text
linux/amd64
linux/arm64
```

镜像仅发布到 GitHub Container Registry：

```text
ghcr.io/sagehere/stop-action:latest
ghcr.io/sagehere/stop-action:sha-xxxxxxx
ghcr.io/sagehere/stop-action:vX.Y.Z
```

工作流：[`/.github/workflows/docker-image.yml`](.github/workflows/docker-image.yml)

## 实机测试数据

在 **我的 → 真实使用验收 → 实机测试数据** 中主动开启。

收集范围仅用于 UX 评估，例如：

- 滑动操作次数
- Stop / Resume 操作
- Quick Marker 打开 / 保存
- 暂停 / 恢复
- 训练过程中切后台
- 浏览器设备能力
- 可选的手势稳定度、震动辨识度、操作干扰评分
- 实机验收清单结果

测试遥测**不会记录**：

- 兴奋等级数值
- 身体信号具体内容
- Coach 对话
- OpenAI / GitHub 等账号信息
- GPS / IP 地址

可以单独导出为 JSON 或 CSV；训练 Session ID 在导出时会替换成匿名 `run-001` 形式。详见 [`docs/DEVICE_TEST_DATA.md`](docs/DEVICE_TEST_DATA.md)。

## 数据边界

训练数据默认存储在当前浏览器 IndexedDB。Redis 仅用于 Relay 限流，不保存训练历史。

外部 Coach 只接收质量过滤后的最小化摘要；Training Engine 的阈值、周次和 Safety 状态不接受模型直接修改。相关规格见：

- [`docs/COACH_LAYER_SPEC.md`](docs/COACH_LAYER_SPEC.md)
- [`docs/COACH_CHAT_ADAPTER_SPEC.md`](docs/COACH_CHAT_ADAPTER_SPEC.md)
- [`docs/RELAY_SECURITY_SPEC.md`](docs/RELAY_SECURITY_SPEC.md)

## 本地开发

无需构建前端：

```bash
node relay/server.mjs
```

然后访问：

```text
http://localhost:8787
```

Relay：

```bash
cd relay
node server.mjs
```

## QA

```bash
npm ci
npm run qa
npx playwright install chromium webkit
npm run test:browser
# Linux/macOS: BROWSER=webkit npm run test:browser
# PowerShell: $env:BROWSER="webkit"; npm run test:browser
```

`./qa.sh`仍兼容 Linux。浏览器测试仅增加开发依赖，前端和 Relay 没有新增运行时依赖。真实手机验收与发布记录见 docs/RELEASE_VALIDATION.md。

主要覆盖：

- JS 语法
- DOM 引用
- IndexedDB 初始化
- Training / Coach 基础运行时 smoke test
- Relay 契约测试
- 上游 Responses API 契约模拟
- Redis 限流测试
- 轻量 Compose 结构检查
- 实机测试数据导出边界

## 目录

```text
.
├── .github/workflows/   # GHCR 多架构构建
├── deploy/              # 仅 app + redis
├── docs/                # 架构 / 数据 / 实机验收说明
├── e2e/                 # Relay / production smoke
├── relay/               # Coach Relay
├── app.js
├── db.js
├── index.html
└── Dockerfile
```

## v2 内容、计划与迁移

- [依据与文案映射](docs/CONTENT_EVIDENCE.md)
- [长期计划与数据契约](docs/LONG_PLANS.md)
- [备份、迁移与回退](docs/MIGRATION_AND_BACKUP.md)
- [发布验证与实机待验收项目](docs/RELEASE_VALIDATION.md)

状态与计时、日历计划、内容、备份分别在 training-core.js、plans.js/plan-ui.js、content.js、backup.js；保留原生 HTML/JavaScript 与 IndexedDB。外部 Coach 不接收原始事件、精确时间、计划 ID 或个人模板目标。
