/**
 * 季度议事阶段机 —— 移植自 game_state.gd 的 stage 流转与议事证据约束。
 *
 * 保留旧实现的核心业务规则（这些是玩法契约，不是实现细节）：
 *  - 圣旨必须关联活动任务，且该任务必须已通过召对或朝会形成对话证据
 *  - 圣旨必须来自已采纳的解决方案
 *  - 结算圣旨（isSettlementEdict）不受任务关联约束
 *  - 推演进行中禁止任何议事动作
 */

import { MAX_ACTIONS, POLICIES, POSITIONS, type PolicyId, type PositionId } from './constants.ts'
import { quarterKey } from './state.ts'
import type {
  DebateRecord,
  DialogueRecord,
  Edict,
  GameState,
  Minister,
  Solution,
  Stage,
} from './types.ts'

export type ActionResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string }

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/** 议事动作的统一前置检查。 */
function guard(state: GameState): string | null {
  if (state.simulationInFlight) return '季度推演进行中'
  return null
}

/** 记录召对（对应 record_minister_dialogue）。 */
export function recordDialogue(
  state: GameState,
  taskId: string,
  ministerId: string,
  messages: DialogueRecord['messages'],
  summary = '',
): ActionResult<{ state: GameState; id: string }> {
  const blocked = guard(state)
  if (blocked) return fail(blocked)

  const task = state.politicalTasks.find((t) => t.id === taskId)
  if (!task || task.status !== 'active') return fail('时政任务不存在或已结束')
  const minister = state.ministers.find((m) => m.id === ministerId)
  if (!minister) return fail('大臣不存在')

  const next = structuredClone(state)
  const target = next.politicalTasks.find((t) => t.id === taskId)!
  const id = `dialogue_${quarterKey(next.year, next.quarter)}_${String(next.currentQuarterDialogues.length + 1).padStart(3, '0')}`
  next.currentQuarterDialogues.push({
    id,
    quarter: quarterKey(next.year, next.quarter),
    taskId,
    ministerId,
    messages: structuredClone(messages),
    summary,
    date: `崇祯${next.year - 1626}年 · 第${next.quarter}季度`,
  })
  target.evidenceRefs.push(id)
  next.stage = 'private_audience'
  next.history.push(`【召对】${minister.name}围绕「${task.title}」提出见解。`)

  return { ok: true, value: { state: next, id } }
}

/** 记录朝会（对应 record_court_debate）。 */
export function recordDebate(
  state: GameState,
  taskId: string,
  ministerIds: string[],
  transcript: DebateRecord['transcript'],
  summary = '',
  solutionCandidates: Solution[] = [],
): ActionResult<{ state: GameState; id: string }> {
  const blocked = guard(state)
  if (blocked) return fail(blocked)

  const task = state.politicalTasks.find((t) => t.id === taskId)
  if (!task || task.status !== 'active') return fail('时政任务不存在或已结束')
  if (ministerIds.length < 2) return fail('朝会至少需要两名大臣')
  for (const mid of ministerIds) {
    if (!state.ministers.some((m) => m.id === mid)) return fail('朝会包含不存在的大臣')
  }

  const next = structuredClone(state)
  const target = next.politicalTasks.find((t) => t.id === taskId)!
  const id = `debate_${quarterKey(next.year, next.quarter)}_${String(next.currentQuarterDebates.length + 1).padStart(3, '0')}`
  next.currentQuarterDebates.push({
    id,
    quarter: quarterKey(next.year, next.quarter),
    taskId,
    ministerIds: [...ministerIds],
    transcript: structuredClone(transcript),
    summary,
    solutionCandidates: structuredClone(solutionCandidates),
    date: `崇祯${next.year - 1626}年 · 第${next.quarter}季度`,
  })
  target.evidenceRefs.push(id)
  target.solutionCandidates.push(...structuredClone(solutionCandidates))
  next.stage = 'court_debate'
  next.history.push(`【朝会】群臣围绕「${task.title}」议定一番。`)

  return { ok: true, value: { state: next, id } }
}

/** 该任务本季度是否已有对话证据（对应 has_task_dialogue）。 */
export function hasTaskDialogue(state: GameState, taskId: string): boolean {
  return (
    state.currentQuarterDialogues.some((d) => d.taskId === taskId) ||
    state.currentQuarterDebates.some((d) => d.taskId === taskId)
  )
}

