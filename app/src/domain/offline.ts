/**
 * 离线确定性推演引擎（决策 D1）。
 *
 * 旧原型的 P0 阻塞：季度结算被设计为「必须由 AI 推演」，无 API Key 时一个季度都无法结算，
 * 且 event_raised 信号永不发射，导致 14 个历史事件数据完全不可达。
 *
 * 本模块把旧 game_state.gd 中已成死代码、但已验证的本地公式收编为一等公民的离线模式：
 *   _monthly_income / _monthly_positions / _provinces_turn / _rebel_turn / _jin_turn
 *   jin_battle / _check_end / _pick_event / _condition_ok / resolve_event_province
 *
 * 收益：游戏永远可玩、可单测、可回归；AI 成为**增强**而非**依赖**。
 * 使用可播种的 PRNG，保证同一存档 + 同一种子 = 同一结果（可复现测试）。
 */

import { AI_SCHEMA_VERSION, END_YEAR, POSITIONS } from './constants.ts'
import { averageMilitaryMorale, averagePublicSupport, mingProvinces, quarterKey } from './state.ts'
import { applyAiTransition } from './transition.ts'
import type { AiEffect, Battle, GameState, QuarterEvent, QuarterResult, Province } from './types.ts'

/** mulberry32：小巧、快速、可播种的确定性 PRNG。 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** 季度税收（对应 _monthly_income）。 */
export function quarterlyIncome(state: GameState): number {
  let income = 0
  for (const p of mingProvinces(state)) {
    income += p.tax * (0.5 + p.publicSupport / 100)
  }
  const hubuId = state.appointments.hubu
  const hubu = hubuId ? state.ministers.find((m) => m.id === hubuId) : undefined
  if (hubu) income *= 1 + hubu.politics / 600
  if (state.taxCutMonths > 0) income *= 0.7
  return Math.round(income)
}

/** 官职带来的季度修正（对应 _monthly_positions）。 */
function applyPositions(state: GameState, report: string[], rng: () => number): void {
  const shoufu = ministerAt(state, 'shoufu')
  if (shoufu) state.courtStability = clamp(state.courtStability + shoufu.politics / 50, 0, 100)

  const bingshi = ministerAt(state, 'bingshi')
  if (bingshi) {
    for (const p of mingProvinces(state)) {
      p.militaryMorale = clamp(p.militaryMorale + bingshi.command / 50, 0, 100)
    }
  }

  const lijun = ministerAt(state, 'lijun')
  if (lijun) {
    for (const m of state.ministers) m.loyalty = clamp(m.loyalty + lijun.wisdom / 200, 0, 100)
  }

  const xingbu = ministerAt(state, 'xingbu')
  if (xingbu) state.courtStability = clamp(state.courtStability + xingbu.wisdom / 100, 0, 100)

  const gongbu = ministerAt(state, 'gongbu')
  if (gongbu && (state.year * 12 + state.month) % 3 === 0) {
    const cands = mingProvinces(state)
    if (cands.length > 0) {
      const p = cands[Math.floor(rng() * cands.length)]!
      p.fort = Math.min(p.fort + 1, 6)
      report.push(`工部修缮${p.name}城防至 ${p.fort} 级。`)
    }
  }
}

function ministerAt(state: GameState, pos: keyof typeof POSITIONS) {
  const id = state.appointments[pos]
  return id ? state.ministers.find((m) => m.id === id) : undefined
}

/** 各省自然演变与欠饷哗变（对应 _provinces_turn）。 */
function provincesTurn(state: GameState, rng: () => number): void {
  for (const p of mingProvinces(state)) {
    // 民心向 50 缓慢回归，并有末期下行压力
    p.publicSupport = clamp(p.publicSupport + (50 - p.publicSupport) * 0.02 - 0.15, 0, 100)
    // 军心向 55 回归
    p.militaryMorale = clamp(p.militaryMorale + (55 - p.militaryMorale) * 0.03, 0, 100)
  }

  if (state.treasury < 80) {
    const risky = mingProvinces(state).filter((p) => p.militaryMorale < 35 && p.garrison > 5)
    if (risky.length > 0 && rng() < 0.18) {
      const p = risky[Math.floor(rng() * risky.length)]!
      p.garrison = Math.max(p.garrison * 0.9, 2)
      p.militaryMorale = clamp(p.militaryMorale - 3, 0, 100)
      state.history.push(`${p.name}军士因欠饷哗变，逃亡者众。（该省兵力-10%）`)
    }
  }
}

