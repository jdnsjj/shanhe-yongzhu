/**
 * 领域类型 —— 纯 TypeScript，不依赖任何浏览器或 Tauri API。
 *
 * 命名修正（相对旧 GDScript 的历史遗留）：
 *   旧 Province.pop    -> 实际语义是「民心」  -> 新字段 publicSupport
 *   旧 Province.morale -> 实际语义是「军心」  -> 新字段 militaryMorale
 * 旧存档字段名在 persist/migrate.ts 中做双向映射，玩法数值不受影响。
 */

import type { Faction, Owner, PolicyId, PositionId } from './constants.ts'

/** 地理区块（明代一级行政区）。 */
export interface Province {
  id: string
  name: string
  mapName: string
  /** 历史口径说明，用于事件文本与后续府州县级细化时追溯来源。 */
  historicalScope: string
  owner: Owner
  /** 税基权重（非银两绝对值）。 */
  tax: number
  /** 驻军兵力，单位为万。 */
  garrison: number
  /** 民心，0-100（旧字段 pop）。 */
  publicSupport: number
  /** 军心，0-100（旧字段 morale）。 */
  militaryMorale: number
  /** 城防等级，0-6。 */
  fort: number
  /** 相邻区块 ID。 */
  adjacent: string[]
}

/** 大臣。 */
export interface Minister {
  id: string
  name: string
  title: string
  faction: Faction
  politics: number
  command: number
  wisdom: number
  loyalty: number
  ambition: number
  traits: string[]
  desc: string
  /** 大模型扮演该人物时的人格设定。 */
  persona: string
}

/** 大臣属性键（用于「择最优者」等计算）。 */
export type MinisterStat = 'politics' | 'command' | 'wisdom' | 'loyalty' | 'ambition'

/** 时政任务。 */
export interface PoliticalTask {
  id: string
  title: string
  description: string
  origin: string
  parentTaskId: string
  continuationReason: string
  status: 'active' | 'completed' | 'failed' | 'superseded'
  priority: string
  createdQuarter: string
  updatedQuarter: string
  progress: number
  obstacles: string[]
  requiredDialogue: boolean
  evidenceRefs: string[]
  solutionCandidates: Solution[]
  selectedSolutionId: string
  continuation: string
  completionReason: string
  nextObjective?: string
}

/** 玩家已采纳的政务方案。id 可在采纳时由系统生成，故为可选。 */
export interface Solution {
  id?: string
  taskId?: string
  quarter?: string
  title?: string
  summary?: string
  accepted?: boolean
  acceptedDate?: string
  [key: string]: unknown
}

/** 奏折（季度重要奏报，仅作议事证据，不改数值）。 */
export interface Bulletin {
  id: string
  title?: string
  content?: string
  [key: string]: unknown
}

/** 召对记录。 */
export interface DialogueRecord {
  id: string
  quarter: string
  taskId: string
  ministerId: string
  messages: ChatMessage[]
  summary: string
  date: string
}

/** 朝会记录。 */
export interface DebateRecord {
  id: string
  quarter: string
  taskId: string
  ministerIds: string[]
  transcript: ChatMessage[]
  summary: string
  solutionCandidates: Solution[]
  date: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** 已颁布的正式圣旨。 */
export interface Edict {
  edictId: string
  quarter: string
  dateOrder: number
  date: string
  text: string
  taskIds: string[]
  solutionId: string
  sourceDialogueIds: string[]
  sourceDebateId: string
  isSettlementEdict: boolean
  status: 'issued'
}

/** 玩家提交的待推演行动（政策 / 任命 / 调兵 / 出兵）。 */
export type PendingAction =
  | { type: 'policy'; id: PolicyId; provinceId: string; cost: number }
  | { type: 'appoint'; position: PositionId; ministerId: string }
  | { type: 'dismiss'; position: PositionId; ministerId: string }
  | { type: 'battle'; source: string; target: string; troops: number; generalId: string }
  | { type: 'move_troops'; source: string; target: string; troops: number }

/** 季度事务阶段。 */
export const STAGES = [
  'morning_court',
  'bulletin_review',
  'private_audience',
  'court_debate',
  'solution_review',
  'edict_drafting',
  'quarter_final_edict',
  'quarter_settlement',
  'quarter_report',
] as const

export type Stage = (typeof STAGES)[number]

/** 季度报告（落库后的可见反馈）。 */
export interface QuarterReport {
  quarter: string
  narrative: string
  quarterSummary: string
  treasury: Record<string, unknown>
  events: QuarterEvent[]
  battles: Battle[]
  taskUpdates: TaskUpdate[]
  edicts: Edict[]
  validation: Record<string, unknown>
  endEvaluation: Record<string, unknown>
}

export interface QuarterEvent {
  id: string
  narrative: string
  title?: string
  choices?: Array<{ id: string; label: string }>
  [key: string]: unknown
}

export type BattleOutcome = 'attacker_win' | 'defender_win' | 'stalemate'

export interface Battle {
  source: string
  target: string
  outcome: BattleOutcome
  [key: string]: unknown
}

export interface TaskUpdate {
  taskId: string
  status: PoliticalTask['status']
  progress?: number
  resolution?: string
  completionReason?: string
  continuation?: string
  nextObjective?: string
  obstacles?: string[]
  edictRefs?: string[]
}

/** AI 推演的原子效果。 */
export interface AiEffect {
  target: string
  field: string
  delta: number | string
  reason?: string
}

/** AI 季度推演结果（协议 schema_version = 1）。 */
export interface QuarterResult {
  schemaVersion: number
  quarterSummary: string
  narrative: string
  treasury: { delta?: number; [key: string]: unknown }
  effects: AiEffect[]
  events: QuarterEvent[]
  battles: Battle[]
  taskUpdates: TaskUpdate[]
  nextQuarterTasks: PoliticalTask[]
  endEvaluation: { status: 'ongoing' | 'victory' | 'defeat'; reason?: string }
  validation?: { ok?: boolean }
}

/** 全局游戏状态。 */
export interface GameState {
  year: number
  month: number
  day: number
  quarter: number
  quarterDay: number
  treasury: number
  courtStability: number
  rebelPower: number
  jinPower: number
  actionsLeft: number
  gameEnded: boolean
  victory: boolean

  provinces: Province[]
  ministers: Minister[]
  pool: Minister[]
  appointments: Partial<Record<PositionId, string>>
  firedOnce: string[]
  historicalChoices: Record<string, string>
  taxCutMonths: number
  history: string[]

  pendingActions: PendingAction[]
  currentQuarterBulletins: Bulletin[]
  currentQuarterDialogues: DialogueRecord[]
  currentQuarterDebates: DebateRecord[]
  currentQuarterDecisions: Solution[]
  quarterEdicts: Edict[]
  quarterSummaries: string[]
  quarterReports: QuarterReport[]

  politicalTasks: PoliticalTask[]
  quarterTaskSnapshot: PoliticalTask[]
  stage: Stage
  simulationInFlight: boolean
  bulletinInFlight: boolean
  lastAiResult: Record<string, unknown>
  lastAiValidation: Record<string, unknown>
  aiError: string
}

/** 季度推演入参（提交给 AI 的本季度全部议事证据）。 */
export interface QuarterInputs {
  bulletins: Bulletin[]
  dialogues: DialogueRecord[]
  debates: DebateRecord[]
  decisions: Solution[]
  pendingActions: PendingAction[]
  summaries: string[]
}
