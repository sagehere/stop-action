(() => {
  'use strict';
  const version = '1.0.0', checkedAt = '2026-10-03';
  const sources = {
    eau: { title:'EAU Sexual and Reproductive Health — Disorders of Ejaculation', institution:'European Association of Urology', year:2026, url:'https://uroweb.org/guidelines/sexual-and-reproductive-health/chapter/disorders-of-ejaculation', supports:'心理教育、行为方法和正念可用于辅助；单独干预证据有限，长期效果不确定。' },
    nhs: { title:'Ejaculation problems', institution:'NHS', year:null, url:'https://www.nhs.uk/conditions/ejaculation-problems/', supports:'介绍动停方法；持续困扰需要专业评估。' },
    breath: { title:'Breathing exercises for stress', institution:'NHS', year:2026, url:'https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/', supports:'舒适、温和、不强迫的呼吸练习用于压力管理，不能外推为射精控制疗效。' },
    pelvic: { title:'Male Pelvic Floor Exercises', institution:'University Hospitals Sussex NHS Foundation Trust', year:null, url:'https://www.uhsussex.nhs.uk/resources/male-pelvic-floor-exercises/', supports:'识别肌肉、保持呼吸、避免臀部腹部大腿代偿；资料主要面向尿控，不移植训练剂量。' },
    pain: { title:'Male Chronic Pelvic Pain', institution:'Cambridge University Hospitals NHS Foundation Trust', year:2021, url:'https://media.cuh.nhs.uk/documents/Male_chronic_pelvic_pain_v3_Nov_2021.pdf', supports:'放松和协调同样重要，避免向下用力；疼痛情境需要个别评估。' },
    trial: { title:'Vibrator-Assisted Start–Stop Exercises Improve Premature Ejaculation Symptoms: A Randomized Controlled Trial', institution:'Ventus et al., Archives of Sexual Behavior', year:2020, url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC7300103/', supports:'六周、器械辅助的动停研究；不等同于本应用的4/8/12周安排。' },
    rehab: { title:'Pelvic floor muscle rehabilitation for patients with lifelong premature ejaculation', institution:'Pastore et al., Therapeutic Advances in Urology', year:2014, url:'https://pubmed.ncbi.nlm.nih.gov/24883105/', supports:'12周专业康复包含生物反馈和电刺激；不能把研究结果作为App自练疗效。' }
  };
  Object.values(sources).forEach(source => source.checkedAt = checkedAt);
  const modules = {
    breathing: { short:'让呼吸温和、自然地流动；不憋气，也不强迫吸得更深。', detail:'找一个舒适姿势。注意一两次吸气和呼气；走神后轻轻回到呼吸。计数可以不用，不追求固定节奏。', sourceIds:['breath'], limitation:'用于觉察和压力管理；本应用的时长是可编辑初始值。' },
    mindfulness_body_scan: { short:'留意下颌、肩、腹部、臀部、大腿和盆底，不评判感觉。', detail:'逐处留意紧张、温度或接触感。没有明显感觉也可以；不需要消除所有紧张，不把注意力变成强迫监控。', sourceIds:['eau','trial'], limitation:'这是产品组织的觉察练习，并非已验证的独立治疗方案。' },
    pelvic_coordination: { short:'轻柔收缩后完整放松，保持呼吸，不夹紧腹部、臀部或大腿。', detail:'只在能够辨认收缩与放松且没有不适时练习。放松不是向下推；不要反复通过中断排尿训练。无法分辨或出现疼痛时停止并寻求专业指导。', sourceIds:['pelvic','pain'], limitation:'可选协调模块；3秒/6秒及轮数为产品初始值，不是早泄治疗处方。' },
    stop_start: { short:'留意个人信号，感觉需要休息时停止刺激；舒适且可控后再继续。', detail:'等级仅用于表达当前主观感受。无需逼近不可逆的射精点，不需要追求高等级或更长时间。Stop和Resume由你确认，随时可以暂停或结束。', sourceIds:['nhs','eau','trial'], limitation:'行为方法的研究支持有限；本应用阈值、循环数和周期不是医学分界或疗效承诺。' },
    pelvic_release: { short:'保持自然呼吸，允许多余用力松开；不要向下推或屏气。', detail:'注意腹部、臀部和盆底是否仍在用力。允许感觉慢慢变化，不需要用力制造放松；不适或疼痛时结束本次练习。', sourceIds:['pain','pelvic'], limitation:'放松觉察，不用于诊断肌肉状态，也不能代替针对疼痛的评估。' }
  };
  const guidance = {
    checkin:{ text:'评分只记录今天的感受，不作诊断。明显不适时可以结束并保存，无需完成原计划。', sourceIds:['eau','pain'] },
    recovery:{ text:'恢复不需要赶时间。ART记录停止到主观回到可控水平的有效时间，不能单独说明疗效。', sourceIds:[], kind:'产品指标说明' },
    pause:{ text:'已暂停；暂停、后台和关闭期间不计入有效时长。回来后由你继续。', sourceIds:[], kind:'产品操作说明' },
    review:{ text:'记录感受即可；一次波动不代表进步或退步，不做成绩排名。', sourceIds:['eau'] },
    trend:{ text:'只比较自己的相近训练条件；样本少或计时口径不同，不作改善结论。', sourceIds:[], kind:'产品统计说明' },
    coach:{ text:'解释训练摘要，说明证据和不确定性；不诊断、不保证疗效、不修改训练参数。', sourceIds:['eau'] },
    plan:{ text:'4/8/12周是可编辑的练习组织周期。每周两次和初始循环数是产品默认值，并非经过验证的完整疗程。', sourceIds:['eau','trial','rehab'], kind:'产品安排及研究边界' }
  };
  const policy = '仅解释记录与觉察过程。0–9为个人主观量表，ART不是临床疗效指标。不得诊断或保证延长/治愈；不得建议修改阈值、周次、练习量或处方。疼痛时优先建议暂停与专业评估，不把疼痛称为正常训练反应。不把4/8/12周模板称为验证疗程，不外推专业盆底康复研究。';
  window.TrainingContent = { version, checkedAt, sources, modules, guidance, policy };
})();
