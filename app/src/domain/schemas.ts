/**
 * AI 协议校验 —— 用 zod 取代旧 game_state.gd 中约 150 行手写 if 校验。
 *
 * 忠实保留旧实现的有效语义（validate_quarter_result + validate_ai_result）：
 *  - 旧代码在 validate_quarter_result 里先查 effects<=120 / events<=12 / battles<=20，
 *    随后又调用 validate_ai_result 收紧为 effects<=80 / events<=8 / battles<=12。
 *    由于两者是「与」关系，宽松阈值永远不可达 —— 本实现直接采用**实际生效的严格阈值**。
 *  - 引用完整性（省份/大臣/官职/人才池/圣旨/任务）在结构校验之后单独校验，
 *    以便给出与旧版一致的可读中文错误。
 */

import { z } from 'zod'
import {
  AI_EFFECT_FIELDS,
  AI_EFFECT_LIMITS,
  AI_SCHEMA_VERSION,
  OWNERS,
  POSITIONS,
} from './constants.ts'
import type { AiEffect, QuarterResult } from './types.ts'

/** 实际生效的数量上限（见文件头说明）。 */
export const LIMITS = {
  effects: 80,
  events: 8,
  battles: 12,
  taskUpdates: 30,
} as const

export const BATTLE_OUTCOMES = ['attacker_win', 'defender_win', 'stalemate'] as const
export const TASK_STATUSES = ['completed', 'active', 'failed', 'superseded'] as const

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const finiteNumber = z.number().refine(Number.isFinite, { message: '数值必须有限' })

const effectSchema = z.looseObject({
  target: z.string(),
  field: z.enum(AI_EFFECT_FIELDS),
  delta: z.union([finiteNumber, z.string()]),
  reason: z.string().optional(),
})

const eventSchema = z.looseObject({
  id: z.string().trim().min(1, '季度事件缺少标识'),
  narrative: z.string().trim().min(1, '季度事件缺少叙事'),
})

const battleSchema = z.looseObject({
  source: z.string(),
  target: z.string(),
  outcome: z.enum(BATTLE_OUTCOMES),
})

const taskUpdateSchema = z.looseObject({
  task_id: z.string(),
  status: z.enum(TASK_STATUSES),
  progress: z.union([finiteNumber, z.string()]).optional(),
  resolution: z.string().optional(),
  completion_reason: z.string().optional(),
  continuation: z.string().optional(),
  next_objective: z.string().optional(),
  obstacles: z.array(z.unknown()).optional(),
  edict_refs: z.array(z.string()).optional(),
})

/** 季度结果的结构 schema（不含引用完整性）。 */
export const quarterResultSchema = z.looseObject({
  quarter_summary: z.string().default(''),
  narrative: z.string().default(''),
  treasury: z.looseObject({ delta: finiteNumber.optional() }).default({}),
  effects: z.array(effectSchema).max(LIMITS.effects, '效果数量超出安全上限').default([]),
  events: z.array(eventSchema).max(LIMITS.events, '事件数量超出安全上限').default([]),
  battles: z.array(battleSchema).max(LIMITS.battles, '战斗数量超出安全上限').default([]),
  task_updates: z.array(taskUpdateSchema).max(LIMITS.taskUpdates, '任务更新数量超出安全上限').default([]),
  next_quarter_tasks: z.array(z.looseObject({ id: z.string().trim().min(1) })).default([]),
  end_evaluation: z
    .looseObject({ status: z.enum(['ongoing', 'victory', 'defeat']).default('ongoing'), reason: z.string().optional() })
    .default({ status: 'ongoing' }),
  validation: z.looseObject({ ok: z.boolean().optional() }).optional(),
})

/** 引用完整性所需的当前世界状态快照。 */
export interface ValidationContext {
  provinceIds: ReadonlySet<string>
  ministerIds: ReadonlySet<string>
  poolIds: ReadonlySet<string>
  knownEdictIds: ReadonlySet<string>
  taskIds: ReadonlySet<string>
}

export type ValidationResult =
  | { ok: true; data: QuarterResult }
  | { ok: false; error: string }

/** 校验 AI 返回的季度推演结果。返回结构与旧 GDScript 的 {ok, error} 契约一致。 */
export function validateQuarterResult(raw: unknown, ctx: ValidationContext): ValidationResult {
  if (!isRecord(raw)) return { ok: false, error: '季度结果不是 JSON 对象' }

  // 协议版本：容忍模型把数字写成字符串（旧 int() 亦会强制转换）
  const rawVersion = raw['schema_version']
  const version = typeof rawVersion === 'string' ? Number(rawVersion) : rawVersion
  if (version !== AI_SCHEMA_VERSION) return { ok: false, error: '季度 AI 协议版本不支持' }

  const parsed = quarterResultSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first?.path.join('.') ?? ''
    return { ok: false, error: `季度结果格式非法${path ? '（' + path + '）' : ''}：${first?.message ?? '未知错误'}` }
  }
  const data = parsed.data

  if (data.validation !== undefined && data.validation.ok === false) {
    return { ok: false, error: 'AI语义校验未通过' }
  }

  const refError = validateReferences(data, ctx)
  if (refError !== null) return { ok: false, error: refError }

  return { ok: true, data: toQuarterResult(data) }
}

