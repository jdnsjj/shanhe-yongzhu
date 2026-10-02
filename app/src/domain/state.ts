/**
 * 世界状态初始化与查询 —— 纯 TypeScript。
 * 移植自 scripts/game_state.gd 的初始化与查询部分。
 */

import { MAX_ACTIONS, START_YEAR } from './constants.ts'
import type {
  GameState,
  Minister,
  MinisterStat,
  PoliticalTask,
  Province,
} from './types.ts'

/** data/provinces.json 的原始形状（snake_case + 旧字段名）。 */
interface RawProvince {
  id: string
  name: string
  map_name?: string
  historical_scope?: string
  owner: string
  tax: number
  garrison: number
  pop: number
  morale: number
  fort?: number
  pos?: number[]
  adj?: string[]
}

interface RawMinister {
  id: string
  name: string
  title?: string
  faction?: string
  politics?: number
  command?: number
  wisdom?: number
  loyalty?: number
  ambition?: number
  traits?: string[]
  desc?: string
  persona?: string
}

interface RawMinisterFile {
  court?: RawMinister[]
  pool?: RawMinister[]
}

/** 把原始省份记录规范化为领域对象，并回填缺省字段（对应 _backfill_province）。 */
export function normalizeProvince(raw: RawProvince): Province {
  return {
    id: raw.id,
    name: raw.name,
    mapName: raw.map_name ?? raw.name,
    historicalScope: raw.historical_scope ?? '',
    owner: raw.owner as Province['owner'],
    tax: raw.tax,
    garrison: raw.garrison,
    // 旧字段 pop 语义为「民心」，morale 语义为「军心」
    publicSupport: raw.pop ?? 55,
    militaryMorale: raw.morale ?? 55,
    fort: raw.fort ?? 2,
    adjacent: raw.adj ?? [],
  }
}

export function normalizeMinister(raw: RawMinister): Minister {
  return {
    id: raw.id,
    name: raw.name,
    title: raw.title ?? '',
    faction: (raw.faction ?? '中立') as Minister['faction'],
    politics: raw.politics ?? 50,
    command: raw.command ?? 50,
    wisdom: raw.wisdom ?? 50,
    loyalty: raw.loyalty ?? 50,
    ambition: raw.ambition ?? 50,
    traits: raw.traits ?? [],
    desc: raw.desc ?? '',
    persona: raw.persona ?? raw.desc ?? '',
  }
}

/** 开局根任务（对应 _initial_political_task）。 */
export function initialPoliticalTask(quarterKey: string): PoliticalTask {
  return {
    id: 'succession_crisis',
    title: '新帝继位与朝局定鼎',
    description:
      '天启帝驾崩，崇祯帝初即大位。魏忠贤及阉党余势未清，百官观望，需先稳定朝局并确立新政方向。',
    origin: '天启帝驾崩、崇祯帝继位',
    parentTaskId: '',
    continuationReason: '开局根任务',
    status: 'active',
    priority: 'critical',
    createdQuarter: quarterKey,
    updatedQuarter: quarterKey,
    progress: 0,
    obstacles: ['阉党余势', '百官观望', '钱粮军务积弊'],
    requiredDialogue: true,
    evidenceRefs: [],
    solutionCandidates: [],
    selectedSolutionId: '',
    continuation: '需经大臣召对或朝会，形成可执行方案。',
    completionReason: '',
  }
}

export function quarterKey(year: number, quarter: number): string {
  return `${String(year).padStart(4, '0')}-Q${quarter}`
}

