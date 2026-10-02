# Stop Action

`stop-action` 是一个移动端优先、离线优先的射精控制训练 PWA。核心围绕 Stop–Start（动停法）、正念、呼吸和盆底肌协调训练，并提供本地训练记录、趋势分析、自适应训练规则和可选的 Coach Relay。

> 本项目用于行为训练和记录，不用于疾病诊断。若存在持续疼痛、射精疼痛、新出现的明显泌尿症状或性功能突然明显变化，应优先寻求专业医疗评估。

## 主要特性

- 0–9 主观兴奋度记录与 Stop → Recovery → Resume 控制循环
- ART、Overshoot、主观控制感和身体信号趋势
- 呼吸、正念、盆底协调、盆底释放等模块自由组合
- 周计划 / 日历 / Adaptive Engine
- Local-first：训练数据默认保存在浏览器 IndexedDB
- 可选 Coach Relay；原始逐秒 Event Stream 不发送给外部模型
- 实机测试数据采集与 JSON / CSV 导出，默认关闭、主动开启
- PWA / 离线缓存
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
printf '%s' 'YOUR_OPENAI_API_KEY' > secrets/openai_api_key.txt
printf '%s' '' > secrets/relay_bearer_token.txt

docker compose pull
docker compose up -d
```

默认监听：

```text
127.0.0.1:8787
```

然后用你已经部署的 Nginx Proxy Manager、Caddy 等代理到该端口即可。更多说明见 [`deploy/README.md`](deploy/README.md)。

## Docker 镜像

GitHub Actions 在 `main` 更新和 `v*` 标签推送后构建：

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
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

Relay：

```bash
cd relay
node server.mjs
```

## QA

```bash
./qa.sh
```

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
