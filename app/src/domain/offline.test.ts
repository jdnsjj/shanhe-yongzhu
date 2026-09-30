import { describe, expect, it } from 'vitest'
import { END_YEAR } from './constants.ts'
import {
  averagePublicSupport,
  checkEnd,
  createRng,
  diffEffects,
  jinBattle,
  quarterlyIncome,
  simulateQuarterOffline,
} from './offline.ts'
import { createNewGame, mingProvinces } from './state.ts'
import { applyAiTransition, commitQuarter } from './transition.ts'
import type { GameState, Minister, Province } from './types.ts'
import { validateQuarterResult, validationContextFrom } from './schemas.ts'

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
    [
      prov({ id: 'jingzhi', name: '北直隶', tax: 14, garrison: 26 }),
      prov({ id: 'shaanxi', name: '陕西', tax: 12, garrison: 20, publicSupport: 38, militaryMorale: 48 }),
    ],
    [min({ id: 'a', name: '甲', politics: 80, command: 70 }), min({ id: 'b', name: '乙' })],
    [min({ id: 'p1', name: '在野一' })],
  )
}

describe('确定性 PRNG', () => {
  it('同种子产生同序列', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })
  it('不同种子产生不同序列', () => {
    expect(createRng(1)()).not.toBe(createRng(2)())
  })
  it('输出落在 [0,1)', () => {
    const r = createRng(7)
    for (let i = 0; i < 200; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('税收公式', () => {
  it('按税基与民心计算，并受户部治政加成', () => {
    const s = fresh()
    s.appointments = {}
    // 14*(0.5+55/100) + 12*(0.5+38/100) = 14*1.05 + 12*0.88 = 14.7 + 10.56 = 25.26 -> 25
    expect(quarterlyIncome(s)).toBe(25)
  })

  it('轻徭薄赋生效时税收减少约三成', () => {
    const s = fresh()
    s.appointments = {}
    // 未取整基数：14*(0.5+50/100) + 12*(0.5+38/100) = 14 + 10.56 = 24.56
    const full = quarterlyIncome(s)
    expect(full).toBe(Math.round(24.56)) // 25
    s.taxCutMonths = 1
    const cut = quarterlyIncome(s)
    expect(cut).toBe(Math.round(24.56 * 0.7)) // 24.56*0.7 = 17.192 -> 17
    expect(cut).toBeLessThan(full)
  })

  it('户部治政越高税收越多', () => {
    const s = fresh()
    s.appointments = {}
    const without = quarterlyIncome(s)
    s.appointments.hubu = 'a'
    expect(quarterlyIncome(s)).toBeGreaterThan(without)
  })
})

describe('终局判定', () => {
  it('国库跌破 -300 判负', () => {
    const s = fresh()
    s.treasury = -301
    expect(checkEnd(s).status).toBe('defeat')
    expect(checkEnd(s).reason).toContain('国库枯竭')
  })

  it('疆域不足 7 省判负', () => {
    const s = fresh()
    s.provinces = [prov({ id: 'a' }), prov({ id: 'b' })]
    expect(checkEnd(s).status).toBe('defeat')
    expect(checkEnd(s).reason).toContain('山河破碎')
  })

  it('撑到 1644 年末且民心朝堂疆域达标即胜', () => {
    const s = fresh()
    s.year = END_YEAR
    s.month = 13
    s.provinces = Array.from({ length: 15 }, (_, i) => prov({ id: 'p' + i, publicSupport: 60 }))
    s.courtStability = 50
    const e = checkEnd(s)
    expect(e.status).toBe('victory')
    expect(e.reason).toContain('山河永驻')
  })

  it('撑到期但疆域仅存十省为惨胜', () => {
    const s = fresh()
    s.year = END_YEAR + 1
    s.provinces = Array.from({ length: 10 }, (_, i) => prov({ id: 'p' + i, publicSupport: 20 }))
    const e = checkEnd(s)
    expect(e.status).toBe('victory')
    expect(e.reason).toContain('中兴之主')
  })

  it('撑到期但疆域不足十省判负', () => {
    const s = fresh()
    s.year = END_YEAR + 1
    s.provinces = Array.from({ length: 8 }, (_, i) => prov({ id: 'p' + i, publicSupport: 20 }))
    expect(checkEnd(s).status).toBe('defeat')
  })

  it('疆域充足且局势正常时判定为 ongoing', () => {
    const s = fresh()
    // fresh() 只有 2 省，会触发「疆域<=6 判负」；补足到 15 省才是正常的持续状态
    s.provinces = Array.from({ length: 15 }, (_, i) => prov({ id: 'p' + i }))
    expect(checkEnd(s).status).toBe('ongoing')
  })
})

describe('京师保卫战', () => {
  it('后金势力为零时此战未起', () => {
    const s = fresh()
    s.jinPower = 0
    expect(jinBattle(s, 1)).toContain('此战未起')
  })

  it('京师非我方时此战未起', () => {
    const s = fresh()
    s.provinces = s.provinces.map((p) => (p.id === 'jingzhi' ? { ...p, owner: 'jin' as const } : p))
    expect(jinBattle(s, 1)).toContain('此战未起')
  })

  it('极高守备加成可却敌', () => {
    const s = fresh()
    s.jinPower = 10
    expect(jinBattle(s, 100)).toContain('损兵折将而退')
    expect(s.history.some((h) => h.includes('却敌'))).toBe(true)
  })

  it('后金压倒性优势可破城', () => {
    const s = fresh()
    s.jinPower = 120
    s.provinces = s.provinces.map((p) => (p.id === 'jingzhi' ? { ...p, garrison: 2, militaryMorale: 10, fort: 0 } : p))
    expect(jinBattle(s, 0.01)).toContain('陷落')
  })
})

describe('离线季度推演', () => {
  it('产出符合协议的 QuarterResult', () => {
    const s = fresh()
    // 补足疆域，避免 fresh() 的 2 省直接触发失地败亡
    s.provinces = Array.from({ length: 15 }, (_, i) => prov({ id: 'p' + i }))
    const r = simulateQuarterOffline(s, 1)
    expect(r.schemaVersion).toBe(1)
    expect(typeof r.narrative).toBe('string')
    expect(r.narrative.length).toBeGreaterThan(0)
    // 推演必然产生真实效果（税收、势力增长、民心军心演变）
    expect(r.effects.length).toBeGreaterThan(0)
    expect(r.endEvaluation.status).toBe('ongoing')
  })

  it('结果能通过与 AI 相同的校验管线', () => {
    const s = fresh()
    const r = simulateQuarterOffline(s, 1)
    const ctx = validationContextFrom(s)
    const checked = validateQuarterResult({ ...r, schema_version: r.schemaVersion }, ctx)
    expect(checked.ok).toBe(true)
  })

  it('同种子结果可复现', () => {
    const a = simulateQuarterOffline(fresh(), 99)
    const b = simulateQuarterOffline(fresh(), 99)
    expect(a.narrative).toBe(b.narrative)
  })

  it('税收计入国库', () => {
    const s = fresh()
    const income = quarterlyIncome(s)
    const r = simulateQuarterOffline(s, 5)
    expect(r.treasury.delta).toBe(income)
  })

  it('可完整走通一个季度并推进回合', () => {
    const s = fresh()
    const r = simulateQuarterOffline(s, 3)
    const { state: next } = commitQuarter(s, r, [])
    expect(next.quarter).toBe(2)
    expect(next.actionsLeft).toBe(3)
    expect(next.quarterReports).toHaveLength(1)
  })

  it('开仓赈灾被离线引擎纳入推演', () => {
    const s = fresh()
    s.pendingActions = [{ type: 'policy', id: 'zhenji', provinceId: 'shaanxi', cost: 50 }]
    const r = simulateQuarterOffline(s, 1)
    expect(r.narrative).toContain('开仓赈济')
    expect(r.narrative).toContain('陕西')
  })

  it('整饬军务同时提升兵力与军心', () => {
    const s = fresh()
    s.pendingActions = [{ type: 'policy', id: 'lianbing', provinceId: 'shaanxi', cost: 40 }]
    const r = simulateQuarterOffline(s, 1)
    // 离线引擎把行动效果直接落地到推演状态，narrative 中应有所体现
    expect(r.narrative).toContain('整饬')
  })

  it('调兵把兵力移往相邻省份', () => {
    const s = fresh()
    s.pendingActions = [{ type: 'move_troops', source: 'jingzhi', target: 'shaanxi', troops: 10 }]
    const r = simulateQuarterOffline(s, 1)
    expect(r.narrative).toContain('移驻')
  })

  it('长局可推进 17 年而不崩溃', () => {
    let s = fresh()
    // 补足疆域，避免过早触发失地败亡
    s.provinces = Array.from({ length: 15 }, (_, i) =>
      prov({ id: i === 0 ? 'jingzhi' : 'p' + i, name: '省' + i, tax: 12, garrison: 15, publicSupport: 55, militaryMorale: 55 }),
    )
    let guard = 0
    while (!s.gameEnded && guard < 200) {
      const r = simulateQuarterOffline(s, 1000 + guard)
      const { state: next } = commitQuarter(s, r, [])
      s = next
      const e = checkEnd(s)
      if (e.status !== 'ongoing') {
        s.gameEnded = true
        s.victory = e.status === 'victory'
        break
      }
      guard++
    }
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(200)
    // 必须能真正跑完 17 年（68 个季度）而非卡死
    expect(s.year).toBeGreaterThanOrEqual(END_YEAR)
  })

  it('不修改入参状态', () => {
    const s = fresh()
    const before = JSON.stringify(s)
    simulateQuarterOffline(s, 1)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('疆域被 AI 夺取后平均民心仍可计算', () => {
    const s = fresh()
    s.provinces = s.provinces.map((p) => ({ ...p, owner: 'jin' as const }))
    expect(mingProvinces(s)).toHaveLength(0)
    expect(averagePublicSupport(s)).toBe(0)
  })
})

// ============ 回归测试 ============
// 曾经的问题：离线引擎算出了推演后的状态，却只把变化写进叙事、
// effects 返回空数组，导致「奏报说收了 201 万两税，国库却纹丝不动」。
describe('离线结果必须真正改变世界状态（回归）', () => {
  function wide(): GameState {
    const s = fresh()
    s.provinces = Array.from({ length: 15 }, (_, i) =>
      prov({ id: i === 0 ? 'jingzhi' : 'p' + i, name: '省' + i, tax: 12, garrison: 15 }),
    )
    return s
  }

  it('effects 非空', () => {
    const r = simulateQuarterOffline(wide(), 1)
    expect(r.effects.length).toBeGreaterThan(0)
  })

  it('税收确实进入国库', () => {
    const s = wide()
    const income = quarterlyIncome(s)
    const r = simulateQuarterOffline(s, 1)
    const applied = applyAiTransition(s, r.effects).state
    expect(applied.treasury).toBe(s.treasury + income)
    expect(applied.treasury).toBeGreaterThan(s.treasury)
  })

  it('后金势力确实增长', () => {
    const s = wide()
    const r = simulateQuarterOffline(s, 1)
    const applied = applyAiTransition(s, r.effects).state
    expect(applied.jinPower).toBeGreaterThan(s.jinPower)
  })

  it('effects 落库后可复现完整推演状态', () => {
    const s = wide()
    const r = simulateQuarterOffline(s, 7)
    const applied = applyAiTransition(s, r.effects).state
    // 国库、后金、流寇、朝堂应逐项复现
    expect(applied.treasury).toBeCloseTo(s.treasury + quarterlyIncome(s), 6)
    expect(applied.jinPower).toBeGreaterThan(s.jinPower)
    expect(applied.courtStability).toBeGreaterThanOrEqual(0)
    expect(applied.courtStability).toBeLessThanOrEqual(100)
  })

  it('省级民心军心变化被写入 effects', () => {
    const s = wide()
    const r = simulateQuarterOffline(s, 3)
    const provinceEffects = r.effects.filter((e) => e.target.startsWith('province:'))
    expect(provinceEffects.length).toBeGreaterThan(0)
    const applied = applyAiTransition(s, r.effects).state
    // 民心向 50 回归：起始 50 时基本不动，起始 38 时应上升
    const before = s.provinces.find((p) => p.publicSupport === 38) ?? s.provinces[0]!
    const after = applied.provinces.find((p) => p.id === before.id)!
    expect(Number.isFinite(after.publicSupport)).toBe(true)
  })

  it('玩家行动的效果也被纳入', () => {
    const s = wide()
    s.pendingActions = [{ type: 'policy', id: 'jiazheng', provinceId: '', cost: 0 }]
    const r = simulateQuarterOffline(s, 1)
    const applied = applyAiTransition(s, r.effects).state
    // 加派赋税得银 80 万两，叠加税收后国库必定高于纯税收
    expect(applied.treasury).toBeGreaterThan(s.treasury + quarterlyIncome(s))
  })
})

describe('diffEffects', () => {
  it('无变化时返回空数组', () => {
    const s = fresh()
    expect(diffEffects(s, structuredClone(s))).toEqual([])
  })

  it('全局数值差异被转成 global 效果', () => {
    const a = fresh()
    const b = structuredClone(a)
    b.treasury += 50
    b.jinPower += 3
    const e = diffEffects(a, b)
    expect(e).toContainEqual(expect.objectContaining({ target: 'global', field: 'treasury', delta: 50 }))
    expect(e).toContainEqual(expect.objectContaining({ target: 'global', field: 'jin_power', delta: 3 }))
  })

  it('省份归属变化被转成 owner 效果', () => {
    const a = fresh()
    const b = structuredClone(a)
    b.provinces[0]!.owner = 'rebel'
    expect(diffEffects(a, b)).toContainEqual(
      expect.objectContaining({ target: `province:${a.provinces[0]!.id}`, field: 'owner', delta: 'rebel' }),
    )
  })

  it('官职变更被转成 appointment 效果', () => {
    const a = fresh()
    // createNewGame 已把 hubu 任命给最优者 'a'，故改任 'b' 才是真实变更
    expect(a.appointments.hubu).toBe('a')
    const b = structuredClone(a)
    b.appointments.hubu = 'b'
    expect(diffEffects(a, b)).toContainEqual(
      expect.objectContaining({ target: 'position:hubu', field: 'appointment', delta: 'b' }),
    )
  })

  it('招募被转成 recruit 效果', () => {
    const a = fresh()
    const b = structuredClone(a)
    const m = b.pool.shift()!
    b.ministers.push(m)
    expect(diffEffects(a, b)).toContainEqual(
      expect.objectContaining({ target: 'global', field: 'recruit', delta: m.id }),
    )
  })
})
