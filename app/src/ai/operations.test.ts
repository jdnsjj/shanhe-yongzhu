import { describe, expect, it, vi } from 'vitest'
import { LlmClient } from './client.ts'
import { AiOperations, stateSnapshot } from './operations.ts'
import { PREFIX_QUARTER, PREFIX_VALIDATE, ministerPrefix } from './prefixes.ts'
import { createNewGame } from '../domain/state.ts'
import type { GameState, Minister, Province } from '../domain/types.ts'

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
function game(): GameState {
  return createNewGame([prov({ id: 'shaanxi', name: '陕西' })], [min({ id: 'a', name: '甲' })], [min({ id: 'p', name: '野' })])
}

function clientWith(payload: unknown) {
  const f = vi.fn(async (_url: string, _init?: RequestInit) =>
    ({ ok: true, status: 200, json: async () => payload }) as unknown as Response,
  )
  return { client: new LlmClient({ config: { baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm' }, fetchImpl: f }), f }
}
const okPayload = { choices: [{ message: { content: '{"ok":true}' } }] }
function argsOf(f: { mock: { calls: unknown[][] } }, n = 0): [string, RequestInit] {
  const c = f.mock.calls[n]
  if (!c) throw new Error('not called')
  return c as [string, RequestInit]
}

describe('状态快照', () => {
  it('把旧字段名映射回 AI 协议口径', () => {
    const s = game()
    const snap = stateSnapshot(s)
    const p = (snap['provinces'] as Array<Record<string, unknown>>)[0]!
    expect(p['pop']).toBe(50) // 民心
    expect(p['morale']).toBe(50) // 军心
    expect(p['adj']).toEqual([])
  })

  it('包含官职名称而非仅 id', () => {
    const s = game()
    s.appointments = { shoufu: 'a' }
    const snap = stateSnapshot(s)
    const m = (snap['ministers'] as Array<Record<string, unknown>>)[0]!
    expect(m['position']).toBe('内阁首辅')
  })

  it('历史只保留最近 12 条', () => {
    const s = game()
    s.history = Array.from({ length: 40 }, (_, i) => 'h' + i)
    expect((stateSnapshot(s)['history'] as string[]).length).toBe(12)
  })
})

describe('提示词前缀', () => {
  it('季度前缀包含协议关键约束', () => {
    expect(PREFIX_QUARTER).toContain('schema_version=1')
    expect(PREFIX_QUARTER).toContain('pending_actions 只能结算一次')
    expect(PREFIX_QUARTER).toContain('recruit')
  })

  it('校验前缀不修改状态', () => {
    expect(PREFIX_VALIDATE).toContain('不要修改状态')
  })

  it('大臣前缀嵌入人物设定与属性', () => {
    const p = ministerPrefix({ name: '袁崇焕', title: '督师', faction: '帝党', persona: '自负豪迈', politics: 45, command: 96, wisdom: 72, loyalty: 60, ambition: 55 })
    expect(p).toContain('袁崇焕')
    expect(p).toContain('统率96')
    expect(p).toContain('自负豪迈')
    expect(p).toContain('不得改变世界状态')
  })
})

describe('AI 操作', () => {
  it('召对使用大臣专属前缀并传入用户文本', async () => {
    const { client, f } = clientWith(okPayload)
    const ops = new AiOperations(client)
    const s = game()
    const r = await ops.chatWithMinister(s.ministers[0]!, s.politicalTasks[0]!, [], stateSnapshot(s), '辽东如何', 0)
    expect(r.ok).toBe(true)
    const body = JSON.parse(String(argsOf(f)[1].body))
    expect(body.messages[0].content).toContain('甲')
    expect(JSON.parse(body.messages[1].content).user_text).toBe('辽东如何')
  })

  it('季度推演使用季度前缀并携带全部议事证据', async () => {
    const { client, f } = clientWith(okPayload)
    const ops = new AiOperations(client)
    const s = game()
    const r = await ops.simulateQuarter(stateSnapshot(s), s.politicalTasks, {
      bulletins: [{ id: 'b1' }], dialogues: [], debates: [], decisions: [], pendingActions: [], summaries: [],
    }, [], ['史'])
    expect(r.ok).toBe(true)
    const body = JSON.parse(String(argsOf(f)[1].body))
    expect(body.messages[0].content).toContain('季度世界推演引擎')
    const payload = JSON.parse(body.messages[1].content)
    expect(payload.quarter_inputs.bulletins).toHaveLength(1)
    expect(payload.formal_edicts).toEqual([])
  })

  it('语义校验传入前态与提议态', async () => {
    const { client, f } = clientWith(okPayload)
    const ops = new AiOperations(client)
    await ops.validateState({ treasury: 1 }, { treasury: 2 }, 0)
    const body = JSON.parse(String(argsOf(f)[1].body))
    expect(body.messages[0].content).toContain('语义校验官')
    expect(JSON.parse(body.messages[1].content)).toEqual({ before: { treasury: 1 }, proposed: { treasury: 2 } })
  })

  it('未配置时所有操作返回未连接错误', async () => {
    const ops = new AiOperations(new LlmClient())
    const s = game()
    const r = await ops.simulateQuarter(stateSnapshot(s), [], { bulletins: [], dialogues: [], debates: [], decisions: [], pendingActions: [], summaries: [] }, [], [])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未连接')
  })

  it('奏折/朝会/方案/拟旨均可调用', async () => {
    const { client } = clientWith(okPayload)
    const ops = new AiOperations(client)
    const s = game()
    const snap = stateSnapshot(s)
    const task = s.politicalTasks[0]!
    expect((await ops.generateQuarterBulletins(snap, [], {}, 0)).ok).toBe(true)
    expect((await ops.runCourtDebate(snap, task, s.ministers, [], 0)).ok).toBe(true)
    expect((await ops.deriveTaskSolution(snap, task, [], [], [], 0)).ok).toBe(true)
    expect((await ops.draftEdictFromDialogue(snap, task, [], 0)).ok).toBe(true)
    expect((await ops.resolveBattle(snap, {})).ok).toBe(true)
    expect((await ops.resolveEventChoice(snap, {}, {})).ok).toBe(true)
    expect((await ops.evaluateGameEnd(snap, 0)).ok).toBe(true)
    expect((await ops.simulateEdict(snap, [], '诏曰')).ok).toBe(true)
  })

  it('空诏书文本被替换为占位说明', async () => {
    const { client, f } = clientWith(okPayload)
    const ops = new AiOperations(client)
    await ops.simulateEdict({}, [], '   ')
    const body = JSON.parse(String(argsOf(f)[1].body))
    expect(JSON.parse(body.messages[1].content).edict).toContain('未下诏')
  })
})
