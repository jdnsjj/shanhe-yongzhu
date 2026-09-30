/**
 * 领域层常量 —— 与引擎无关的纯 TypeScript。
 *
 * 数值逐字移植自旧 Godot 原型 scripts/game_state.gd，重构期不得改动，
 * 以保证推演语义与既有存档一致。
 */

/** 存档结构版本。旧 Godot 原型为 5，新实现沿用同一版本线以便迁移。 */
export const SAVE_VERSION = 5

/** AI 季度推演协议版本（旧 game_state.gd: schema_version == 1）。 */
export const AI_SCHEMA_VERSION = 1

export const START_YEAR = 1627
export const END_YEAR = 1644
export const MAX_ACTIONS = 3

/** 六部尚书与内阁首辅。stat 指向用于季度效果的大臣属性。 */
export const POSITIONS = {
  shoufu: { name: '内阁首辅', stat: 'politics', desc: '执掌票拟：每季度朝堂稳定随其治政提升' },
  hubu: { name: '户部尚书', stat: 'politics', desc: '执掌天下钱粮：税收随其治政提升' },
  bingshi: { name: '兵部尚书', stat: 'command', desc: '执掌兵马：每季度各镇军心随其统率提升' },
  lijun: { name: '吏部尚书', stat: 'wisdom', desc: '执掌铨选：每季度百官忠诚小幅回升' },
  gongbu: { name: '工部尚书', stat: 'politics', desc: '执掌营造：每隔数月修缮一处城防' },
  xingbu: { name: '刑部尚书', stat: 'wisdom', desc: '执掌刑名：每季度朝堂稳定小幅回升' },
} as const

export type PositionId = keyof typeof POSITIONS

/** 方略。cost 单位为万两。 */
export const POLICIES = {
  jianmian: { name: '轻徭薄赋', cost: 0, target: '', desc: '通行全国：蠲免逋赋，各省民心+3；三月内税收-30%' },
  jiazheng: { name: '加派赋税', cost: 0, target: '', desc: '通行全国：加征三饷，得银80万两；各省民心-4' },
  zhenji: { name: '开仓赈灾', cost: 50, target: 'prov', desc: '择一省施行的：该省民心+15' },
  lianbing: { name: '整饬军务', cost: 40, target: 'prov', desc: '择一镇施行的：该省兵力+20%（上限30万），军心+15' },
  xiulv: { name: '修缮城防', cost: 40, target: 'prov', desc: '择一省施行的：该省城防+1（上限6）' },
  keju: { name: '开科取士', cost: 30, target: '', desc: '广纳贤才：从在野人才中擢用一位大臣' },
  zhaofu: { name: '招抚流民', cost: 35, target: 'prov', desc: '择一省施行的：该省民心+10，流寇势力-5' },
} as const

export type PolicyId = keyof typeof POLICIES

/** AI 单次效果允许的数值上限（旧 AI_EFFECT_LIMITS）。 */
export const AI_EFFECT_LIMITS = {
  treasury: 500.0,
  court_stability: 30.0,
  rebel_power: 40.0,
  jin_power: 40.0,
  pop: 30.0,
  morale: 35.0,
  garrison: 30.0,
  loyalty: 30.0,
  fort: 3.0,
} as const

/** AI 允许写入的字段（旧 AI_EFFECT_FIELDS）。 */
export const AI_EFFECT_FIELDS = [
  'treasury',
  'court_stability',
  'rebel_power',
  'jin_power',
  'pop',
  'morale',
  'garrison',
  'loyalty',
  'owner',
  'fort',
  'appointment',
  'recruit',
] as const

export type AiEffectField = (typeof AI_EFFECT_FIELDS)[number]

/** 省份控制者。 */
export const OWNERS = ['ming', 'jin', 'rebel'] as const
export type Owner = (typeof OWNERS)[number]

/** 派系。 */
export const FACTIONS = ['阉党', '东林', '浙党', '帝党', '中立'] as const
export type Faction = (typeof FACTIONS)[number]
