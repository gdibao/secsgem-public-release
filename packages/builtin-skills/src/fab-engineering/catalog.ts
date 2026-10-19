import type { BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';

export interface FabSkillDefinition {
  id: string;
  name: string;
  workflow: string;
}

export const fabSkillIdentifier = (id: string) => `fab-${id.toLowerCase()}`;

export const FabEngineeringIdentifier = 'fab-engineering';

export const FabEngineeringSkill: BuiltinSkill = {
  avatar: '🏭',
  content: systemPrompt,
  description:
    'Offline semiconductor engineering workflow for the 18 fab facility and integration domains, with evidence, calculation, safety, and human-review boundaries.',
  identifier: FabEngineeringIdentifier,
  name: 'fab-engineering',
  title: '驰拓半导体工程',
  source: 'builtin',
};

export const fabSkillDefinitions: FabSkillDefinition[] = [
  [
    'S01',
    '证据、适用性与不确定性',
    '核实需求、权限和版本，引用页码，区分事实、推导、假设，缺证据停止给定值。',
  ],
  ['S02', '需求规格与边界', '明确对象、工况和排除项，编号需求，写可测验收标准，建立追溯关系。'],
  ['S03', '负荷与容量', '分类工况，核对峰均负荷、同时率、冗余、单位和敏感性，要求独立复算。'],
  ['S04', '特气工艺', '核对气体性质、纯度、供配边界、吹扫隔离和失效情景，提交安全与工艺人审。'],
  ['S05', '化学工艺与材料', '核对浓度温度、输送围护、相容性和异常工况，未知组合列出资料缺口。'],
  ['S06', '超纯水与水处理', '从原水目标到工艺段、水质负荷平衡、污染风险和监测验收逐项核对。'],
  ['S07', '废水分质与处理', '核对分质水量水质、负荷波动、处理约束、污泥副产物和排放适用性。'],
  ['S08', '真空与尾气', '核对工艺气体、压力、抽气输送、处理边界、堵塞冷凝风险和维护条件。'],
  ['S09', '洁净与暖通', '核对洁净分区、显潜热、风水量、压差、过滤、测点和工况化验收。'],
  ['S10', '配电与电源', '核对负载、容量、短路条件、保护切换和接地，标记电气专业签审项。'],
  ['S11', 'PLC 与联锁逻辑', '核对状态、I/O、时序、周期、失效位置和复位权限，使用离线用例验证。'],
  ['S12', 'DCS 过程回路', '核对过程目标、回路结构、方向、手自动、联锁和异常状态。'],
  ['S13', '测量与采样', '核对量程工况、误差、安装、信号单位、采样时标、校准和溯源。'],
  ['S14', '气体侦测', '核对对象气体、传感原理、干扰、布点、报警响应、校准维护和安全复核。'],
  ['S15', 'OT 网络与通信', '核对资产流向、协议版本、带宽时序、冗余和权限，执行离线兼容核对。'],
  [
    'S16',
    'SECS/GEM 与 Host 接口',
    '核对标准适用域、消息状态契约、标识、异常、接口测试和版本差距。',
  ],
  [
    'S17',
    '风险与安全边界',
    '识别危害、原因、后果和既有保护，记录残余风险与责任人，不代替安全认证。',
  ],
  ['S18', '图纸与空间表达', '核对图例、坐标、单位、位号、线号、引用一致性、版本和签审栏。'],
  ['S19', '安装与施工质量', '核对材料、人员、施工顺序、污染控制、停检点、记录和竣工对应关系。'],
  ['S20', '调试与性能验收', '核对准入条件、步骤、预期、异常停止、证据采集和缺陷复测。'],
  ['S21', '排障与可靠性', '整理时间线，区分事实假设，建立故障树，按低风险顺序验证并提出复发预防。'],
  ['S22', '标准适用性与映射', '核对版本效力、适用条款、工程证据和差异，不替代合规签署。'],
  ['S23', '项目、接口与变更', '核对责任、依赖、里程碑、影响分析、审批记录和交付闭环。'],
  ['S24', '估算与商务', '核对工程量、单价来源、币种税费日期、边界风险和偏差，提交商务签审。'],
  ['S25', '厂商与采购评审', '分别比较规格、供应商证据、技术商务、生命周期和交期，不越权采购。'],
  ['S26', '流体与设备选型', '核对介质、工况、压力流量曲线、材料连接、公式和余量。'],
  ['S27', '电控柜与回路', '核对电源负载、保护散热、I/O 接线、接地隔离、BOM、端子和图纸。'],
  ['S28', '运动控制', '核对负载传动、运动曲线、惯量转矩、限位制动、风险和离线用例。'],
  ['S29', '操作图控与历史数据', '核对操作任务、页面点表、报警质量码、权限时标和失联恢复行为。'],
  ['S30', 'QA/QC 与计量', '核对标准、检验点、测量有效性、记录追溯、不符合闭环和独立复核。'],
  ['S31', '培训与交付', '依据批准文件按岗位分层，设计案例考核、危险步骤复核和培训签收。'],
  ['S32', '厂商产品版本专精', '按型号、修订、固件、软件和地区过滤资料，建立兼容矩阵并核验许可。'],
].map(([id, name, workflow]) => ({ id, name, workflow }));

export const fabEngineeringSkills: BuiltinSkill[] = fabSkillDefinitions.map(
  ({ id, name, workflow }) => ({
    avatar: '🏭',
    content: [
      `# 驰拓本地技能：${name}`,
      '',
      '这是 Fab 本地离线技能。它只提供审阅、分析和可追溯交付规则，不替代工程师签审，不执行现场控制。',
      '',
      `## 工作流\n${workflow}`,
      '',
      '## 证据边界\n必须区分已检索资料、计算推导、假设和待核验项；没有真实资料或工具结果时不得声称完成。',
      '',
      '## 默认交付\n结论摘要、证据表、过程/计算、风险、未决项和下一步。',
    ].join('\n'),
    description: `${workflow} 仅使用已授权的本地知识库和本地原生工具。`,
    identifier: fabSkillIdentifier(id),
    name: `fab-${id.toLowerCase()}-${name}`,
    source: 'builtin',
    title: `FAB 专用 · ${name}`,
  }),
);
