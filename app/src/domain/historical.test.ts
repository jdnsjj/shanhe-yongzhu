import { describe, expect, it } from 'vitest'
import { historicalContext } from './historical.ts'

describe('历史资料仅作为 AI 背景', () => {
  it('去除固定数值、概率与预设结果', () => {
    const source = [{ id: 'test', title: '事件', text: '背景', min_year: 1628, chance: 1, choices: [{ label: '赈济', effects: { treasury: -50 }, result: '必胜' }] }]
    const context = historicalContext(source, 1628)
    expect(context).toEqual([{ id: 'test', title: '事件', background: '背景', earliest_year: 1628, condition: undefined, once: undefined, possible_responses: ['赈济'] }])
    expect(JSON.stringify(context)).not.toContain('effects')
    expect(source[0].choices[0].effects.treasury).toBe(-50)
  })
  it('未来事件不进入当前季度背景', () => {
    expect(historicalContext([{ min_year: 1641 }], 1628)).toEqual([])
  })
  it('资料格式不合法时拒绝推演', () => {
    expect(() => historicalContext({}, 1628)).toThrow('历史事件资料格式无效')
  })
})