/** 流寇滋生、民变与攻城（对应 _rebel_turn）。 */
function rebelTurn(state: GameState, rng: () => number, battles: Battle[], events: QuarterEvent[]): void {
  const mp = mingProvinces(state)
  if (mp.length === 0) return

  let lowSupport = 0
  for (const p of mp) lowSupport += Math.max(0, 45 - p.publicSupport) / 10
  state.rebelPower = Math.min(state.rebelPower + (0.5 + lowSupport), 150)

  // 民变：民心极低的省份可能直接举义
  for (const p of mp) {
    if (p.publicSupport < 18 && rng() < 0.1 && !state.firedOnce.includes(`offline-revolt:${p.id}`)) {
      p.owner = 'rebel'
      p.garrison = Math.max(state.rebelPower * 0.25, 6)
      state.rebelPower = Math.max(state.rebelPower - 8, 0)
      const narrative = `${p.name}民变骤起，举城从贼！`
      state.history.push(narrative)
      events.push({ id: `offline-revolt:${p.id}`, title: '民变骤起', narrative })
      state.firedOnce.push(`offline-revolt:${p.id}`)
      return
    }
  }

  // 流寇攻城
  if (state.rebelPower >= 85 && rng() < 0.45) {
    const target = lowestSupport(mp)
    if (!target) return
    const atk = state.rebelPower * 0.35 * (0.9 + rng() * 0.25)
    const def =
      target.garrison *
      (1 + target.fort * 0.12) *
      clamp(target.militaryMorale / 60, 0.6, 1.3) *
      (0.9 + rng() * 0.25)
    const outcome = atk > def ? 'attacker_win' : 'defender_win'
    battles.push({ source: 'rebel', target: target.id, outcome })
    if (outcome === 'attacker_win') {
      target.owner = 'rebel'
      target.garrison = state.rebelPower * 0.3
      target.publicSupport = clamp(target.publicSupport - 15, 0, 100)
      state.rebelPower = Math.max(state.rebelPower - 12, 0)
      const narrative = `流寇攻陷${target.name}！守军溃散，望风而降者不可胜数。`
      state.history.push(narrative)
      events.push({ id: 'offline-rebel-assault', title: '流寇攻城', narrative })
    } else {
      state.rebelPower = Math.max(state.rebelPower - 8, 0)
      target.garrison = Math.max(target.garrison * 0.85, 2)
      const narrative = `流寇围攻${target.name}，为守军力战所却。`
      state.history.push(narrative)
      events.push({ id: 'offline-rebel-defense', title: '守军拒寇', narrative })
    }
  }
}

/** 将史料中的关键年份转成离线可见的季度事件；事件只播报一次。 */
function historicalMilestones(state: GameState, events: QuarterEvent[], notes: string[]): void {
  const milestones: Array<{ id: string; year: number; title: string; narrative: string; choices?: Array<{ id: string; label: string }> }> = [
    { id: 'historical-yichao', year: 1629, title: '裁驿与己巳之变', narrative: '驿站裁撤与后金入塞接踵而至：流民失业，京师告急，朝廷必须在救急与整饬之间取舍。' },
    { id: 'historical-wuqiao', year: 1631, title: '吴桥兵变', narrative: '孔有德等因军饷与军纪兵变，登州火器与海防体系由此出现重大裂隙。' },
    { id: 'historical-korea-aid', year: 1636, title: '朝鲜乞师', narrative: '朝鲜使者请援，关外战事与辽饷压力同时逼近：出兵可守盟约，却会牵动本就吃紧的军粮。', choices: [{ id: 'aid', label: '遣援军守盟约（军粮压力上升）' }, { id: 'hold', label: '暂缓出兵整饬关内（盟约生隙）' }] },
    { id: 'historical-songjin', year: 1641, title: '松锦决战', narrative: '松锦战局牵动关外存亡，催战可求速胜，持重却要承受粮饷与军心压力。', choices: [{ id: 'press', label: '催战决胜（追加军粮）' }, { id: 'hold', label: '持重守关（保存实力）' }] },
    { id: 'historical-peace', year: 1642, title: '和议风波', narrative: '陈新甲议和事泄，朝廷在主战与和谈之间的裂痕彻底公开。', choices: [{ id: 'negotiate', label: '暂允和议（稳住朝堂）' }, { id: 'reject', label: '驳回和议（坚持主战）' }] },
  ]
  for (const milestone of milestones) {
    if (state.year !== milestone.year || state.firedOnce.includes(milestone.id)) continue
    events.push({ id: milestone.id, title: milestone.title, narrative: milestone.narrative, ...(milestone.choices ? { choices: milestone.choices } : {}) })
    notes.push(milestone.narrative)
  }
}

