import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGame } from './store.ts'
import { AiOperations } from './ai/operations.ts'
import { createNewGame } from './domain/state.ts'
import type { Minister, Province } from './domain/types.ts'

const p: Province = { id: 'jingzhi', name: '京畿', mapName: '', historicalScope: '', owner: 'ming', tax: 10, garrison: 10, publicSupport: 50, militaryMorale: 50, fort: 2, adjacent: [] }
const m: Minister = { id: 'm', name: '某臣', title: '', faction: '中立', politics: 50, command: 50, wisdom: 50, loyalty: 50, ambition: 50, traits: [], desc: '', persona: '' }
const result = { schema_version: 1, narrative: '执行圣旨', effects: [], events: [], battles: [], task_updates: [], next_quarter_tasks: [], end_evaluation: { status: 'ongoing' } }

async function boot(enabled: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/config.json' ? { api_key: enabled ? 'test-only' : '', base_url: 'https://test.invalid', model: 'test' } : [] })))
  await useGame.getState().boot()
}

beforeEach(() => {
  vi.restoreAllMocks()
  useGame.setState({ state: createNewGame([p], [m], []), busy: false, chats: {}, dialog: null })
})

describe('正式玩法全 AI 驱动', () => {
  it('未配置 AI 时不结算也不伪造大臣回复', async () => {
    await boot(false)
    const before = structuredClone(useGame.getState().state)
    const call = vi.spyOn(AiOperations.prototype, 'simulateQuarter')
    await useGame.getState().settleQuarter('赈灾')
    await useGame.getState().chatWithMinister(m, before!.politicalTasks[0]!.id, '如何赈灾')
    expect(useGame.getState().state).toEqual(before)
    expect(useGame.getState().chats).toEqual({})
    expect(call).not.toHaveBeenCalled()
  })
  it('结算圣旨送入 AI，成功才推进回合', async () => {
    await boot(true)
    const call = vi.spyOn(AiOperations.prototype, 'simulateQuarter').mockResolvedValue({ ok: true, data: result })
    await useGame.getState().settleQuarter('开仓赈济陕西')
    expect(call.mock.calls[0]![3]).toEqual(expect.arrayContaining([expect.objectContaining({ text: '开仓赈济陕西', isSettlementEdict: true })]))
    expect(useGame.getState().state!.quarter).toBe(2)
  })
  it('AI 失败不推进，已颁圣旨保留供重试', async () => {
    await boot(true)
    vi.spyOn(AiOperations.prototype, 'simulateQuarter').mockResolvedValue({ ok: false, error: '断线' })
    await useGame.getState().settleQuarter('补发欠饷')
    expect(useGame.getState().state!.quarter).toBe(1)
    expect(useGame.getState().state!.quarterEdicts[0]!.text).toBe('补发欠饷')
    expect(useGame.getState().busy).toBe(false)
  })
  it('非法历史裁决不记选择、不改变国势', async () => {
    await boot(true)
    const s = useGame.getState().state!
    s.quarterReports.push({ quarter: '1627Q1', narrative: '', quarterSummary: '', treasury: {}, events: [{ id: 'historical-test', narrative: '背景', choices: [{ id: 'aid', label: '援助' }] }], battles: [], taskUpdates: [], edicts: [], validation: {}, endEvaluation: {} })
    const before = structuredClone(s)
    vi.spyOn(AiOperations.prototype, 'resolveEventChoice').mockResolvedValue({ ok: true, data: { schema_version: 1, narrative: '援助', effects: [{ target: 'province:missing', field: 'pop', delta: 1 }] } })
    await useGame.getState().chooseHistoricalEvent('historical-test', 'aid')
    expect(useGame.getState().state).toEqual(before)
  })
  it('历史裁决由 AI 指定效果且只能提交一次', async () => {
    await boot(true)
    const s = useGame.getState().state!
    s.quarterReports.push({ quarter: '1627Q1', narrative: '', quarterSummary: '', treasury: {}, events: [{ id: 'historical-test', narrative: '背景', choices: [{ id: 'aid', label: '援助' }] }], battles: [], taskUpdates: [], edicts: [], validation: {}, endEvaluation: {} })
    const call = vi.spyOn(AiOperations.prototype, 'resolveEventChoice').mockResolvedValue({ ok: true, data: { schema_version: 1, narrative: '耗银七万两', effects: [{ target: 'global', field: 'treasury', delta: -7 }] } })
    const treasury = s.treasury
    await useGame.getState().chooseHistoricalEvent('historical-test', 'aid')
    await useGame.getState().chooseHistoricalEvent('historical-test', 'aid')
    expect(useGame.getState().state!.treasury).toBe(treasury - 7)
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('据召对拟旨只产生草稿，不提前改变国势', async () => {
    await boot(true)
    const s = useGame.getState().state!
    useGame.getState().dialogue(s.politicalTasks[0]!.id, m.id, [{ role: 'user', content: '赈灾' }, { role: 'assistant', content: '开仓并遣官核粮' }])
    vi.spyOn(AiOperations.prototype, 'draftEdictFromDialogue').mockResolvedValue({ ok: true, data: { edict_text: '奉天承运皇帝，诏曰：开仓赈济。钦此', summary: '赈灾' } })
    await useGame.getState().draftTaskEdict(s.politicalTasks[0]!.id)
    expect(useGame.getState().dialog).toBe('edict')
    expect(useGame.getState().state!.quarterEdicts).toHaveLength(0)
    expect(useGame.getState().state!.treasury).toBe(s.treasury)
  })
})
