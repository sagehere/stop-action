# Phase 4.4 手机实机验收清单

> 建议至少在一台真实 Android 手机和一台 iPhone（如可用）上完成。每个项目记录：通过 / 不通过 / 备注 / 设备与浏览器版本。

## A. 基础启动与隐私

- [ ] HTTP/HTTPS 打开后首页正常加载，无空白页或阻塞弹窗。
- [ ] 添加到主屏幕后可作为 PWA 启动。
- [ ] 断网后重新启动，核心训练流程仍可使用。
- [ ] 多任务界面、锁屏通知、页面标题没有暴露不希望显示的敏感词。
- [ ] 深色界面在低亮度下仍可清晰辨认。

## B. Live Session 手势

- [ ] 上滑一次稳定增加 1 级。
- [ ] 下滑一次稳定降低 1 级。
- [ ] 连续快速上下滑不会触发页面滚动。
- [ ] Level 6 提示符合当前提示模式。
- [ ] Level 7 Stop 提示触发正确。
- [ ] Stop 提示后单击可以进入 Recovery。
- [ ] 单击不会经常被错误识别成双击。
- [ ] Recovery 到阈值后双击 Resume 稳定。
- [ ] Recovery 左滑能打开 Quick Marker。
- [ ] Quick Marker 关闭后 Session 状态没有丢失。
- [ ] 长按结束不会和滑动输入冲突。

## C. 震动与提示

- [ ] 普通等级反馈可感知但不过强。
- [ ] Level 6 / Stop / Recovery 的震动模式能区分。
- [ ] 关闭震动后不再调用明显震动反馈。
- [ ] “仅阈值”和“自主模式”行为符合规格。
- [ ] 自主模式不会偷偷自动 Stop。

## D. 暂停与异常恢复

- [ ] Pause 后有效训练计时停止。
- [ ] 从 Pause Resume 后计时继续正确。
- [ ] 训练中杀掉浏览器 / PWA，再打开时能发现未完成 Session。
- [ ] 恢复 Session 后当前模块、Cycle、事件记录仍一致。
- [ ] 放弃未完成 Session 后不会污染历史记录。

## E. 日历与组合训练

- [ ] 周日历拖拽在触屏上可用。
- [ ] 拖拽不会频繁误触页面滚动。
- [ ] 自定义 Program 可以保存、开始和安排到本周。
- [ ] 多 Exercise Program 会按正确顺序执行。
- [ ] 非动停 Program 不会错误增加动停次数。

## F. 数据质量与纠错

- [ ] 生成模拟数据后出现 24 条趋势样本 + 2 条质量边界样本。
- [ ] 两条质量边界样本被标记为“注意”。
- [ ] 低质量动停记录不会进入趋势。
- [ ] 低质量动停记录不会改变真实 Adaptive Decision。
- [ ] 修订 Cycle 后 ART / Stop 等派生指标立即更新。
- [ ] 原始 Event Stream 保持不变。
- [ ] 撤销修订会新增 Revision Reversed 记录，而不是删除历史。

## G. 模拟数据隔离

- [ ] 生成模拟数据不会推进真实训练周数。
- [ ] 默认关闭模拟分析时，真实趋势不混入模拟数据。
- [ ] 打开模拟分析后能查看 8 周图表和方案对比。
- [ ] 模拟 Adaptive History 有明确“模拟”标记。
- [ ] 删除模拟数据不会删除任何真实 Session。

## H. 导出 / 恢复

- [ ] JSON 完整备份可以下载。
- [ ] CSV 摘要可以下载，并包含 dataQuality / revised / simulated 字段。
- [ ] JSON 恢复后历史、计划、设置和修订日志一致。
- [ ] v0.4 备份可以恢复到 v0.5。
- [ ] 文件选择取消不会造成页面错误。

## I. 最低通过标准

核心上线前必须全部通过：

- Live Session 上下滑 / Stop / Recovery / Resume
- Event 持久化
- Session 崩溃恢复
- 数据质量过滤
- 模拟数据隔离
- 修订日志可追溯
- JSON 备份恢复
- 隐私显示检查

