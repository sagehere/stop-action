# 实机测试数据设计

## 目标

实机测试数据用于回答产品体验问题，而不是分析用户的性生活或训练效果。例如：

- 手机上上下滑是否稳定？
- Stop 单击和 Resume 双击是否容易混淆？
- 震动是否足够清晰？
- 用户是否频繁暂停或切后台？
- 哪些浏览器能力缺失？

## 开启方式

默认关闭。用户需要在：

`我的 → 真实使用验收 → 实机测试数据`

主动点击“开启实机数据收集”。

## 收集字段

设备快照：

- App 版本
- User-Agent / platform / language
- 屏幕和 viewport 尺寸
- DPR / maxTouchPoints
- PWA standalone 状态
- IndexedDB / Vibration / Service Worker / Wake Lock / Pointer Events / File API 支持情况

交互事件：

- `SESSION_LAUNCHED`
- `CHECKIN_CONTINUED`
- `SWIPE_LEVEL_UP` / `SWIPE_LEVEL_DOWN`
- `STOP_CONFIRMED`
- `RESUME_CONFIRMED`
- `QUICK_MARKER_OPENED` / `QUICK_MARKER_SAVED`
- `SESSION_PAUSED` / `SESSION_RESUMED`
- `APP_HIDDEN_DURING_SESSION`
- `SESSION_FINISHED`
- `GESTURE_UNRECOGNIZED`
- `HAPTIC_TEST`
- `POST_SESSION_FEEDBACK`
- `ACCEPTANCE_ITEM_CHANGED`

## 明确不收集

实机测试导出不包含：

- 0–9 兴奋等级值
- Quick Marker 的具体身体信号
- 原始 Training Event Stream
- Coach 问题 / 回答
- 精确训练 Session ID（导出时重映射为 `run-001`）
- GPS / IP / 联系方式 / GitHub / OpenAI 账号信息

## 导出格式

### JSON

包含：

- 随机 installation ID
- 设备能力快照
- 验收清单
- 聚合事件计数
- 匿名化交互事件流

### CSV

每行一个 UX 事件：

```text
seq,offsetMs,run,elapsedMs,type,meta
```

`offsetMs` 是相对导出样本首事件的时间偏移；`elapsedMs` 是当前训练的活动时间。

## 数据上限

浏览器最多保留最近 2500 个测试事件，避免 Beta 期间无限增长。

## 建议测试流程

1. 打开实机数据收集。
2. 在真实手机上至少完成 3–5 次完整训练。
3. 完成“手机实机验收清单”。
4. 每次训练结束可选填写三项体验评分。
5. 导出 `stop-action-device-test-*.json`。
6. 将测试文件用于后续 UX 缺陷聚类和改进，不应与医学结论混用。