/** 创建新局。传入已解析的省份与大臣数据。 */
export function createNewGame(provinces: Province[], court: Minister[], pool: Minister[]): GameState {
  const ministers = court.map((m) => ({ ...m }))
  const initialQuarter = quarterKey(START_YEAR, 1)
  const task = initialPoliticalTask(initialQuarter)

  const state: GameState = {
    year: START_YEAR,
    month: 1,
    day: 1,
    quarter: 1,
    quarterDay: 1,
    treasury: 120,
    courtStability: 50,
    rebelPower: 20,
    jinPower: 45,
    actionsLeft: MAX_ACTIONS,
    gameEnded: false,
    victory: false,

    provinces: provinces.map((p) => ({ ...p })),
    ministers,
    pool: pool.map((m) => ({ ...m })),
    appointments: {},
    firedOnce: [],
    historicalChoices: {},
    taxCutMonths: 0,
    history: [],

    pendingActions: [],
    currentQuarterBulletins: [],
    currentQuarterDialogues: [],
    currentQuarterDebates: [],
    currentQuarterDecisions: [],
    quarterEdicts: [],
    quarterSummaries: [],
    quarterReports: [],

    politicalTasks: [task],
    quarterTaskSnapshot: [structuredClone(task)],
    stage: 'morning_court',
    simulationInFlight: false,
    bulletinInFlight: false,
    lastAiResult: {},
    lastAiValidation: {},
    aiError: '',
  }

  // 开局任命：首辅取首位朝臣，户部/兵部各取对应属性最优者（对应 new_game 逻辑）
  if (ministers.length > 0) {
    state.appointments.shoufu = ministers[0]!.id
    const hubu = bestOf(state, 'politics')
    const bingshi = bestOf(state, 'command')
    if (hubu) state.appointments.hubu = hubu.id
    if (bingshi) state.appointments.bingshi = bingshi.id
  }

  state.history.push(
    '天启帝驾崩，信王朱由检入继大统，改元崇祯。新帝初登大宝，内有阉党余势，外有边患与流民。',
  )
  state.history.push(
    '本季度时政任务：先定继位之局，再寻可行之策。凡决策须经召对或朝会，提交后交由 AI 推演。',
  )

  return state
}

/** 取某属性最高的大臣。 */
export function bestOf(state: GameState, stat: MinisterStat): Minister | undefined {
  if (state.ministers.length === 0) return undefined
  return [...state.ministers].sort((a, b) => b[stat] - a[stat])[0]
}

/** 当前控制者为我方的省份。 */
export function mingProvinces(state: GameState): Province[] {
  return state.provinces.filter((p) => p.owner === 'ming')
}

/** 全国平均民心（按税基加权，对应 avg_pop）。 */
export function averagePublicSupport(state: GameState): number {
  const list = mingProvinces(state)
  if (list.length === 0) return 0
  let weightSum = 0
  let sum = 0
  for (const p of list) {
    const w = Math.max(p.tax, 1)
    weightSum += w
    sum += p.publicSupport * w
  }
  return sum / weightSum
}

/** 全国平均军心（按兵力加权，对应 avg_morale）。 */
export function averageMilitaryMorale(state: GameState): number {
  const list = mingProvinces(state)
  if (list.length === 0) return 0
  let weightSum = 0
  let sum = 0
  for (const p of list) {
    const w = Math.max(p.garrison, 1)
    weightSum += w
    sum += p.militaryMorale * w
  }
  return sum / weightSum
}

export function dateText(state: GameState): string {
  return `崇祯${state.year - 1626}年 · 第${state.quarter}季度`
}

export function activeTasks(state: GameState): PoliticalTask[] {
  return state.politicalTasks.filter((t) => t.status === 'active')
}

export function taskById(state: GameState, taskId: string): PoliticalTask | undefined {
  return state.politicalTasks.find((t) => t.id === taskId)
}

export function ministerById(state: GameState, id: string): Minister | undefined {
  return state.ministers.find((m) => m.id === id)
}

export function positionOf(state: GameState, ministerId: string): string {
  for (const [pos, mid] of Object.entries(state.appointments)) {
    if (mid === ministerId) return pos
  }
  return ''
}

/** 解析省份数据文件。 */
export function parseProvinces(raw: unknown): Province[] {
  if (!Array.isArray(raw)) throw new Error('provinces.json 必须是数组')
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null) throw new Error(`provinces[${i}] 不是对象`)
    const p = item as RawProvince
    if (typeof p.id !== 'string' || p.id === '') throw new Error(`provinces[${i}] 缺少 id`)
    return normalizeProvince(p)
  })
}

/** 解析大臣数据文件。 */
export function parseMinisters(raw: unknown): { court: Minister[]; pool: Minister[] } {
  if (typeof raw !== 'object' || raw === null) throw new Error('ministers.json 必须是对象')
  const file = raw as RawMinisterFile
  return {
    court: (file.court ?? []).map(normalizeMinister),
    pool: (file.pool ?? []).map(normalizeMinister),
  }
}
