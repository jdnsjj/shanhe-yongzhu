import { describe, expect, it } from 'vitest'
import { LIMITS, validateQuarterResult, validationContextFrom } from './schemas.ts'

const ctx = validationContextFrom({
  provinces: [{ id: 'shaanxi' }, { id: 'jingzhi' }],
  ministers: [{ id: 'yuanchonghuan' }],
  pool: [{ id: 'sun' }],
  quarterEdicts: [{ edictId: 'edict_1627-Q1_001' }],
  politicalTasks: [{ id: 'succession_crisis' }],
})

function base(over: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    quarter_summary: '本季无事',
    narrative: '史册一笔。',
    treasury: { delta: 10 },
    effects: [],
    events: [],
    battles: [],
    task_updates: [],
    next_quarter_tasks: [],
    end_evaluation: { status: 'ongoing' },
    ...over,
  }
}

describe('季度协议校验', () => {
  it('接受合法结果', () => {
    const r = validateQuarterResult(base(), ctx)
    expect(r.ok).toBe(true)
  })

  it('拒绝非对象', () => {
    expect(validateQuarterResult('x', ctx).ok).toBe(false)
    expect(validateQuarterResult(null, ctx).ok).toBe(false)
  })

  it('拒绝错误协议版本', () => {
    const r = validateQuarterResult(base({ schema_version: 2 }), ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('协议版本')
  })

  it('容忍字符串形式的版本号', () => {
    expect(validateQuarterResult(base({ schema_version: '1' }), ctx).ok).toBe(true)
  })

  it('拒绝非法效果字段', () => {
    const r = validateQuarterResult(base({ effects: [{ target: 'global', field: 'magic', delta: 1 }] }), ctx)
    expect(r.ok).toBe(false)
  })

  it('拒绝不存在的省份', () => {
    const r = validateQuarterResult(base({ effects: [{ target: 'province:liaodong', field: 'pop', delta: 1 }] }), ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('省份')
  })

  it('拒绝不存在的大臣', () => {
    const r = validateQuarterResult(base({ effects: [{ target: 'minister:nobody', field: 'loyalty', delta: 1 }] }), ctx)
    expect(r.ok).toBe(false)
  })

  it('拒绝未知控制者', () => {
    const r = validateQuarterResult(base({ effects: [{ target: 'province:shaanxi', field: 'owner', delta: 'usa' }] }), ctx)
    expect(r.ok).toBe(false)
  })

  it('接受合法控制者', () => {
    const r = validateQuarterResult(base({ effects: [{ target: 'province:shaanxi', field: 'owner', delta: 'rebel' }] }), ctx)
    expect(r.ok).toBe(true)
  })

  it('拒绝未知官职', () => {
    const r = validateQuarterResult(base({ effects: [{ target: 'position:king', field: 'appointment', delta: 'yuanchonghuan' }] }), ctx)
    expect(r.ok).toBe(false)
  })

  it('拒绝任命不存在的大臣', () => {
    const r = validateQuarterResult(base({ effects: [{ target: 'position:shoufu', field: 'appointment', delta: 'ghost' }] }), ctx)
    expect(r.ok).toBe(false)
  })

  it('接受合法任命与清空任命', () => {
    expect(validateQuarterResult(base({ effects: [{ target: 'position:shoufu', field: 'appointment', delta: 'yuanchonghuan' }] }), ctx).ok).toBe(true)
    expect(validateQuarterResult(base({ effects: [{ target: 'position:shoufu', field: 'appointment', delta: '' }] }), ctx).ok).toBe(true)
  })

  it('招募必须来自人才池且不得重复', () => {
    expect(validateQuarterResult(base({ effects: [{ target: 'global', field: 'recruit', delta: 'sun' }] }), ctx).ok).toBe(true)
    expect(validateQuarterResult(base({ effects: [{ target: 'global', field: 'recruit', delta: 'missing' }] }), ctx).ok).toBe(false)
    const dup = base({ effects: [
      { target: 'global', field: 'recruit', delta: 'sun' },
      { target: 'global', field: 'recruit', delta: 'sun' },
    ] })
    expect(validateQuarterResult(dup, ctx).ok).toBe(false)
  })

  it('拒绝不存在的任务与圣旨引用', () => {
    expect(validateQuarterResult(base({ task_updates: [{ task_id: 'ghost', status: 'completed' }] }), ctx).ok).toBe(false)
    const badEdict = base({ task_updates: [{ task_id: 'succession_crisis', status: 'completed', edict_refs: ['nope'] }] })
    expect(validateQuarterResult(badEdict, ctx).ok).toBe(false)
    const okEdict = base({ task_updates: [{ task_id: 'succession_crisis', status: 'completed', edict_refs: ['edict_1627-Q1_001'] }] })
    expect(validateQuarterResult(okEdict, ctx).ok).toBe(true)
  })

  it('拒绝未知任务状态', () => {
    const r = validateQuarterResult(base({ task_updates: [{ task_id: 'succession_crisis', status: 'unknown' }] }), ctx)
    expect(r.ok).toBe(false)
  })

  it('拒绝不存在的战斗省份与非法战斗结果', () => {
    expect(validateQuarterResult(base({ battles: [{ source: 'ghost', target: 'shaanxi', outcome: 'attacker_win' }] }), ctx).ok).toBe(false)
    expect(validateQuarterResult(base({ battles: [{ source: 'shaanxi', target: 'jingzhi', outcome: 'nonsense' }] }), ctx).ok).toBe(false)
    expect(validateQuarterResult(base({ battles: [{ source: 'shaanxi', target: 'jingzhi', outcome: 'stalemate' }] }), ctx).ok).toBe(true)
  })

  it('拒绝缺少标识或叙事的事件', () => {
    expect(validateQuarterResult(base({ events: [{ id: '', narrative: 'x' }] }), ctx).ok).toBe(false)
    expect(validateQuarterResult(base({ events: [{ id: 'e', narrative: '  ' }] }), ctx).ok).toBe(false)
    expect(validateQuarterResult(base({ events: [{ id: 'e', narrative: '大旱' }] }), ctx).ok).toBe(true)
  })

  it('数量超出上限即拒绝', () => {
    const many = Array.from({ length: LIMITS.effects + 1 }, () => ({ target: 'global', field: 'treasury', delta: 1 }))
    expect(validateQuarterResult(base({ effects: many }), ctx).ok).toBe(false)
    const manyEvents = Array.from({ length: LIMITS.events + 1 }, (_, i) => ({ id: 'e' + i, narrative: 'n' }))
    expect(validateQuarterResult(base({ events: manyEvents }), ctx).ok).toBe(false)
  })

  it('AI 语义校验为 false 时拒绝', () => {
    const r = validateQuarterResult(base({ validation: { ok: false } }), ctx)
    expect(r.ok).toBe(false)
  })

  it('规范化输出为 camelCase', () => {
    const r = validateQuarterResult(base({
      quarter_summary: '摘要',
      narrative: '叙事',
      task_updates: [{ task_id: 'succession_crisis', status: 'active', progress: 2 }],
      end_evaluation: { status: 'victory', reason: '中兴' },
    }), ctx)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.quarterSummary).toBe('摘要')
      expect(r.data.taskUpdates[0]!.taskId).toBe('succession_crisis')
      expect(r.data.endEvaluation.status).toBe('victory')
      expect(r.data.schemaVersion).toBe(1)
    }
  })

  it('缺省字段被补齐而非报错', () => {
    const r = validateQuarterResult({ schema_version: 1 }, ctx)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.effects).toEqual([])
      expect(r.data.events).toEqual([])
      expect(r.data.endEvaluation.status).toBe('ongoing')
    }
  })
})
