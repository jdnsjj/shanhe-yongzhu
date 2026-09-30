import { describe, expect, it } from 'vitest'
import { AI_SCHEMA_VERSION } from './constants.ts'
import { createNewGame } from './state.ts'
import {
  advanceQuarter,
  applyAiTransition,
  applyTaskUpdates,
  captureTransaction,
  commitQuarter,
  restoreTransaction,
} from './transition.ts'
import type { AiEffect, GameState, Minister, Province, QuarterResult } from './types.ts'

function prov(over: Partial<Province> = {}): Province {
  return {
    id: 'x', name: '某省', mapName: '某省', historicalScope: '测试',
    owner: 'ming', tax: 10, garrison: 10, publicSupport: 50, militaryMorale: 50,
    fort: 2, adjacent: [], ...over,
  }
}
function min(over: Partial<Minister> = {}): Minister {
  return {
    id: 'm', name: '某臣', title: '', faction: '中立',
    politics: 50, command: 50, wisdom: 50, loyalty: 50, ambition: 50,
    traits: [], desc: '', persona: '', ...over,
  }
}
function fresh(): GameState {
  return createNewGame(
    [prov({ id: 'jingzhi', name: '北直隶' }), prov({ id: 'shaanxi', name: '陕西', publicSupport: 40, militaryMorale: 40 })],
    [min({ id: 'a', name: '甲' }), min({ id: 'b', name: '乙' })],
    [min({ id: 'p1', name: '在野一' })],
  )
}

describe('效果应用', () => {
  it('全局财政/朝堂/势力在合法区间内生效', () => {
    const s = fresh()
    const r = applyAiTransition(s, [
      { target: 'global', field: 'treasury', delta: 100 },
      { target: 'global', field: 'court_stability', delta: 10 },
      { target: 'global', field: 'rebel_power', delta: -5 },
      { target: 'global', field: 'jin_power', delta: 8 },
    ])
    expect(r.state.treasury).toBe(220)
    expect(r.state.courtStability).toBe(60)
    expect(r.state.rebelPower).toBe(15)
    expect(r.state.jinPower).toBe(53)
    expect(r.applied).toHaveLength(4)
  })

  it('不修改入参状态（不可变更新）', () => {
    const s = fresh()
    const before = s.treasury
    applyAiTransition(s, [{ target: 'global', field: 'treasury', delta: 50 }])
    expect(s.treasury).toBe(before)
  })

  it('数值被夹紧到 AI_EFFECT_LIMITS', () => {
    const s = fresh()
    const r = applyAiTransition(s, [{ target: 'global', field: 'treasury', delta: 99999 }])
    expect(r.state.treasury).toBe(120 + 500)
  })

  it('省级效果按 AI_EFFECT_LIMITS 先夹紧增量、再夹紧结果值', () => {
    // 与旧 GDScript 一致：delta 先被夹到 ±AI_EFFECT_LIMITS[field]，再叠加并夹到字段区间。
    // pop ±30、morale ±35、garrison ±30、fort ±3
    const s = fresh()
    const r = applyAiTransition(s, [
      { target: 'province:shaanxi', field: 'pop', delta: 999 },
      { target: 'province:shaanxi', field: 'morale', delta: -999 },
      { target: 'province:shaanxi', field: 'garrison', delta: -999 },
      { target: 'province:shaanxi', field: 'fort', delta: 99 },
    ])
    const p = r.state.provinces.find((x) => x.id === 'shaanxi')!
    expect(p.publicSupport).toBe(70) // 40 + 30
    expect(p.militaryMorale).toBe(5) // 40 - 35
    expect(p.garrison).toBe(2) // 10 - 30 -> 夹到下限 2
    expect(p.fort).toBe(5) // 2 + 3
  })

  it('省份归属变更', () => {
    const s = fresh()
    const r = applyAiTransition(s, [{ target: 'province:shaanxi', field: 'owner', delta: 'rebel' }])
    expect(r.state.provinces.find((p) => p.id === 'shaanxi')!.owner).toBe('rebel')
  })

  it('任命同一人不会让其兼任两职', () => {
    const s = fresh()
    s.appointments = { shoufu: 'a' }
    const r = applyAiTransition(s, [{ target: 'position:hubu', field: 'appointment', delta: 'a' }])
    expect(r.state.appointments.hubu).toBe('a')
    expect(r.state.appointments.shoufu).toBeUndefined()
  })

  it('空值可清除任命', () => {
    const s = fresh()
    s.appointments = { shoufu: 'a' }
    const r = applyAiTransition(s, [{ target: 'position:shoufu', field: 'appointment', delta: '' }])
    expect(r.state.appointments.shoufu).toBeUndefined()
  })

  it('招募把人才从池中移入朝廷', () => {
    const s = fresh()
    const r = applyAiTransition(s, [{ target: 'global', field: 'recruit', delta: 'p1' }])
    expect(r.state.pool).toHaveLength(0)
    expect(r.state.ministers.some((m) => m.id === 'p1')).toBe(true)
  })

  it('忠诚变更生效并按 ±30 夹紧增量', () => {
    const s = fresh()
    const r = applyAiTransition(s, [
      { target: 'minister:a', field: 'loyalty', delta: 10 },
      { target: 'minister:b', field: 'loyalty', delta: -999 },
    ])
    expect(r.state.ministers.find((m) => m.id === 'a')!.loyalty).toBe(60)
    expect(r.state.ministers.find((m) => m.id === 'b')!.loyalty).toBe(20) // 50 - 30
  })

  it('忽略未知目标与未知字段', () => {
    const s = fresh()
    const r = applyAiTransition(s, [
      { target: 'province:ghost', field: 'pop', delta: 5 },
      { target: 'global', field: 'unknown_field', delta: 5 },
      { target: 'minister:ghost', field: 'loyalty', delta: 5 },
      { target: 'position:king', field: 'appointment', delta: 'a' },
    ])
    expect(r.applied).toHaveLength(0)
    expect(r.state.treasury).toBe(s.treasury)
  })

  it('忽略非有限数值', () => {
    const s = fresh()
    const r = applyAiTransition(s, [{ target: 'global', field: 'treasury', delta: Number.NaN } as AiEffect])
    expect(r.state.treasury).toBe(s.treasury)
  })
})