function lowestSupport(list: Province[]): Province | undefined {
  let best: Province | undefined
  for (const p of list) if (!best || p.publicSupport < best.publicSupport) best = p
  return best
}

/** 后金势长（对应 _jin_turn）。 */
function jinTurn(state: GameState): void {
  state.jinPower = Math.min(state.jinPower + 1.2, 120)
}

/** 京师保卫战（对应 jin_battle）。 */
export function jinBattle(state: GameState, defendBonus: number, rng: () => number): string {
  const jingzhi = state.provinces.find((p) => p.id === 'jingzhi')
  if (!jingzhi || jingzhi.owner !== 'ming' || state.jinPower <= 0) {
    return '（后金主力未动，此战未起。）'
  }
  const atk = state.jinPower * 0.42 * (0.9 + rng() * 0.25)
  let def =
    jingzhi.garrison *
    (1 + jingzhi.fort * 0.15) *
    clamp(jingzhi.militaryMorale / 60, 0.6, 1.3) *
    (0.9 + rng() * 0.25) *
    defendBonus
  const bingshi = ministerAt(state, 'bingshi')
  if (bingshi) def *= 1 + bingshi.command / 400

  if (atk > def) {
    jingzhi.owner = 'jin'
    jingzhi.garrison = state.jinPower * 0.3
    state.history.push('八旗铁骑踏破京师！社稷倾覆……')
    return '京师陷落！宗庙震惊，天下崩坏。'
  }
  jingzhi.garrison = Math.max(jingzhi.garrison * 0.8, 2)
  state.jinPower = Math.max(state.jinPower - 8, 0)
  jingzhi.militaryMorale = clamp(jingzhi.militaryMorale + 5, 0, 100)
  state.history.push('后金入犯京畿，勤王军力战却敌！')
  return '后金顿兵城下，损兵折将而退。（京畿军心+5，后金-8）'
}

/**
 * 把「推演前 -> 推演后」的状态差异转换为标准 effects。
 *
 * 这样离线推演产出的结果能复用与 AI 完全相同的落库管线
 * （applyAiTransition 的夹紧逻辑 + zod 协议校验 + 事务提交），
 * 避免离线模式另起一套状态写入路径。
 */
export function diffEffects(before: GameState, after: GameState): AiEffect[] {
  const effects: AiEffect[] = []

  const pushGlobal = (field: string, delta: number, reason: string): void => {
    if (Math.abs(delta) > 1e-9) effects.push({ target: 'global', field, delta, reason })
  }
  pushGlobal('treasury', after.treasury - before.treasury, '季度结算')
  pushGlobal('court_stability', after.courtStability - before.courtStability, '朝堂演变')
  pushGlobal('rebel_power', after.rebelPower - before.rebelPower, '流寇滋长')
  pushGlobal('jin_power', after.jinPower - before.jinPower, '后金势长')

  const beforeProv = new Map(before.provinces.map((p) => [p.id, p]))
  for (const p of after.provinces) {
    const b = beforeProv.get(p.id)
    if (!b) continue
    if (b.owner !== p.owner) {
      effects.push({ target: `province:${p.id}`, field: 'owner', delta: p.owner, reason: '归属变更' })
    }
    const push = (field: string, delta: number, reason: string): void => {
      if (Math.abs(delta) > 1e-9) effects.push({ target: `province:${p.id}`, field, delta, reason })
    }
    push('pop', p.publicSupport - b.publicSupport, '民心演变')
    push('morale', p.militaryMorale - b.militaryMorale, '军心演变')
    push('garrison', p.garrison - b.garrison, '兵力变动')
    push('fort', Math.trunc(p.fort) - Math.trunc(b.fort), '城防变动')
  }

  const beforeMin = new Map(before.ministers.map((m) => [m.id, m]))
  for (const m of after.ministers) {
    const b = beforeMin.get(m.id)
    if (b && Math.abs(m.loyalty - b.loyalty) > 1e-9) {
      effects.push({ target: `minister:${m.id}`, field: 'loyalty', delta: m.loyalty - b.loyalty, reason: '忠诚变动' })
    }
  }
  // 人才池 -> 朝廷（招募）
  const beforeMinisterIds = new Set(before.ministers.map((m) => m.id))
  for (const m of after.ministers) {
    if (!beforeMinisterIds.has(m.id) && before.pool.some((p) => p.id === m.id)) {
      effects.push({ target: 'global', field: 'recruit', delta: m.id, reason: '擢用在野人才' })
    }
  }

  // 官职变更
  for (const [pos, mid] of Object.entries(after.appointments)) {
    if (before.appointments[pos as keyof typeof before.appointments] !== mid) {
      effects.push({ target: `position:${pos}`, field: 'appointment', delta: mid ?? '', reason: '任命变更' })
    }
  }
  for (const pos of Object.keys(before.appointments)) {
    if (after.appointments[pos as keyof typeof after.appointments] === undefined) {
      effects.push({ target: `position:${pos}`, field: 'appointment', delta: '', reason: '罢免' })
    }
  }

  return effects
}

