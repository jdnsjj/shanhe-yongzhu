import { describe, expect, it } from 'vitest'
import {
  activeTasks,
  averageMilitaryMorale,
  averagePublicSupport,
  bestOf,
  createNewGame,
  dateText,
  initialPoliticalTask,
  ministerById,
  mingProvinces,
  normalizeProvince,
  parseMinisters,
  parseProvinces,
  positionOf,
  quarterKey,
  taskById,
} from './state.ts'
import type { Minister, Province } from './types.ts'

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

describe('省份规范化', () => {
  it('把旧字段 pop/morale 映射为民心/军心', () => {
    const p = normalizeProvince({
      id: 'shaanxi', name: '陕西', owner: 'ming',
      tax: 12, garrison: 20, pop: 38, morale: 48,
    })
    expect(p.publicSupport).toBe(38)
    expect(p.militaryMorale).toBe(48)
    expect(p.fort).toBe(2)
    expect(p.mapName).toBe('陕西')
  })

  it('缺省字段有回填', () => {
    const p = normalizeProvince({ id: 'a', name: 'A', owner: 'ming', tax: 1, garrison: 1, pop: 0, morale: 0 })
    expect(p.publicSupport).toBe(0)
    expect(p.adjacent).toEqual([])
  })
})

describe('数据解析', () => {
  it('拒绝非数组 provinces', () => {
    expect(() => parseProvinces({})).toThrow()
  })
  it('拒绝缺少 id 的省份', () => {
    expect(() => parseProvinces([{ name: 'x' }])).toThrow()
  })
  it('解析大臣的 court 与 pool', () => {
    const r = parseMinisters({ court: [{ id: 'a', name: 'A' }], pool: [{ id: 'b', name: 'B' }] })
    expect(r.court).toHaveLength(1)
    expect(r.pool).toHaveLength(1)
    expect(r.court[0]!.faction).toBe('中立')
  })
})

describe('开局状态', () => {
  const provinces = [prov({ id: 'jingzhi', name: '北直隶', tax: 14, garrison: 26 }), prov({ id: 'shanxi', name: '山西' })]
  const court = [min({ id: 'weizhongxian', name: '魏忠贤', politics: 85, command: 15 }), min({ id: 'yuanchonghuan', name: '袁崇焕', politics: 45, command: 96 })]
  const pool = [min({ id: 'sun', name: '孙传庭' })]

  it('沿用旧原型的开局数值', () => {
    const s = createNewGame(provinces, court, pool)
    expect(s.year).toBe(1627)
    expect(s.quarter).toBe(1)
    expect(s.treasury).toBe(120)
    expect(s.courtStability).toBe(50)
    expect(s.rebelPower).toBe(20)
    expect(s.jinPower).toBe(45)
    expect(s.actionsLeft).toBe(3)
    expect(s.stage).toBe('morning_court')
    expect(s.gameEnded).toBe(false)
  })

  it('开局任命首辅与择优的户部/兵部', () => {
    const s = createNewGame(provinces, court, pool)
    expect(s.appointments.shoufu).toBe('weizhongxian')
    expect(s.appointments.hubu).toBe('weizhongxian') // politics 85 最高
    expect(s.appointments.bingshi).toBe('yuanchonghuan') // command 96 最高
  })

  it('开局只有一条活动根任务，且历史已记录', () => {
    const s = createNewGame(provinces, court, pool)
    expect(activeTasks(s)).toHaveLength(1)
    expect(s.politicalTasks[0]!.id).toBe('succession_crisis')
    expect(s.history).toHaveLength(2)
  })

  it('不共享入参数组引用', () => {
    const s = createNewGame(provinces, court, pool)
    s.provinces[0]!.publicSupport = 1
    expect(provinces[0]!.publicSupport).toBe(50)
  })
})

describe('查询', () => {
  // m3 属性最低，开局不会被任命，用于验证 positionOf 的空结果分支
  const s = createNewGame([prov({ id: 'a', tax: 10, garrison: 10, publicSupport: 60, militaryMorale: 40 }), prov({ id: 'b', tax: 30, garrison: 30, publicSupport: 20, militaryMorale: 80 }), prov({ id: 'c', owner: 'jin' })], [min({ id: 'm1', politics: 70 }), min({ id: 'm2', politics: 90 }), min({ id: 'm3', politics: 10, command: 10 })], [])

  it('只统计我方省份', () => {
    expect(mingProvinces(s)).toHaveLength(2)
  })
  it('平均民心按税基加权', () => {
    // (60*10 + 20*30) / 40 = 30
    expect(averagePublicSupport(s)).toBeCloseTo(30, 6)
  })
  it('平均军心按兵力加权', () => {
    // (40*10 + 80*30) / 40 = 70
    expect(averageMilitaryMorale(s)).toBeCloseTo(70, 6)
  })
  it('bestOf 取最高属性', () => {
    expect(bestOf(s, 'politics')!.id).toBe('m2')
  })
  it('taskById / ministerById', () => {
    expect(taskById(s, 'succession_crisis')!.id).toBe('succession_crisis')
    expect(taskById(s, 'nope')).toBeUndefined()
    expect(ministerById(s, 'm1')!.id).toBe('m1')
    expect(ministerById(s, 'nobody')).toBeUndefined()
  })
  it('positionOf 返回所任官职，未任官者返回空串', () => {
    expect(positionOf(s, 'm3')).toBe('')
    s.appointments.hubu = 'm3'
    expect(positionOf(s, 'm3')).toBe('hubu')
  })
  it('日期文本与季度键', () => {
    expect(dateText(s)).toBe('崇祯1年 · 第1季度')
    expect(quarterKey(1627, 1)).toBe('1627-Q1')
    expect(quarterKey(1644, 4)).toBe('1644-Q4')
  })
  it('根任务字段完整', () => {
    const t = initialPoliticalTask('1627-Q1')
    expect(t.status).toBe('active')
    expect(t.requiredDialogue).toBe(true)
    expect(t.obstacles.length).toBeGreaterThan(0)
  })
})
