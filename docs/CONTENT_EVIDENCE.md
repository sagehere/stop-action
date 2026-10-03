# 内容依据与中文文案映射（v1.0.0）

核对日期：2026-10-03。运行时来源与原创中文转述以 `content.js` 为准；每条来源包含标题、机构/作者、年份（未注明时为null）、URL、核对日期和所支持结论。界面在「我的 → 依据与局限」中展示完整信息。训练中显示短提示，模块说明提供操作细节，依据页面解释适用边界。

| 来源ID | 来源 | 支持内容 | 人群与局限 |
|---|---|---|---|
| eau | [EAU射精障碍指南](https://uroweb.org/guidelines/sexual-and-reproductive-health/chapter/disorders-of-ejaculation) | 心理教育、行为方法、正念、求助边界 | 面向相关困扰的成人；行为干预证据有限，长期效果不确定 |
| nhs | [NHS射精问题](https://www.nhs.uk/conditions/ejaculation-problems/) | 动停方法的患者说明、持续困扰的评估 | 方法介绍，不保证疗效 |
| breath | [NHS压力呼吸练习](https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/) | 温和、舒适、不强迫的呼吸 | 压力管理，不能外推单独改善射精控制 |
| pelvic | [Sussex NHS男性盆底练习](https://www.uhsussex.nhs.uk/resources/male-pelvic-floor-exercises/) | 肌肉识别、避免屏气与代偿、收缩后放松 | 主要为尿控康复；不移植频率或治疗剂量 |
| pain | [CUH男性慢性盆底疼痛资料](https://media.cuh.nhs.uk/documents/Male_chronic_pelvic_pain_v3_Nov_2021.pdf) | 放松和协调、不要向下推、出现疼痛评估 | 疼痛康复资料；不诊断用户肌肉状态 |
| trial | [2020器械辅助动停随机研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC7300103/) | 展示方法、研究背景与周期差异 | 六周器械辅助、特定受试者和研究条件；不验证本应用周期 |
| rehab | [2014十二周盆底康复研究](https://pubmed.ncbi.nlm.nih.gov/24883105/) | 解释专业康复与自练的差异 | 包含生物反馈、电刺激及专业条件；结果不能作为App自练疗效 |

| 文案位置/键 | 来源映射 | 操作和设计边界 |
|---|---|---|
| breathing.short/detail | breath | 时长为可编辑产品初始值 |
| mindfulness_body_scan.short/detail | eau、trial | 扫描顺序为产品组织，不宣称独立治疗效果 |
| pelvic_coordination.short/detail | pelvic、pain | 可选；3秒/6秒、轮数不是早泄处方 |
| stop_start.short/detail | nhs、eau、trial | 主观0–9、Stop/Resume阈值与循环数属于产品记录机制 |
| pelvic_release.short/detail | pain、pelvic | 放松觉察；不用力向下推 |
| checkin、review | eau、pain | 评分用于记录；单次波动不作疗效结论 |
| recovery、pause、trend | 产品指标/操作/统计说明 | ART是有效时间内的应用恢复记录，非临床指标；暂停不计时；同条件比较 |
| coach、policy | eau及上述方法局限 | 解释摘要、不诊断、不改参数、不保证疗效 |
| plan、模板来源引用 | eau、trial、rehab | 4/8/12周是产品组织周期，每周两次、两循环为可编辑初始安排 |

首次演练、保存/恢复/错误提示、日历状态和按钮说明属于产品操作说明；数据完整性评分、规则阈值、比较窗口各至少3条属于产品统计设计，不能标注为医学分界。疼痛或明显不适时可以暂停或结束并保存；不因紧张评分高自动增加盆底收缩。

模板、执行计划和Session分别保存内容版本与快照。更新来源库不静默覆盖已经启动的计划。维护时同时更新来源映射、核对日期、内容版本和核心测试；中文使用原创转述，不整段复制来源。