export type EndStatus = 'ongoing' | 'victory' | 'defeat'

/** 终局判定（对应 _check_end）。 */
export function checkEnd(state: GameState): { status: EndStatus; reason: string } {
  if (state.treasury <= -300) {
    return { status: 'defeat', reason: '国库枯竭，百官俸禄断绝，天下大乱，社稷倾覆。' }
  }
  const mp = mingProvinces(state)
  if (averagePublicSupport(state) <= 8 && mp.length <= 12) {
    return { status: 'defeat', reason: '民心尽失，四方鼎沸，闯王入京，社稷倾覆。' }
  }
  if (mp.length <= 6) {
    return { status: 'defeat', reason: '山河破碎，半壁尽失，大明社稷名存实亡。' }
  }
  if (state.year > END_YEAR || (state.year === END_YEAR && state.month > 12)) {
    if (averagePublicSupport(state) >= 55 && state.courtStability >= 45 && mp.length >= 14) {
      return {
        status: 'victory',
        reason: '崇祯十七载，你挽狂澜于既倒。民心归附，朝堂整肃，山河光复——山河永驻，日月重光！',
      }
    }
    if (mp.length >= 10) {
      return {
        status: 'victory',
        reason: '崇祯十七载，大明虽伤痕累累，终得延续。史书将记下：思宗，中兴之主也。',
      }
    }
    return { status: 'defeat', reason: '崇祯十七载至，疆土沦丧过半，大明仅存残喘，终为后人所叹。' }
  }
  return { status: 'ongoing', reason: '' }
}

/**
 * 离线推演一个季度：把玩家已提交的行动 + 本地公式合成为标准 QuarterResult，
 * 从而复用与 AI 完全相同的校验与落库管线。
 */