如果上述任一核心项目失败，不建议进入 AI Coach 阶段。

## Coach Layer v0.6

### C1. Coach 隔离
- [ ] 未开启开发者模拟分析时，Coach 只读取真实 Session。
- [ ] 开启模拟分析后，真实 Coach 仍不受模拟数据影响。
- [ ] 模拟 Coach 只显示在开发者预览中。

### C2. Coach 隐私
- [ ] “查看最小化结构化上下文”中没有原始 Event Stream。
- [ ] 不包含 Session ID。
- [ ] 不包含精确 Session 时间。
- [ ] 不包含 Revision Log。
- [ ] “复制 AI 上下文”只能由用户主动触发。

### C3. Coach 交互
- [ ] Summary 页出现简短 Coach 复盘。
- [ ] “查看完整教练复盘”可进入 Coach Tab。
- [ ] 手动保存 Coach 复盘后，历史数量增加。
- [ ] JSON 备份 / 恢复后 Coach 历史仍存在。

### C4. Coach 越权
- [ ] Coach 页面只解释，不提供直接修改阈值按钮。
- [ ] Adaptive Engine 的参数调整仍独立显示。
- [ ] Safety Review 出现时，Coach 不再输出普通“提升表现”建议。


## 7. Coach Chat / External Adapter

- [ ] 本地 Coach 可以连续问至少 3 个问题，刷新页面后本地对话仍在。
- [ ] 切到外部 LLM 前，如果未配置 Relay，应阻止切换并提示。
- [ ] HTTPS Relay 配置并授权后，外部模式可以发送最小化上下文并显示结构化回复。
- [ ] 页面关闭重开后，Relay Token 已清空，但 Endpoint / 模型标签仍在。
- [ ] Relay 返回包含 `stopThreshold` 等禁止字段时，前端拒绝回答并回退本地 Coach。
- [ ] Relay 断网、超时、CORS 或 HTTP 错误时不会影响训练数据和 Training Engine。
- [ ] 外部请求中不包含原始 Event Stream、Session ID、精确训练时间和修订日志。

## Phase 4.7 Relay 实机验收

- [ ] 用 `MOCK_OPENAI=1 node relay/server.mjs` 启动后，手机可从同一局域网/HTTPS 测试地址加载 PWA。
- [ ] “使用同源 Relay”可以填入 `/api/coach` 对应绝对地址。
- [ ] “检测 Relay”能显示 Relay 在线和 Mock/OpenAI 上游状态。
- [ ] 未勾选外部发送授权时无法启用外部 Coach。
- [ ] 配置 `RELAY_BEARER_TOKEN` 后，错误 Token 会收到 401；正确 Token 可调用。
- [ ] 外部 Coach 失败时 UI 能回退到本地 Coach，不丢失本地训练记录。
- [ ] 飞行模式/断网时训练主流程、历史、趋势、本地 Coach 仍可使用。
- [ ] 手机上的导出 JSON 中不包含 Relay Token 或 OpenAI API Key。

## Phase 4.8 Production / HTTPS acceptance

- [ ] Public URL loads only through HTTPS and redirects HTTP to HTTPS.
- [ ] PWA can be installed from the production hostname and relaunches in standalone mode.
- [ ] `/api/health` returns 200 and `/api/ready` returns 200.
- [ ] HSTS is present on the public response.
- [ ] Turning the network off after one successful load still allows Check-in -> Session -> Review -> History.
- [ ] Re-enabling the network restores external Coach without restarting the training app.
- [ ] Wrong Relay bearer token produces a clean Coach error/fallback without losing local state.
- [ ] Rate limiting returns 429 without crashing the app; retrying later works.
- [ ] A real external Coach response never changes Stop/Resume threshold or training week.
- [ ] Closing/reopening the PWA clears the Relay token field.
- [ ] Exported JSON contains no `OPENAI_API_KEY`, Relay bearer token, raw server logs, or Docker secret path.
- [ ] Android Chrome: swipe, long-press, vibration and background/pause behavior are acceptable.
- [ ] iOS Safari/PWA (if supported target): gesture handling and offline cache behavior are acceptable.