/** 采纳方案（对应 accept_task_solution）。 */
export function acceptSolution(
  state: GameState,
  taskId: string,
  solution: Solution,
): ActionResult<{ state: GameState; solution: Solution }> {
  const blocked = guard(state)
  if (blocked) return fail(blocked)

  const task = state.politicalTasks.find((t) => t.id === taskId)
  if (!task || task.status !== 'active') return fail('时政任务不存在或已结束')
  if (!hasTaskDialogue(state, taskId)) return fail('必须先通过召对或朝会形成对话证据')

  const next = structuredClone(state)
  const target = next.politicalTasks.find((t) => t.id === taskId)!
  const solutionId =
    solution.id !== '' && solution.id !== undefined
      ? solution.id
      : `solution_${quarterKey(next.year, next.quarter)}_${String(next.currentQuarterDecisions.length + 1).padStart(3, '0')}`

  const record: Solution = {
    ...structuredClone(solution),
    id: solutionId,
    taskId,
    quarter: quarterKey(next.year, next.quarter),
    accepted: true,
    acceptedDate: `崇祯${next.year - 1626}年 · 第${next.quarter}季度`,
  }
  next.currentQuarterDecisions.push(record)
  target.selectedSolutionId = solutionId
  target.solutionCandidates.push(record)
  next.stage = 'solution_review'
  next.history.push(`【决策】朕已采纳「${String(record.title ?? record.summary ?? '')}」之策，候拟圣旨。`)

  return { ok: true, value: { state: next, solution: record } }
}

/** 颁布圣旨（对应 issue_edict）。 */
export function issueEdict(
  state: GameState,
  text: string,
  taskIds: string[],
  solutionId = '',
  sourceDialogueIds: string[] = [],
  sourceDebateId = '',
  isSettlementEdict = false,
): ActionResult<{ state: GameState; edict: Edict }> {
  const blocked = guard(state)
  if (blocked) return fail(blocked)

  const body = text.trim()
  if (body === '') return fail('圣旨正文不可为空')

  if (!isSettlementEdict) {
    if (taskIds.length === 0) return fail('任务圣旨必须关联时政任务')
    for (const taskId of taskIds) {
      const task = state.politicalTasks.find((t) => t.id === taskId)
      if (!task || task.status !== 'active') return fail('圣旨关联了不存在或已结束的任务')
      if (!hasTaskDialogue(state, taskId)) return fail('任务必须先经过召对或朝会')
      if (solutionId === '' || task.selectedSolutionId !== solutionId) {
        return fail('圣旨必须来自已采纳的解决方案')
      }
    }
  }

  const next = structuredClone(state)
  const edictId = `edict_${quarterKey(next.year, next.quarter)}_${String(next.quarterEdicts.length + 1).padStart(3, '0')}`
  const edict: Edict = {
    edictId,
    quarter: quarterKey(next.year, next.quarter),
    dateOrder: next.quarterEdicts.length + 1,
    date: `崇祯${next.year - 1626}年 · 第${next.quarter}季度`,
    text: body,
    taskIds: [...taskIds],
    solutionId,
    sourceDialogueIds: [...sourceDialogueIds],
    sourceDebateId,
    isSettlementEdict,
    status: 'issued',
  }
  next.quarterEdicts.push(edict)
  next.stage = isSettlementEdict ? 'quarter_final_edict' : 'edict_drafting'
  next.history.push(`【圣旨】${body}`)

  return { ok: true, value: { state: next, edict } }
}

/** 消耗一次行动机会。 */
export function spendAction(state: GameState): GameState {
  if (state.actionsLeft <= 0) return state
  const next = structuredClone(state)
  next.actionsLeft -= 1
  return next
}

/** 使用方略（对应 use_policy）。返回错误信息或 null 表示成功。 */
export function usePolicy(state: GameState, policyId: string, provinceId = ''): ActionResult<{ state: GameState }> {
  const blocked = guard(state)
  if (blocked) return fail(blocked)
  if (!(policyId in POLICIES)) return fail('无此方略')

  const policy = POLICIES[policyId as PolicyId]
  if (state.actionsLeft <= 0) return fail('本季度行动机会已用尽')
  if (policy.cost > 0 && state.treasury < policy.cost) {
    return fail(`国库存银不足（需 ${policy.cost} 万两）`)
  }

  if (policy.target === 'prov') {
    const prov = state.provinces.find((p) => p.id === provinceId)
    if (!prov || prov.owner !== 'ming') return fail('请先选择施行省份')
  }

  const next = structuredClone(state)
  next.actionsLeft -= 1
  next.pendingActions.push({ type: 'policy', id: policyId as PolicyId, provinceId, cost: policy.cost })
  const provName = provinceId ? (next.provinces.find((p) => p.id === provinceId)?.name ?? '') : ''
  next.history.push(`【诏议】拟行方略：${policy.name}${provName ? '（' + provName + '）' : ''}`)

  return { ok: true, value: { state: next } }
}

/** 任命大臣（对应 appoint）。 */
export function appointMinister(state: GameState, position: string, ministerId: string): ActionResult<{ state: GameState }> {
  const blocked = guard(state)
  if (blocked) return fail(blocked)
  if (!(position in POSITIONS)) return fail('无此官职')
  const minister = state.ministers.find((m) => m.id === ministerId)
  if (!minister) return fail('大臣不存在')
  if (state.actionsLeft <= 0) return fail('本季度行动机会已用尽')

  const next = structuredClone(state)
  next.actionsLeft -= 1
  next.pendingActions.push({ type: 'appoint', position: position as PositionId, ministerId })
  next.history.push(`【诏议】拟任${minister.name}出任${POSITIONS[position as PositionId].name}，待 AI 推演本季度朝局。`)

  return { ok: true, value: { state: next } }
}

