# 长期计划与数据契约

日历默认当前自然月，周一开头、固定42格；支持前后月份、年月选择、今天和日期详情。日期用本地 `YYYY-MM-DD`，日期差用UTC日期组件计算以避开夏令时小时偏移。任务计划日期与Session实际时间分别存储。已完成任务不能拖动；跨月使用「改期」，同月可拖拽，也能用按钮。

## 内置与自定义

4周：熟悉1周、动停恢复2周、复盘1周。8周：熟悉校准、稳定流程、提前识别、自主复盘，各2周。12周：校准2周、稳定4周、自主4周、巩固2周。默认每个计划周第0和第3天训练，包含呼吸3分钟、动停2循环、放松2分钟。这些均为产品初始安排，可以编辑，不增加周期就自动加量。盆底协调为可选模块。

个人模板1–52周，支持名称、每周阶段/目标、训练日、模块/数量/顺序、复制/删除/排序周、保存副本、归档及单独导入导出。启动前生成全部任务，可逐次改日期和模块。模板编辑仅改草稿。启用新主计划会暂停旧主计划；正在训练时不能切换。可以独立安排自由训练，也可将完成的自由训练关联到待练任务。

阶段由 `confirmedWeek` 控制，不由日历经过时间自动提升。未来未确认任务沿用已确认阶段，用户可确认下一阶段、重复当前阶段或暂停。漏练保留为逾期待处理，可以跳过、取消、改期或整体顺延；重排保持任务间隔，历史不移动。延长超过52周提示另存后续计划。修改运行中任务时明确选择仅本次或本次及以后未开始的安排。

## 对象与存储

| 对象 | 版本 | 字段与约定 |
|---|---|---|
| PlanTemplate | schemaVersion 1 | id/version/contentVersion/contentSnapshot/sourceIds/name/weeks；每周id/phase/goal/days/program |
| PlanInstance | schemaVersion 1 | 稳定id、name、不可共享模板快照、startDate、status、confirmedWeek、confirmations、完整tasks |
| ScheduleItem | schemaVersion 1 | 稳定id、planId、weekIndex、date、originalDate、programSnapshot、status、completedSessionId；单次编辑标记userEdited |
| Session | schemaVersion 5 | 旧字段兼容，增加longPlanId/scheduleItemId/contentVersion/guidanceSnapshot/clockVersion/checkpointAt |
| 完整备份 | version 3 | ec-training-backup，sessions/meta；加密外壳独立version 1 |

任务状态：PLANNED/COMPLETED/SKIPPED/CANCELLED；逾期待处理是过去日期的PLANNED显示状态。休息日不是漏练。主计划状态ACTIVE/PAUSED/ARCHIVED，同时只有一个ACTIVE主计划；自由安排容器独立。

继续使用现有IndexedDB sessions/kv仓库。kv增加longTemplates/longPlans/activeLongPlanId/acceptedParameters/parameterHistory等键。`importData`单事务写两仓库；`completeSession`同一事务写Session、更新计划并清除当前训练，重复保存同一ID幂等。失败不部分提交。

状态与有效时钟见training-core.js；日期/模板纯逻辑见plans.js；日历和编辑交互见plan-ui.js；内容见content.js；备份协议见backup.js。app.js保留训练UI、指标规则和Coach适配。外部Coach仅收最小化汇总，主观量表、ART和统计规则不代表临床指标。
