/**
 * 存档迁移 —— 把旧 Godot 原型（SAVE_VERSION 5）的 save.json 转成新领域格式。
 *
 * 关键点：旧存档字段为 snake_case，且沿用有误导性的 pop/morale 命名；
 * 新领域模型用 camelCase + publicSupport/militaryMorale。
 * 迁移必须无损，且对缺省字段做与旧 _backfill_province 一致的回填。
 *
 * 本模块是纯函数，不接触文件系统，便于用真实存档做单测。
 */

import { MAX_ACTIONS, SAVE_VERSION, START_YEAR } from '../domain/constants.ts'
import { initialPoliticalTask, normalizeMinister, normalizeProvince, quarterKey } from '../domain/state.ts'
import type { GameState, PendingAction, PoliticalTask, Stage, Solution } from '../domain/types.ts'
import { STAGES } from '../domain/types.ts'

export interface SaveFile {
  version: number
  state: GameState
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** 迁移旧任务记录（snake_case -> camelCase）。 */
function migrateTask(raw: unknown): PoliticalTask | null {
  if (!isRecord(raw)) return null
  const id = str(raw['id'])
  if (id === '') return null
  return {
    id,
    title: str(raw['title']),
    description: str(raw['description']),
    origin: str(raw['origin']),
    parentTaskId: str(raw['parent_task_id']),
    continuationReason: str(raw['continuation_reason']),
    status: (['active', 'completed', 'failed', 'superseded'] as const).includes(
      str(raw['status']) as PoliticalTask['status'],
    )
      ? (str(raw['status']) as PoliticalTask['status'])
      : 'active',
    priority: str(raw['priority'], 'normal'),
    createdQuarter: str(raw['created_quarter']),
    updatedQuarter: str(raw['updated_quarter']),
    progress: num(raw['progress'], 0),
    obstacles: arr(raw['obstacles']).map((o) => String(o)),
    requiredDialogue: Boolean(raw['required_dialogue']),
    evidenceRefs: arr(raw['evidence_refs']).map((e) => String(e)),
    solutionCandidates: arr(raw['solution_candidates']) as Solution[],
    selectedSolutionId: str(raw['selected_solution_id']),
    continuation: str(raw['continuation']),
    completionReason: str(raw['completion_reason']),
    nextObjective: raw['next_objective'] === undefined ? undefined : str(raw['next_objective']),
  }
}

/** 迁移旧圣旨。 */
function migrateEdict(raw: unknown) {
  if (!isRecord(raw)) return null
  const edictId = str(raw['edict_id'])
  if (edictId === '') return null
  return {
    edictId,
    quarter: str(raw['quarter']),
    dateOrder: num(raw['date_order'], 0),
    date: str(raw['date']),
    text: str(raw['text']),
    taskIds: arr(raw['task_ids']).map(String),
    solutionId: str(raw['solution_id']),
    sourceDialogueIds: arr(raw['source_dialogue_ids']).map(String),
    sourceDebateId: str(raw['source_debate_id']),
    isSettlementEdict: Boolean(raw['is_settlement_edict']),
    status: 'issued' as const,
  }
}

/** 迁移待执行行动（旧记录为 {type, ...} 的松散字典）。 */
function migratePendingAction(raw: unknown): PendingAction | null {
  if (!isRecord(raw)) return null
  const type = str(raw['type'])
  switch (type) {
    case 'policy':
      return { type: 'policy', id: str(raw['id']) as PendingAction extends { id: infer I } ? I : never, provinceId: str(raw['province_id']), cost: num(raw['cost'], 0) } as PendingAction
    case 'appoint':
      return { type: 'appoint', position: str(raw['position']) as never, ministerId: str(raw['minister_id']) }
    case 'dismiss':
      return { type: 'dismiss', position: str(raw['position']) as never, ministerId: str(raw['minister_id']) }
    case 'battle':
      return { type: 'battle', source: str(raw['source']), target: str(raw['target']), troops: num(raw['troops'], 0), generalId: str(raw['general_id']) }
    case 'move_troops':
      return { type: 'move_troops', source: str(raw['source']), target: str(raw['target']), troops: num(raw['troops'], 0) }
    default:
      return null
  }
}

/** 把旧存档（version 5）迁移为新的 SaveFile。 */
export function migrateGodotSave(raw: unknown): SaveFile {
  if (!isRecord(raw)) throw new Error('存档不是 JSON 对象')

  const version = num(raw['version'], 0)
  if (version > SAVE_VERSION) {
    throw new Error(`存档版本 ${version} 高于当前支持的 ${SAVE_VERSION}`)
  }

  const year = num(raw['year'], START_YEAR)
  const quarter = num(raw['quarter'], 1)

  const provinces = arr(raw['provinces']).map((p) => {
    if (!isRecord(p)) throw new Error('存档省份记录非法')
    return normalizeProvince({
      id: str(p['id']),
      name: str(p['name']),
      map_name: str(p['map_name'], str(p['name'])),
      historical_scope: str(p['historical_scope']),
      owner: str(p['owner'], 'ming'),
      tax: num(p['tax'], 0),
      garrison: num(p['garrison'], 0),
      pop: num(p['pop'], 55),
      morale: num(p['morale'], 55),
      fort: num(p['fort'], 2),
      adj: arr(p['adj']).map(String),
    })
  })
  if (provinces.length === 0) throw new Error('存档没有任何省份')

  const ministers = arr(raw['ministers']).map((m) => {
    if (!isRecord(m)) throw new Error('存档大臣记录非法')
    return normalizeMinister(m as never)
  })

  const pool = arr(raw['pool']).map((m) => normalizeMinister((isRecord(m) ? m : {}) as never))

  let tasks = arr(raw['political_tasks'])
    .map(migrateTask)
    .filter((t): t is PoliticalTask => t !== null)
  if (tasks.length === 0) tasks = [initialPoliticalTask(quarterKey(year, quarter))]

  const rawAppointments = isRecord(raw['appointments']) ? raw['appointments'] : {}
  const appointments: GameState['appointments'] = {}
  for (const [pos, mid] of Object.entries(rawAppointments)) {
    if (typeof mid === 'string' && mid !== '') appointments[pos as keyof GameState['appointments']] = mid
  }

  const stageRaw = str(raw['stage'], 'morning_court')
  const stage: Stage = (STAGES as readonly string[]).includes(stageRaw) ? (stageRaw as Stage) : 'morning_court'

  const state: GameState = {
    year,
    month: num(raw['month'], (quarter - 1) * 3 + 1),
    day: num(raw['day'], 1),
    quarter,
    quarterDay: num(raw['quarter_day'], 1),
    treasury: num(raw['treasury'], 120),
    courtStability: num(raw['court_stability'], 50),
    rebelPower: num(raw['rebel_power'], 20),
    jinPower: num(raw['jin_power'], 45),
    actionsLeft: num(raw['actions_left'], MAX_ACTIONS),
    gameEnded: Boolean(raw['game_ended']),
    victory: Boolean(raw['victory']),

    provinces,
    ministers,
    pool,
    appointments,
    firedOnce: arr(raw['fired_once']).map(String),
    historicalChoices: isRecord(raw['historical_choices']) ? Object.fromEntries(Object.entries(raw['historical_choices']).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {},
    taxCutMonths: num(raw['tax_cut_months'], 0),
    history: arr(raw['history']).map(String),

    pendingActions: arr(raw['pending_actions'])
      .map(migratePendingAction)
      .filter((a): a is PendingAction => a !== null),
    currentQuarterBulletins: arr(raw['current_quarter_bulletins']) as GameState['currentQuarterBulletins'],
    currentQuarterDialogues: arr(raw['current_quarter_dialogues']) as GameState['currentQuarterDialogues'],
    currentQuarterDebates: arr(raw['current_quarter_debates']) as GameState['currentQuarterDebates'],
    currentQuarterDecisions: arr(raw['current_quarter_decisions']) as Solution[],
    quarterEdicts: arr(raw['quarter_edicts'])
      .map(migrateEdict)
      .filter((e): e is NonNullable<typeof e> => e !== null),
    quarterSummaries: arr(raw['quarter_summaries']).map(String),
    quarterReports: arr(raw['quarter_reports']) as GameState['quarterReports'],

    politicalTasks: tasks,
    quarterTaskSnapshot: arr(raw['quarter_task_snapshot'])
      .map(migrateTask)
      .filter((t): t is PoliticalTask => t !== null),
    stage,
    simulationInFlight: false,
    bulletinInFlight: false,
    lastAiResult: isRecord(raw['last_ai_result']) ? raw['last_ai_result'] : {},
    lastAiValidation: isRecord(raw['last_ai_validation']) ? raw['last_ai_validation'] : {},
    aiError: str(raw['ai_error']),
  }

  if (state.quarterTaskSnapshot.length === 0) {
    state.quarterTaskSnapshot = structuredClone(state.politicalTasks)
  }

  return { version: SAVE_VERSION, state }
}

/** 序列化存档。 */
export function serializeSave(state: GameState): string {
  const file: SaveFile = { version: SAVE_VERSION, state }
  return JSON.stringify(file, null, '\t')
}

/** 反序列化存档（当前格式）。 */
export function deserializeSave(text: string): SaveFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('存档不是合法 JSON')
  }
  if (!isRecord(parsed)) throw new Error('存档不是 JSON 对象')
  // 兼容：既接受 {version, state} 新格式，也接受旧 Godot 扁平格式
  if (isRecord(parsed['state'])) {
    const state = parsed['state'] as unknown as GameState
    return { version: num(parsed['version'], SAVE_VERSION), state }
  }
  return migrateGodotSave(parsed)
}