/** 罢免（对应 dismiss）。 */
export function dismissMinister(state: GameState, position: string): ActionResult<{ state: GameState }> {
  const blocked = guard(state)
  if (blocked) return fail(blocked)
  const pos = position as PositionId
  const holder = state.appointments[pos]
  if (!holder) return fail('该官职无人担任')
  if (state.actionsLeft <= 0) return fail('本季度行动机会已用尽')

  const next = structuredClone(state)
  next.actionsLeft -= 1
  next.pendingActions.push({ type: 'dismiss', position: pos, ministerId: holder })
  next.history.push(`【诏议】拟罢${POSITIONS[pos]?.name ?? position}，待 AI 推演本季度朝局。`)

  return { ok: true, value: { state: next } }
}

/** 能否出兵（对应 can_dispatch_from）。 */
export function canDispatchFrom(source: { owner: string; adjacent: string[]; garrison: number }, target: { id: string; owner: string }): boolean {
  return (
    source.owner === 'ming' &&
    target.owner !== 'ming' &&
    source.adjacent.includes(target.id) &&
    source.garrison >= 5
  )
}

/** 出兵（对应 dispatch）。 */
export function dispatch(
  state: GameState,
  sourceId: string,
  targetId: string,
  troops: number,
  generalId: string,
): ActionResult<{ state: GameState; msg: string }> {
  if (state.simulationInFlight) return fail('本季度推演尚未完成')
  const src = state.provinces.find((p) => p.id === sourceId)
  const tgt = state.provinces.find((p) => p.id === targetId)
  if (!src || !tgt || !canDispatchFrom(src, tgt)) return fail('只能从我方相邻省份向敌占城池出兵')
  if (troops < 3 || troops > Math.trunc(src.garrison) - 2) {
    return fail(`兵力须在 3 至 ${Math.trunc(src.garrison) - 2} 万之间（需留 2 万守土）`)
  }
  if (state.actionsLeft <= 0) return fail('本季度行动机会已用尽')

  const next = structuredClone(state)
  next.actionsLeft -= 1
  next.pendingActions.push({ type: 'battle', source: sourceId, target: targetId, troops, generalId })
  next.history.push(`【军议】拟自${src.name}出兵${tgt.name}，胜负待 AI 推演。`)

  return { ok: true, value: { state: next, msg: '出兵意图已记入，提交后由 AI 推演战果。' } }
}

/** 调兵（对应 move_troops）。 */
export function moveTroops(
  state: GameState,
  sourceId: string,
  targetId: string,
  troops: number,
): ActionResult<{ state: GameState; msg: string }> {
  if (state.simulationInFlight) return fail('本季度推演尚未完成')
  const src = state.provinces.find((p) => p.id === sourceId)
  const tgt = state.provinces.find((p) => p.id === targetId)
  if (!src || !tgt || src.owner !== 'ming' || tgt.owner !== 'ming') return fail('只能在我方省份之间调兵')
  if (!src.adjacent.includes(targetId)) return fail('两地不相邻')
  if (troops < 1 || troops > Math.trunc(src.garrison) - 2) {
    return fail(`兵力须在 1 至 ${Math.trunc(src.garrison) - 2} 万之间（需留 2 万守土）`)
  }
  if (state.actionsLeft <= 0) return fail('本季度行动机会已用尽')

  const next = structuredClone(state)
  next.actionsLeft -= 1
  next.pendingActions.push({ type: 'move_troops', source: sourceId, target: targetId, troops })
  next.history.push(`【军议】拟调${troops}万兵自${src.name}移驻${tgt.name}，后果待 AI 推演。`)

  return { ok: true, value: { state: next, msg: '调防意图已记入，提交后由 AI 推演后果。' } }
}

/** 设置阶段（供 UI 推进流程）。 */
export function setStage(state: GameState, stage: Stage): GameState {
  const next = structuredClone(state)
  next.stage = stage
  return next
}

/** 招募在野人才（对应 recruit，随机取一位）。 */
export function recruitRandom(state: GameState, rand: number): ActionResult<{ state: GameState; minister: Minister }> {
  if (state.pool.length === 0) return fail('人才池已空')
  const idx = Math.min(Math.floor(rand * state.pool.length), state.pool.length - 1)
  const next = structuredClone(state)
  const minister = next.pool[idx]!
  next.pool.splice(idx, 1)
  next.ministers.push(minister)
  return { ok: true, value: { state: next, minister } }
}

/** 回合行动是否已用尽。 */
export function actionsExhausted(state: GameState): boolean {
  return state.actionsLeft <= 0
}

export { MAX_ACTIONS }
