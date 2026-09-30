/**
 * 效果应用与事务回滚 —— 移植自 game_state.gd 的
 * apply_ai_transition / _capture_transaction_state / _restore_transaction_state。
 *
 * 这是本项目最有价值的技术资产：AI 推演失败时整体回滚，绝不推进回合。
 * 采用不可变更新（D2）：所有变更返回新状态，便于快照与时间旅行调试。
 */

import { AI_EFFECT_LIMITS, MAX_ACTIONS, POSITIONS } from './constants.ts'
import { quarterKey } from './state.ts'
import type { AiEffect, GameState, QuarterResult, Stage } from './types.ts'

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** 事务快照：回滚所需的全部可变字段。 */
export interface TransactionSnapshot {
  state: GameState
  stage: Stage
}

export function captureTransaction(state: GameState): TransactionSnapshot {
  return { state: structuredClone(state), stage: state.stage }
}

export function restoreTransaction(snapshot: TransactionSnapshot): GameState {
  const restored = structuredClone(snapshot.state)
  restored.stage = snapshot.stage
  restored.simulationInFlight = false
  return restored
}

export interface ApplyResult {
  state: GameState
  applied: string[]
}

/** 应用 AI 效果（对应 apply_ai_transition）。返回新状态，不修改入参。 */
export function applyAiTransition(state: GameState, effects: AiEffect[]): ApplyResult {
  const next = structuredClone(state)
  const applied: string[] = []

  const provinceById = new Map(next.provinces.map((p) => [p.id, p]))
  const ministerById = new Map(next.ministers.map((m) => [m.id, m]))

  for (const effect of effects) {
    const target = effect.target
    const field = effect.field
    const value = effect.delta

    // 招募在野人才
    if (field === 'recruit' && target === 'global') {
      const recruitId = String(value)
      const idx = next.pool.findIndex((m) => m.id === recruitId)
      if (idx < 0) continue
      const recruited = next.pool[idx]!
      next.pool.splice(idx, 1)
      next.ministers.push(recruited)
      applied.push(`招募在野人才：${recruited.name}`)
      continue
    }

    // 省份归属变更
    if (target.startsWith('province:') && field === 'owner') {
      const prov = provinceById.get(target.slice('province:'.length))
      if (!prov) continue
      prov.owner = String(value) as typeof prov.owner
      applied.push(`${prov.name} 归属改为 ${String(value)}`)
      continue
    }

    // 官职任命
    if (target.startsWith('position:') && field === 'appointment') {
      const pos = target.slice('position:'.length) as keyof typeof POSITIONS
      if (!(pos in POSITIONS)) continue
      const mid = String(value)
      // 同一人不得同时占两职
      for (const key of Object.keys(next.appointments) as Array<keyof typeof POSITIONS>) {
        if (next.appointments[key] === mid) delete next.appointments[key]
      }
      if (mid === '') delete next.appointments[pos]
      else next.appointments[pos] = mid
      applied.push(`${POSITIONS[pos].name} 任命更新`)
      continue
    }

    const limit = AI_EFFECT_LIMITS[field as keyof typeof AI_EFFECT_LIMITS]
    const rawDelta = Number(value)
    if (!Number.isFinite(rawDelta)) continue
    const delta = limit === undefined ? rawDelta : clamp(rawDelta, -limit, limit)

    if (target === 'global') {
      switch (field) {
        case 'treasury':
          next.treasury += delta
          break
        case 'court_stability':
          next.courtStability = clamp(next.courtStability + delta, 0, 100)
          break
        case 'rebel_power':
          next.rebelPower = clamp(next.rebelPower + delta, 0, 150)
          break
        case 'jin_power':
          next.jinPower = clamp(next.jinPower + delta, 0, 120)
          break
        default:
          continue
      }
      applied.push(`全局 ${field} ${delta >= 0 ? '+' : ''}${Math.trunc(delta)}`)
      continue
    }

    if (target.startsWith('province:')) {
      const prov = provinceById.get(target.slice('province:'.length))
      if (!prov) continue
      switch (field) {
        case 'pop':
          prov.publicSupport = clamp(prov.publicSupport + delta, 0, 100)
          break
        case 'morale':
          prov.militaryMorale = clamp(prov.militaryMorale + delta, 0, 100)
          break
        case 'garrison':
          prov.garrison = clamp(prov.garrison + delta, 2, 30)
          break
        case 'fort':
          prov.fort = clamp(Math.trunc(prov.fort + Math.trunc(delta)), 0, 6)
          break
        default:
          continue
      }
      applied.push(`${prov.name} ${field} ${delta >= 0 ? '+' : ''}${Math.trunc(delta)}`)
      continue
    }

    if (target.startsWith('minister:') && field === 'loyalty') {
      const minister = ministerById.get(target.slice('minister:'.length))
      if (!minister) continue
      minister.loyalty = clamp(minister.loyalty + delta, 0, 100)
      applied.push(`${minister.name} 忠诚 ${delta >= 0 ? '+' : ''}${Math.trunc(delta)}`)
    }
  }

  return { state: next, applied }
}