export function simulateQuarterOffline(state: GameState, seed: number): QuarterResult {
  const rng = createRng(seed)
  const working = structuredClone(state)
  const effects: AiEffect[] = []
  const notes: string[] = []
  const events: QuarterEvent[] = []
  const battles: Battle[] = []

  // 1) 玩家行动（政策 / 任命 / 调兵 / 出兵）
  for (const action of working.pendingActions) {
    switch (action.type) {
      case 'policy': {
        switch (action.id) {
          case 'jianmian':
            for (const p of mingProvinces(working)) {
              effects.push({ target: `province:${p.id}`, field: 'pop', delta: 3, reason: '蠲免逋赋' })
            }
            notes.push('通行蠲免逋赋，各省民心稍苏。')
            break
          case 'jiazheng':
            effects.push({ target: 'global', field: 'treasury', delta: 80, reason: '加征三饷' })
            for (const p of mingProvinces(working)) {
              effects.push({ target: `province:${p.id}`, field: 'pop', delta: -4, reason: '加派致怨' })
            }
            notes.push('加征三饷得银八十万两，然民间怨声载道。')
            break
          case 'zhenji': {
            const prov = working.provinces.find((p) => p.id === action.provinceId)
            if (prov) {
              effects.push({ target: `province:${prov.id}`, field: 'pop', delta: 15, reason: '开仓赈济' })
              notes.push(`开仓赈济${prov.name}，饥民得食。`)
            }
            break
          }
          case 'lianbing': {
            const prov = working.provinces.find((p) => p.id === action.provinceId)
            if (prov) {
              const gain = Math.min(prov.garrison * 0.2, 30 - prov.garrison)
              effects.push({ target: `province:${prov.id}`, field: 'garrison', delta: Math.round(gain), reason: '整饬军务' })
              effects.push({ target: `province:${prov.id}`, field: 'morale', delta: 15, reason: '整饬军务' })
              notes.push(`整饬${prov.name}军务，士气一振。`)
            }
            break
          }
          case 'xiulv': {
            const prov = working.provinces.find((p) => p.id === action.provinceId)
            if (prov) {
              effects.push({ target: `province:${prov.id}`, field: 'fort', delta: 1, reason: '修缮城防' })
              notes.push(`修缮${prov.name}城防。`)
            }
            break
          }
          case 'keju': {
            const candidate = working.pool[Math.floor(rng() * working.pool.length)]
            if (candidate) {
              effects.push({ target: 'global', field: 'recruit', delta: candidate.id, reason: '开科取士' })
              notes.push(`开科取士，${candidate.name}入朝。`)
            }
            break
          }
          case 'zhaofu': {
            const prov = working.provinces.find((p) => p.id === action.provinceId)
            if (prov) {
              effects.push({ target: `province:${prov.id}`, field: 'pop', delta: 10, reason: '招抚流民' })
              effects.push({ target: 'global', field: 'rebel_power', delta: -5, reason: '招抚流民' })
              notes.push(`招抚${prov.name}流民，啸聚者渐散。`)
            }
            break
          }
          default:
            break
        }
        break
      }
      case 'appoint':
        effects.push({ target: `position:${action.position}`, field: 'appointment', delta: action.ministerId, reason: '任命' })
        notes.push(`任命更新：${POSITIONS[action.position].name}。`)
        break
      case 'dismiss':
        effects.push({ target: `position:${action.position}`, field: 'appointment', delta: '', reason: '罢免' })
        notes.push(`罢${POSITIONS[action.position].name}。`)
        break
      case 'battle': {
        const src = working.provinces.find((p) => p.id === action.source)
        const tgt = working.provinces.find((p) => p.id === action.target)
        if (src && tgt) {
          const atk = action.troops * (1 + (rng() - 0.4) * 0.5)
          const def = tgt.garrison * (1 + tgt.fort * 0.12) * clamp(tgt.militaryMorale / 60, 0.6, 1.3)
          if (atk > def) {
            tgt.owner = 'ming'
            tgt.garrison = Math.max(action.troops * 0.6, 2)
            src.garrison = Math.max(src.garrison - action.troops, 2)
            notes.push(`${src.name}出兵${tgt.name}，克复其城！`)
          } else {
            src.garrison = Math.max(src.garrison - action.troops * 0.7, 2)
            notes.push(`${src.name}出兵${tgt.name}，师出不利，退守本境。`)
          }
        }
        break
      }
      case 'move_troops': {
        const src = working.provinces.find((p) => p.id === action.source)
        const tgt = working.provinces.find((p) => p.id === action.target)
        if (src && tgt) {
          const moved = Math.min(action.troops, Math.max(src.garrison - 2, 0))
          src.garrison = Math.max(src.garrison - moved, 2)
          tgt.garrison = Math.min(tgt.garrison + moved, 30)
          notes.push(`调${Math.round(moved)}万兵自${src.name}移驻${tgt.name}。`)
        }
        break
      }
    }
  }

  // 2) 先落地玩家行动，使后续公式基于最新状态
  const afterActions = applyAiTransition(working, effects).state

  // 3) 本地公式推演
  const next = structuredClone(afterActions)
  const income = quarterlyIncome(next)
  next.treasury += income
  notes.push(`户部奏报：本季税收${income}万两。`)

  applyPositions(next, notes, rng)
  provincesTurn(next, rng)
  rebelTurn(next, rng, battles, events)
  jinTurn(next)
  historicalMilestones(next, events, notes)

  // 4) 任务推进：有对话证据且进展良好则推进进度
  const taskUpdates = next.politicalTasks.map((t) => {
    const hasEvidence = next.currentQuarterDialogues.some((d) => d.taskId === t.id) ||
      next.currentQuarterDebates.some((d) => d.taskId === t.id)
    const progress = clamp(t.progress + (hasEvidence ? 1 : 0), 0, 3)
    return {
      taskId: t.id,
      status: t.status,
      progress,
      continuation: hasEvidence ? '议事已具，来季当定施行之策。' : t.continuation,
    }
  })

  const end = checkEnd(next)
  const narrativeParts = [...notes]
  narrativeParts.push(`流寇势力${Math.trunc(next.rebelPower)}，后金势力${Math.trunc(next.jinPower)}。`)

  return {
    schemaVersion: AI_SCHEMA_VERSION,
    quarterSummary: notes.join(' '),
    narrative: narrativeParts.join(' '),
    treasury: { delta: income },
    // 关键：把推演后的真实状态差异交回标准管线落库，
    // 否则叙事描述了变化、世界状态却毫无变化。
    effects: diffEffects(state, next),
    events,
    battles,
    taskUpdates,
    nextQuarterTasks: [],
    endEvaluation: { status: end.status, reason: end.reason },
  }
}

/** 供测试与离线模式共用的季度键。 */
export { quarterKey }
export { averagePublicSupport, averageMilitaryMorale }
