import { describe, expect, it } from 'vitest'
import {
  acceptSolution,
  actionsExhausted,
  appointMinister,
  canDispatchFrom,
  dismissMinister,
  dispatch,
  hasTaskDialogue,
  issueEdict,
  moveTroops,
  recordDebate,
  recordDialogue,
  recruitRandom,
  setStage,
  spendAction,
  usePolicy,
} from './pipeline.ts'
import { createNewGame } from './state.ts'
import type { GameState, Minister, Province } from './types.ts'

function prov(over: Partial<Province> = {}): Province {
  return {
    id: 'x', name: '某省', mapName: '某省', historicalScope: '测试',
    owner: 'ming', tax: 10, garrison: 20, publicSupport: 50, militaryMorale: 50,
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
      prov({ id: 'jingzhi', name: '北直隶', garrison: 26, adjacent: ['shanxi'] }),
      prov({ id: 'shanxi', name: '山西', adjacent: ['jingzhi', 'shaanxi'] }),
      prov({ id: 'shaanxi', name: '陕西', owner: 'rebel', garrison: 8, adjacent: ['shanxi'] }),
    ],
    [min({ id: 'a', name: '甲' }), min({ id: 'b', name: '乙' })],
    [min({ id: 'p1', name: '在野一' }), min({ id: 'p2', name: '在野二' })],
  )
}
const TASK = 'succession_crisis'

describe('召对', () => {
  it('记录成功并进入 private_audience 阶段', () => {
    const r = recordDialogue(fresh(), TASK, 'a', [{ role: 'user', content: '问' }])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state.currentQuarterDialogues).toHaveLength(1)
      expect(r.value.state.stage).toBe('private_audience')
      expect(r.value.id).toMatch(/^dialogue_1627-Q1_001$/)
      expect(hasTaskDialogue(r.value.state, TASK)).toBe(true)
    }
  })

  it('拒绝不存在或已结束的任务', () => {
    expect(recordDialogue(fresh(), 'ghost', 'a', []).ok).toBe(false)
    const s = fresh()
    s.politicalTasks[0]!.status = 'completed'
    expect(recordDialogue(s, TASK, 'a', []).ok).toBe(false)
  })

  it('拒绝不存在的大臣', () => {
    expect(recordDialogue(fresh(), TASK, 'ghost', []).ok).toBe(false)
  })

  it('推演进行中拒绝议事', () => {
    const s = fresh()
    s.simulationInFlight = true
    expect(recordDialogue(s, TASK, 'a', []).ok).toBe(false)
  })

  it('把证据 id 写入任务', () => {
    const r = recordDialogue(fresh(), TASK, 'a', [])
    if (r.ok) expect(r.value.state.politicalTasks[0]!.evidenceRefs).toContain(r.value.id)
  })
})

describe('朝会', () => {
  it('至少需要两名大臣', () => {
    expect(recordDebate(fresh(), TASK, ['a'], []).ok).toBe(false)
    expect(recordDebate(fresh(), TASK, ['a', 'b'], []).ok).toBe(true)
  })

  it('拒绝不存在的大臣', () => {
    expect(recordDebate(fresh(), TASK, ['a', 'ghost'], []).ok).toBe(false)
  })

  it('方案候选并入任务', () => {
    const r = recordDebate(fresh(), TASK, ['a', 'b'], [], '议定', [{ id: 'sol1', title: '策一' }])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state.stage).toBe('court_debate')
      expect(r.value.state.politicalTasks[0]!.solutionCandidates).toHaveLength(1)
    }
  })
})

describe('采纳方案', () => {
  it('无对话证据时拒绝', () => {
    expect(acceptSolution(fresh(), TASK, { id: 's1' }).ok).toBe(false)
  })

  it('有证据后可采纳并进入 solution_review', () => {
    const d = recordDialogue(fresh(), TASK, 'a', [])
    if (!d.ok) throw new Error('setup failed')
    const r = acceptSolution(d.value.state, TASK, { id: 's1', title: '策' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state.stage).toBe('solution_review')
      expect(r.value.state.politicalTasks[0]!.selectedSolutionId).toBe('s1')
    }
  })

  it('未提供 id 时自动生成', () => {
    const d = recordDialogue(fresh(), TASK, 'a', [])
    if (!d.ok) throw new Error('setup failed')
    const r = acceptSolution(d.value.state, TASK, {})
    if (r.ok) expect(r.value.solution.id).toMatch(/^solution_1627-Q1_001$/)
  })
})

describe('颁布圣旨', () => {
  function withSolution(): GameState {
    const d = recordDialogue(fresh(), TASK, 'a', [])
    if (!d.ok) throw new Error('setup failed')
    const s = acceptSolution(d.value.state, TASK, { id: 's1', title: '策' })
    if (!s.ok) throw new Error('setup failed')
    return s.value.state
  }

  it('拒绝空正文', () => {
    expect(issueEdict(fresh(), '   ', []).ok).toBe(false)
  })

  it('任务圣旨必须关联任务', () => {
    expect(issueEdict(fresh(), '诏曰', []).ok).toBe(false)
  })

  it('任务必须先有对话证据', () => {
    expect(issueEdict(fresh(), '诏曰', [TASK]).ok).toBe(false)
  })

  it('必须来自已采纳方案', () => {
    const s = withSolution()
    expect(issueEdict(s, '诏曰', [TASK], 'wrong-id').ok).toBe(false)
  })

  it('合法圣旨落库并进入 edict_drafting', () => {
    const r = issueEdict(withSolution(), '奉天承运皇帝，诏曰：整饬朝纲。钦此', [TASK], 's1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state.stage).toBe('edict_drafting')
      expect(r.value.state.quarterEdicts).toHaveLength(1)
      expect(r.value.edict.edictId).toMatch(/^edict_1627-Q1_001$/)
      expect(r.value.edict.isSettlementEdict).toBe(false)
    }
  })

  it('结算圣旨无需关联任务，进入 quarter_final_edict', () => {
    const r = issueEdict(fresh(), '本季总诏', [], '', [], '', true)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state.stage).toBe('quarter_final_edict')
      expect(r.value.edict.isSettlementEdict).toBe(true)
    }
  })

  it('推演进行中拒绝颁旨', () => {
    const s = withSolution()
    s.simulationInFlight = true
    expect(issueEdict(s, '诏曰', [TASK], 's1').ok).toBe(false)
  })
})

