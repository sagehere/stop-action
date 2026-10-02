# Coach Layer v1 规格

## 1. 职责

Coach 负责：

- 解释近期训练数据
- 把多个指标转换为易理解的复盘
- 指出下一次应关注的身体信号或训练过程
- 解释 Adaptive Engine 已经做出的决定
- 明确数据不足与不确定性

Coach 不负责：

- 修改 Stop Threshold
- 修改 Resume Threshold
- 修改训练周次
- 修改 Safety Flag
- 自动切换提示模式
- 自动创建或删除训练计划
- 医学诊断

## 2. 数据路径

```text
Session
 ↓
Data Quality
 ↓
usableForTrend = true
 ↓
Metrics
 ↓
Coach Context
 ↓
Coach Output
```

默认只使用真实数据：

```text
simulated !== true
```

## 3. Coach Context v1

主要字段：

```text
stage
promptMode
samples
recent
previous
change
signals
latestState
adaptive
privacy
```

明确不包含：

```text
rawEvents
exactTimestamps
sessionIds
revisions
```

## 4. 窗口

默认：

```text
recent = 最近 3 次可用动停 Session
previous = 之前 3 次可用动停 Session
signals = 最近 6 次可用 Session
```

只有 Data Quality Engine 判定：

```text
usableForTrend = true
```

的 Session 才能参与。

## 5. Coach Output v1

白名单：

```text
version
mode
generatedAt
headline
summary
focus
nextStep
watch
evidence
uncertainty
safetyNotice
```

禁止字段：

```text
stopThreshold
resumeThreshold
trainingWeek
safetyFlag
applyDecision
setThreshold
actions
```

## 6. Safety 优先级

如果：

```text
latestState.pain = true
```

或：

```text
adaptive.type = SAFETY_REVIEW_REQUIRED
```

Coach 必须优先进入 Safety Explanation。

普通的 ART / Overshoot / Control 趋势解释不得覆盖该状态。

## 7. 当前实现

v0.6 使用：

```text
Offline Rule Coach
```

优点：

- 100% 本地
- 可重复
- 可单元测试
- 不发送敏感数据
- 方便验证产品信息结构

未来 LLM 应作为 Adapter 替换“自然语言生成”，而不是替换 Data Quality、Metrics 或 Adaptive Engine。

## 8. 外部 LLM Adapter

输入：

```text
externalCoachPayload(context)
```

策略：

```text
explainOnly: true
mayModifyTrainingEngine: false
rawEventsAllowed: false
medicalDiagnosisAllowed: false
```

输出必须通过：

```text
sanitizeCoachOutput()
validateCoachOutput()
```

再展示给用户。

任何模型输出都不能直接写入 Training Engine。

## v0.7：Coach Chat Extension

v0.7 在上述单次解释结构之上增加多轮对话。对话仍处于 Coach Layer，不新增任何 Training Engine 写入权限。

```text
coach-context-v1
      ↓
local chat / external relay
      ↓
allowlist + guardrails
      ↓
chat UI only
```

外部 Adapter 的请求/响应契约、HTTPS 约束、会话令牌策略与禁止字段见 `COACH_CHAT_ADAPTER_SPEC.md`。

---

# Phase 4.7 Extension: Server Trust Boundary

v0.8 将 Coach Adapter 的权限边界复制到服务器端，而不是只依赖浏览器。

新增：

- same-origin `/api/coach`
- request schema validation
- privacy-minimization validation
- upstream model allowlist
- Structured Outputs
- `store:false`
- server-side output control-field rejection
- sanitized logging
- rate limit / timeout / optional retry

原则保持不变：

> Coach 解释 Training Engine 的结果，但不成为 Training Engine。

---

# Stop Action v1.0 Deployment Boundary

Stop Action v1.0 keeps the application deployment intentionally lightweight:

- TLS and reverse proxying are provided by a separately managed NPM/Caddy/Traefik instance;
- secret-file injection for API credentials;
- Redis-backed shared rate limiting for multi-instance deployments;
- fail-closed rate-limit mode;
- readiness separate from liveness;
- upstream `Retry-After` handling, total request deadline, refusal and incomplete-response handling;
- upstream request-ID correlation without logging Coach content.

None of these additions grant Coach any Training Engine write permission.