describe('事务快照与回滚', () => {
  it('回滚恢复全部字段', () => {
    const s = fresh()
    const snap = captureTransaction(s)

    const mutated = applyAiTransition(s, [
      { target: 'global', field: 'treasury', delta: 100 },
      { target: 'province:shaanxi', field: 'pop', delta: -20 },
    ]).state
    mutated.stage = 'quarter_settlement'
    mutated.simulationInFlight = true

    const restored = restoreTransaction(snap)
    expect(restored.treasury).toBe(s.treasury)
    expect(restored.provinces.find((p) => p.id === 'shaanxi')!.publicSupport).toBe(40)
    expect(restored.stage).toBe('morning_court')
    expect(restored.simulationInFlight).toBe(false)
  })

  it('回滚后与快照互不影响（深拷贝）', () => {
    const s = fresh()
    const snap = captureTransaction(s)
    snap.state.treasury = 9999
    expect(s.treasury).toBe(120)
  })
})

describe('季度推进与落库', () => {
  it('advanceQuarter 跨年', () => {
    let s = fresh()
    expect(s.quarter).toBe(1)
    s = advanceQuarter(s)
    expect(s.quarter).toBe(2)
    expect(s.month).toBe(4)

    s.quarter = 4
    s = advanceQuarter(s)
    expect(s.quarter).toBe(1)
    expect(s.year).toBe(1628)
    expect(s.month).toBe(1)
  })

  function result(over: Partial<QuarterResult> = {}): QuarterResult {
    return {
      schemaVersion: AI_SCHEMA_VERSION,
      quarterSummary: '本季无事',
      narrative: '史册一笔。',
      treasury: { delta: 10 },
      effects: [], events: [], battles: [], taskUpdates: [], nextQuarterTasks: [],
      endEvaluation: { status: 'ongoing' },
      ...over,
    }
  }

  it('提交后推进季度并重置回合状态', () => {
    const s = fresh()
    s.actionsLeft = 1
    s.pendingActions = [{ type: 'policy', id: 'keju', provinceId: '', cost: 30 }]
    s.quarterEdicts = [{ edictId: 'e1', quarter: '1627-Q1', dateOrder: 1, date: '', text: '诏', taskIds: [], solutionId: '', sourceDialogueIds: [], sourceDebateId: '', isSettlementEdict: false, status: 'issued' }]

    const { state: next, report } = commitQuarter(s, result(), [])
    expect(next.quarter).toBe(2)
    expect(next.actionsLeft).toBe(3)
    expect(next.pendingActions).toEqual([])
    expect(next.quarterEdicts).toEqual([])
    expect(next.stage).toBe('morning_court')
    expect(next.simulationInFlight).toBe(false)
    expect(next.quarterReports).toHaveLength(1)
    expect(next.quarterSummaries).toEqual(['本季无事'])
    expect(report.status).toBe('ongoing')
  })

  it('不修改入参状态', () => {
    const s = fresh()
    commitQuarter(s, result(), [])
    expect(s.quarter).toBe(1)
    expect(s.quarterReports).toHaveLength(0)
  })

  it('任务更新应用到现有任务', () => {
    const s = fresh()
    const next = applyTaskUpdates(s, result({
      taskUpdates: [{ taskId: 'succession_crisis', status: 'completed', progress: 3, resolution: '朝局已定' }],
    }))
    const t = next.politicalTasks.find((x) => x.id === 'succession_crisis')!
    expect(t.status).toBe('completed')
    expect(t.progress).toBe(3)
    expect(t.completionReason).toBe('朝局已定')
  })

  it('新任务被追加，重名任务被忽略', () => {
    const s = fresh()
    const next = applyTaskUpdates(s, result({
      nextQuarterTasks: [
        { id: 'new_task', title: '新任务', status: 'active' } as never,
        { id: 'succession_crisis', title: '重名' } as never,
      ],
    }))
    expect(next.politicalTasks).toHaveLength(2)
    expect(next.politicalTasks[1]!.id).toBe('new_task')
  })
})
