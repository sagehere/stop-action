# v2.0.0 发布验证记录

日期：2026-10-03。代码与发布工作流已在工作区实现；尚未推送标签、发布镜像或更改真实部署。

| 检查 | 结果与环境 |
|---|---|
| Node逻辑、运行时、Relay/上游/Redis/代理契约 | Windows已通过；`npm run qa` |
| 静态资源拒绝、非法编码、无密钥核心就绪 | Windows已通过；敏感路径404、非法编码400、核心200、Coach503 |
| 月历、1/4/8/12/52周、闰年、跨年、夏令时边界 | 已通过；默认时区、America/New_York、Asia/Shanghai |
| 偶数中位数、有效时钟、检查点、计时跳跃 | 纯逻辑已通过 |
| 加密往返、错误密码、篡改、冲突与未知版本 | 已通过；PBKDF2/AES-GCM原生实现 |
| Chromium浏览器完整流程 | Windows Edge/Chromium，390×844，已通过：逐次编辑预览与模板隔离、训练、ART扣除暂停、写入失败重试、手势/按钮、后台事件处理、备份、事务中断、恢复、离线 |
| WebKit浏览器完整流程 | Windows Playwright WebKit通过训练、计划、备份、原子回滚、恢复；缓存重载测试改为停止测试服务器，验证无缓存页面访问失败、Service Worker响应、API不可用及本地保存。没有跳过该项；仍不能代替真实iPhone断网验收 |
| 历史版本恢复 | 已通过；真实旧提交 `f517cc93c1aa7dc4a847d9911e3da320186c7398` 的HTML/app/db，隔离数据库恢复v2与明文v3，Session逐字段一致 |
| Linux QA/Chromium/WebKit | 首次远程CI的Windows/Linux QA及Linux Chromium通过；Linux WebKit在离线模拟处失败。修复后的Linux完整流程结果待新CI确认 |
| Android Chrome / iPhone Safari与安装PWA | 待实机验收；桌面移动尺寸不是实机结果 |
| 容器构建、旧镜像拉取、服务器摘要回退 | 待部署环境验收；已验证客户端历史版本恢复，未声称容器回退通过 |

`tests/browser.cjs`使用真实浏览器和IndexedDB；后台事件测试仅模拟visibilitychange处理，不能代替操作系统锁屏/杀进程。测试生成备份与截图位于忽略的test-results目录，不进入Git或镜像。脚本不访问用户真实训练数据库。

2026-10-03首次Linux CI的WebKit步骤在 `setOffline(true)` 后重载失败。这符合Playwright已确认的[上游问题#42775](https://github.com/microsoft/playwright/issues/42775)：离线模拟会提前阻止本应由Service Worker处理的请求。Chromium继续检查浏览器断网模拟；WebKit改为停止本地测试服务器，且使用禁用Service Worker的全新上下文作为失败对照。服务器不可用与设备全局断网不同，真实手机仍待验收。修复后的远程CI结果另行核对，不将测试环境缺陷改写为产品故障。

发布工作流在Windows/Linux跑逻辑与契约QA，Linux跑Chromium和WebKit，通过后才构建并推送amd64/arm64镜像。Dockerfile只复制运行时前端资源和Relay，不复制部署目录、测试、文档或密钥。Relay只提供公开前端白名单。

发布前仍须：完成真实手机清单、确认首次CI与容器QA、保留上一版本镜像digest和迁移前备份、在隔离部署演练回退；未验收项不得标为通过。客户端恢复流程见MIGRATION_AND_BACKUP.md。

## 可重复命令

```sh
npm ci
npm run qa
npx playwright install chromium webkit
npm run test:browser
# Linux/macOS
BROWSER=webkit npm run test:browser
# 使用保留旧提交实际验证恢复，需本地Git含该提交
node tests/rollback.cjs f517cc93c1aa7dc4a847d9911e3da320186c7398
```

PowerShell使用 `$env:BROWSER='webkit'` 然后运行浏览器测试，执行后移除该环境变量。若使用系统Edge，可传channel：`node tests/browser.cjs playwright msedge`。浏览器只能使用本机实际安装的channel。