/** 引用完整性与取值域校验（对应旧实现的 target/field 分支检查）。 */
function validateReferences(data: z.infer<typeof quarterResultSchema>, ctx: ValidationContext): string | null {
  for (const battle of data.battles) {
    if (!ctx.provinceIds.has(battle.source) || !ctx.provinceIds.has(battle.target)) {
      return '季度战斗引用了不存在的省份'
    }
  }

  for (const update of data.task_updates) {
    if (!ctx.taskIds.has(update.task_id)) return 'AI引用了不存在的时政任务'
    for (const ref of update.edict_refs ?? []) {
      if (!ctx.knownEdictIds.has(ref)) return '任务引用了不存在的圣旨'
    }
  }

  const seenRecruits = new Set<string>()
  for (const effect of data.effects) {
    const field = effect.field
    const target = effect.target
    const value = effect.delta

    if (field === 'recruit') {
      const recruitId = String(value).trim()
      if (target !== 'global') return 'AI招募效果格式非法'
      if (recruitId === '' || seenRecruits.has(recruitId)) return 'AI招募效果格式非法或重复'
      if (!ctx.poolIds.has(recruitId)) return 'AI招募了不存在或已不在人才池的人才'
      seenRecruits.add(recruitId)
      continue
    }

    // 受限字段必须是有限数值
    if (field in AI_EFFECT_LIMITS && typeof value !== 'number') {
      return 'AI效果数值非法'
    }

    if (target.startsWith('province:')) {
      const pid = target.slice('province:'.length)
      if (!ctx.provinceIds.has(pid)) return 'AI引用了不存在的省份'
      if (field === 'owner' && !(OWNERS as readonly string[]).includes(String(value))) {
        return 'AI返回了未知省份控制者'
      }
    } else if (target.startsWith('minister:')) {
      const mid = target.slice('minister:'.length)
      if (!ctx.ministerIds.has(mid)) return 'AI引用了不存在的大臣'
    } else if (target.startsWith('position:')) {
      const pos = target.slice('position:'.length)
      if (!(pos in POSITIONS) || field !== 'appointment') return 'AI引用了不存在的官职'
      const mid = String(value)
      if (mid !== '' && !ctx.ministerIds.has(mid)) return 'AI任命了不存在的大臣'
    }
  }

  return null
}

/** 把 snake_case 协议对象规范化为 camelCase 领域对象。 */
function toQuarterResult(data: z.infer<typeof quarterResultSchema>): QuarterResult {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    quarterSummary: data.quarter_summary,
    narrative: data.narrative,
    treasury: data.treasury as QuarterResult['treasury'],
    effects: data.effects as AiEffect[],
    events: data.events as QuarterResult['events'],
    battles: data.battles as QuarterResult['battles'],
    taskUpdates: data.task_updates.map((u) => ({
      taskId: u.task_id,
      status: u.status,
      progress: typeof u.progress === 'number' ? u.progress : undefined,
      resolution: u.resolution,
      completionReason: u.completion_reason,
      continuation: u.continuation,
      nextObjective: u.next_objective,
      obstacles: u.obstacles as string[] | undefined,
      edictRefs: u.edict_refs,
    })),
    nextQuarterTasks: data.next_quarter_tasks as unknown as QuarterResult['nextQuarterTasks'],
    endEvaluation: {
      status: data.end_evaluation.status,
      reason: data.end_evaluation.reason,
    },
    validation: data.validation,
  }
}

/** 构造校验上下文。 */
export function validationContextFrom(state: {
  provinces: ReadonlyArray<{ id: string }>
  ministers: ReadonlyArray<{ id: string }>
  pool: ReadonlyArray<{ id: string }>
  quarterEdicts: ReadonlyArray<{ edictId: string }>
  politicalTasks: ReadonlyArray<{ id: string }>
}): ValidationContext {
  return {
    provinceIds: new Set(state.provinces.map((p) => p.id)),
    ministerIds: new Set(state.ministers.map((m) => m.id)),
    poolIds: new Set(state.pool.map((m) => m.id)),
    knownEdictIds: new Set(state.quarterEdicts.map((e) => e.edictId)),
    taskIds: new Set(state.politicalTasks.map((t) => t.id)),
  }
}