/** 应用任务状态更新与下一季度任务（对应 _apply_task_updates）。 */
export function applyTaskUpdates(state: GameState, result: QuarterResult): GameState {
  const next = structuredClone(state)
  const currentQuarter = quarterKey(next.year, next.quarter)

  for (const update of result.taskUpdates) {
    const task = next.politicalTasks.find((t) => t.id === update.taskId)
    if (!task) continue
    task.status = update.status
    task.progress = update.progress ?? task.progress
    task.updatedQuarter = currentQuarter
    task.completionReason = update.resolution ?? update.completionReason ?? task.completionReason
    task.continuation = update.continuation ?? task.continuation
    if (update.nextObjective !== undefined) task.nextObjective = update.nextObjective
    if (update.obstacles !== undefined) task.obstacles = update.obstacles
  }

  for (const taskData of result.nextQuarterTasks) {
    if (typeof taskData !== 'object' || taskData === null) continue
    const id = String(taskData.id ?? '')
    if (id === '' || next.politicalTasks.some((t) => t.id === id)) continue
    const created = structuredClone(taskData)
    created.status = created.status ?? 'active'
    created.createdQuarter = currentQuarter
    created.updatedQuarter = currentQuarter
    next.politicalTasks.push(created)
  }

  return next
}

/** 季度推进（对应 _advance_quarter）。 */
export function advanceQuarter(state: GameState): GameState {
  const next = structuredClone(state)
  next.quarter += 1
  if (next.quarter > 4) {
    next.quarter = 1
    next.year += 1
  }
  next.month = (next.quarter - 1) * 3 + 1
  next.day = 1
  next.quarterDay = 1
  return next
}

/** 提交季度推演结果：应用效果、更新任务、推进季度、重置回合状态。 */
export function commitQuarter(
  state: GameState,
  result: QuarterResult,
  appliedEffects: string[],
): { state: GameState; report: QuarterResult['endEvaluation'] } {
  let next = structuredClone(state)

  next.lastAiResult = structuredClone(result) as unknown as Record<string, unknown>
  next.lastAiValidation = { ok: true }

  const report = {
    quarter: quarterKey(next.year, next.quarter),
    narrative: result.narrative,
    quarterSummary: result.quarterSummary,
    treasury: result.treasury,
    events: result.events,
    battles: result.battles,
    taskUpdates: result.taskUpdates,
    edicts: structuredClone(next.quarterEdicts),
    validation: { ok: true },
    endEvaluation: result.endEvaluation,
  }
  next.quarterReports.push(report)
  next.quarterSummaries.push(result.quarterSummary || result.narrative)
  next.history.push(`【${report.quarter}季度结算】${result.narrative}`)

  void appliedEffects

  next = advanceQuarter(next)
  next.actionsLeft = MAX_ACTIONS
  next.pendingActions = []
  next.currentQuarterBulletins = []
  next.currentQuarterDialogues = []
  next.currentQuarterDebates = []
  next.currentQuarterDecisions = []
  next.quarterEdicts = []
  next.quarterTaskSnapshot = structuredClone(next.politicalTasks)
  next.stage = 'morning_court'
  next.simulationInFlight = false
  next.bulletinInFlight = false

  return { state: next, report: result.endEvaluation }
}
