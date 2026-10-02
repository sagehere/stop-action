# Coach Chat Adapter Spec v2

## 权限模型

```text
PWA
  -> minimized coach-context-v1
  -> Coach Relay
  -> upstream model
  -> Structured Output
  -> Relay sanitizer
  -> PWA sanitizer
  -> UI only
```

无论 Relay 还是外部模型，都没有写入 Training Engine 的数据路径。

## Browser -> Relay

`POST /api/coach`

```json
{
  "schema": "coach-chat-request-v1",
  "policy": {
    "explainOnly": true,
    "mayModifyTrainingEngine": false,
    "rawEventsAllowed": false,
    "medicalDiagnosisAllowed": false,
    "trainingParameterAdviceAllowed": false
  },
  "model": null,
  "context": {"schema":"coach-context-v1"},
  "conversation": [],
  "message": "为什么最近 ART 会波动？",
  "responseFormat": {
    "schema":"coach-chat-response-v1",
    "allowedFields":["answer","focus","evidence","uncertainty","safetyNotice"]
  }
}
```

Relay 不能信任浏览器端已经完成过校验，因此必须服务端重新验证。

## Relay 必须拒绝

请求或 Context 中出现：

- raw Event Stream
- `events` / `rawEvents` / `eventStream`
- Session ID / Session IDs
- revisions / revisionLog
- 精确时间字段
- `stopThreshold`
- `resumeThreshold`
- `trainingWeek`
- `safetyFlag`
- `actions`
- `applyDecision`
- `setThreshold`

`context.privacy` 必须明确声明：

```json
{
  "rawEventsIncluded": false,
  "exactTimestampsIncluded": false,
  "sessionIdsIncluded": false,
  "revisionsIncluded": false
}
```

## Relay -> Browser

```json
{
  "schema":"coach-chat-response-v1",
  "output": {
    "answer":"...",
    "focus":"...",
    "evidence":[{"label":"平均 ART","value":"34s"}],
    "uncertainty":"...",
    "safetyNotice":null
  }
}
```

输出字段仍会被浏览器端再次白名单化。

## OpenAI Adapter

v0.8 的参考 Relay 使用 Responses API：

```text
POST https://api.openai.com/v1/responses
```

并使用 Structured Outputs JSON Schema。

服务端显式：

```json
{"store": false}
```

模型由 `OPENAI_MODEL` 配置，浏览器提交的 model 只有位于 `ALLOWED_MODELS` 中才会被接受。

## Token

有两层 Token：

1. `OPENAI_API_KEY`：只存在服务器环境变量。
2. 可选 `RELAY_BEARER_TOKEN`：保护浏览器访问 Relay；浏览器端仍只保留在当前页面内存。

两者都不得写入 PWA IndexedDB 或 JSON 备份。

## Stop Action v1.0 deployment profile

Recommended public deployment is same-origin HTTPS:

```text
https://training.example.com/
https://training.example.com/api/coach
```

The browser should prefer the same-origin Relay URL. Cross-origin Relay use remains supported only through explicit `ALLOWED_ORIGINS` configuration.

Production secrets may be injected using `OPENAI_API_KEY_FILE` and `RELAY_BEARER_TOKEN_FILE`. Multi-instance deployments should use the Redis rate-limit backend instead of process-local memory counters.