describe('行动机会', () => {
  it('spendAction 递减且不为负', () => {
    let s = fresh()
    s = spendAction(s)
    expect(s.actionsLeft).toBe(2)
    s = spendAction(s)
    s = spendAction(s)
    expect(s.actionsLeft).toBe(0)
    s = spendAction(s)
    expect(s.actionsLeft).toBe(0)
    expect(actionsExhausted(s)).toBe(true)
  })

  it('不修改入参', () => {
    const s = fresh()
    spendAction(s)
    expect(s.actionsLeft).toBe(3)
  })
})

describe('方略', () => {
  it('全国方略无需选省', () => {
    const r = usePolicy(fresh(), 'jiazheng')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.state.pendingActions).toHaveLength(1)
  })

  it('省级方略必须选我方省份', () => {
    expect(usePolicy(fresh(), 'zhenji', '').ok).toBe(false)
    expect(usePolicy(fresh(), 'zhenji', 'shaanxi').ok).toBe(false) // 敌占
    expect(usePolicy(fresh(), 'zhenji', 'shanxi').ok).toBe(true)
  })

  it('拒绝未知方略', () => {
    expect(usePolicy(fresh(), 'nope').ok).toBe(false)
  })

  it('国库不足时拒绝', () => {
    const s = fresh()
    s.treasury = 10
    expect(usePolicy(s, 'zhenji', 'shanxi').ok).toBe(false)
  })

  it('行动用尽时拒绝', () => {
    const s = fresh()
    s.actionsLeft = 0
    expect(usePolicy(s, 'jiazheng').ok).toBe(false)
  })
})

describe('任命与罢免', () => {
  it('任命记入待推演队列', () => {
    const r = appointMinister(fresh(), 'shoufu', 'a')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.state.pendingActions[0]).toMatchObject({ type: 'appoint', position: 'shoufu' })
  })

  it('拒绝未知官职与不存在的大臣', () => {
    expect(appointMinister(fresh(), 'king', 'a').ok).toBe(false)
    expect(appointMinister(fresh(), 'shoufu', 'ghost').ok).toBe(false)
  })

  it('罢免需该官职有人担任', () => {
    const s = fresh()
    s.appointments = {}
    expect(dismissMinister(s, 'shoufu').ok).toBe(false)
    s.appointments.shoufu = 'a'
    expect(dismissMinister(s, 'shoufu').ok).toBe(true)
  })
})

describe('军务', () => {
  it('canDispatchFrom 要求我方、相邻、敌占、兵力>=5', () => {
    const src = { owner: 'ming', adjacent: ['shaanxi'], garrison: 10 }
    expect(canDispatchFrom(src, { id: 'shaanxi', owner: 'rebel' })).toBe(true)
    expect(canDispatchFrom({ ...src, owner: 'jin' }, { id: 'shaanxi', owner: 'rebel' })).toBe(false)
    expect(canDispatchFrom(src, { id: 'shaanxi', owner: 'ming' })).toBe(false)
    expect(canDispatchFrom(src, { id: 'other', owner: 'rebel' })).toBe(false)
    expect(canDispatchFrom({ ...src, garrison: 4 }, { id: 'shaanxi', owner: 'rebel' })).toBe(false)
  })

  it('出兵校验兵力范围', () => {
    expect(dispatch(fresh(), 'shanxi', 'shaanxi', 2, 'a').ok).toBe(false)
    expect(dispatch(fresh(), 'shanxi', 'shaanxi', 99, 'a').ok).toBe(false)
    expect(dispatch(fresh(), 'shanxi', 'shaanxi', 10, 'a').ok).toBe(true)
  })

  it('拒绝非相邻或非我方出兵', () => {
    expect(dispatch(fresh(), 'jingzhi', 'shaanxi', 10, 'a').ok).toBe(false)
    expect(dispatch(fresh(), 'shaanxi', 'shanxi', 5, 'a').ok).toBe(false)
  })

  it('调兵只能在我方相邻省份之间', () => {
    expect(moveTroops(fresh(), 'jingzhi', 'shanxi', 10).ok).toBe(true)
    expect(moveTroops(fresh(), 'jingzhi', 'shaanxi', 10).ok).toBe(false)
    expect(moveTroops(fresh(), 'shanxi', 'jingzhi', 0).ok).toBe(false)
  })
})

describe('其他', () => {
  it('setStage 不修改入参', () => {
    const s = fresh()
    const next = setStage(s, 'quarter_report')
    expect(next.stage).toBe('quarter_report')
    expect(s.stage).toBe('morning_court')
  })

  it('recruitRandom 把人才从池移入朝廷', () => {
    const r = recruitRandom(fresh(), 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state.pool).toHaveLength(1)
      expect(r.value.state.ministers).toHaveLength(3)
      expect(r.value.minister.id).toBe('p1')
    }
  })

  it('人才池为空时招募失败', () => {
    const s = fresh()
    s.pool = []
    expect(recruitRandom(s, 0).ok).toBe(false)
  })
})
