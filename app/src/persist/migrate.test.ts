import { describe, expect, it } from 'vitest'
import { SAVE_VERSION } from '../domain/constants.ts'
import { deserializeSave, migrateGodotSave, serializeSave } from './migrate.ts'
import { MemoryStorage, SaveManager } from './storage.ts'
import godotSave from './__fixtures__/godot-save-v5.json'
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

describe('真实 Godot 存档迁移', () => {
  const file = migrateGodotSave(godotSave)

  it('版本被标记为当前版本', () => {
    expect(file.version).toBe(SAVE_VERSION)
  })

  it('迁移 15 个明代行政区，字段名映射正确', () => {
    const s = file.state
    expect(s.provinces).toHaveLength(15)
    const jingzhi = s.provinces.find((p) => p.id === 'jingzhi')!
    expect(jingzhi.name).toBe('北直隶')
    expect(jingzhi.publicSupport).toBe(55) // 旧 pop
    expect(jingzhi.militaryMorale).toBe(40) // 旧 morale
    expect(jingzhi.fort).toBe(5)
    expect(jingzhi.garrison).toBe(26)
    expect(jingzhi.historicalScope).toContain('北直隶')
    expect(jingzhi.adjacent).toContain('shanxi')
  })

  it('迁移 12 位朝中大臣与 12 位在野人才', () => {
    expect(file.state.ministers).toHaveLength(12)
    expect(file.state.pool).toHaveLength(12)
    const wei = file.state.ministers.find((m) => m.id === 'weizhongxian')!
    expect(wei.name).toBe('魏忠贤')
    expect(wei.faction).toBe('阉党')
    expect(wei.politics).toBe(85)
    expect(wei.persona.length).toBeGreaterThan(0)
  })

  it('迁移官职任命', () => {
    expect(file.state.appointments.shoufu).toBe('weizhongxian')
    expect(file.state.appointments.hubu).toBe('bizly')
    expect(file.state.appointments.bingshi).toBe('yuanchonghuan')
  })

  it('迁移全局数值与日期', () => {
    const s = file.state
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

  it('迁移时政任务（snake_case -> camelCase）', () => {
    expect(file.state.politicalTasks).toHaveLength(1)
    const t = file.state.politicalTasks[0]!
    expect(t.id).toBe('succession_crisis')
    expect(t.status).toBe('active')
    expect(t.requiredDialogue).toBe(true)
    expect(t.createdQuarter).toBe('1627-Q1')
    expect(t.obstacles.length).toBeGreaterThan(0)
  })

  it('迁移历史记录', () => {
    expect(file.state.history.length).toBeGreaterThan(0)
    expect(file.state.history[0]).toContain('天启帝')
  })

  it('推演进行中标记被重置', () => {
    expect(file.state.simulationInFlight).toBe(false)
    expect(file.state.bulletinInFlight).toBe(false)
  })

  it('迁移后的存档可再次序列化并往返', () => {
    const text = serializeSave(file.state)
    const round = deserializeSave(text)
    expect(round.state.provinces).toHaveLength(15)
    expect(round.state.treasury).toBe(file.state.treasury)
    expect(round.state.politicalTasks[0]!.id).toBe('succession_crisis')
  })
})

describe('迁移健壮性', () => {
  it('拒绝非对象', () => {
    expect(() => migrateGodotSave(null)).toThrow()
    expect(() => migrateGodotSave('x')).toThrow()
    expect(() => migrateGodotSave([])).toThrow()
  })

  it('拒绝高于当前版本的存档', () => {
    expect(() => migrateGodotSave({ version: SAVE_VERSION + 1, provinces: [{}] })).toThrow(/高于当前支持/)
  })

  it('拒绝没有省份的存档', () => {
    expect(() => migrateGodotSave({ version: 5, provinces: [] })).toThrow(/没有任何省份/)
  })

  it('拒绝非法省份记录', () => {
    expect(() => migrateGodotSave({ version: 5, provinces: ['x'] })).toThrow()
  })

  it('缺省字段被回填而非报错', () => {
    const f = migrateGodotSave({ version: 5, provinces: [{ id: 'a', name: 'A' }] })
    expect(f.state.treasury).toBe(120)
    expect(f.state.courtStability).toBe(50)
    expect(f.state.actionsLeft).toBe(3)
    expect(f.state.provinces[0]!.publicSupport).toBe(55)
    expect(f.state.provinces[0]!.militaryMorale).toBe(55)
    expect(f.state.politicalTasks).toHaveLength(1) // 补出根任务
  })

  it('未知阶段回退为 morning_court', () => {
    const f = migrateGodotSave({ version: 5, provinces: [{ id: 'a', name: 'A' }], stage: 'bogus' })
    expect(f.state.stage).toBe('morning_court')
  })

  it('未知任务状态回退为 active', () => {
    const f = migrateGodotSave({
      version: 5,
      provinces: [{ id: 'a', name: 'A' }],
      political_tasks: [{ id: 't', status: 'bogus' }],
    })
    expect(f.state.politicalTasks[0]!.status).toBe('active')
  })

  it('非法任务记录被丢弃', () => {
    const f = migrateGodotSave({
      version: 5,
      provinces: [{ id: 'a', name: 'A' }],
      political_tasks: [null, { title: '无 id' }],
    })
    expect(f.state.politicalTasks).toHaveLength(1) // 回退根任务
  })

  it('迁移待执行行动', () => {
    const f = migrateGodotSave({
      version: 5,
      provinces: [{ id: 'a', name: 'A' }],
      pending_actions: [
        { type: 'policy', id: 'zhenji', province_id: 'a', cost: 50 },
        { type: 'battle', source: 'a', target: 'b', troops: 10, general_id: 'g' },
        { type: 'bogus' },
      ],
    })
    expect(f.state.pendingActions).toHaveLength(2)
    expect(f.state.pendingActions[0]).toMatchObject({ type: 'policy', provinceId: 'a' })
  })

  it('迁移圣旨', () => {
    const f = migrateGodotSave({
      version: 5,
      provinces: [{ id: 'a', name: 'A' }],
      quarter_edicts: [{ edict_id: 'e1', text: '诏曰', task_ids: ['t'], is_settlement_edict: true }],
    })
    expect(f.state.quarterEdicts).toHaveLength(1)
    expect(f.state.quarterEdicts[0]!.edictId).toBe('e1')
    expect(f.state.quarterEdicts[0]!.isSettlementEdict).toBe(true)
  })

  it('丢弃缺 id 的圣旨', () => {
    const f = migrateGodotSave({ version: 5, provinces: [{ id: 'a', name: 'A' }], quarter_edicts: [{ text: 'x' }] })
    expect(f.state.quarterEdicts).toHaveLength(0)
  })

  it('空任务快照回退为当前任务副本', () => {
    const f = migrateGodotSave({ version: 5, provinces: [{ id: 'a', name: 'A' }] })
    expect(f.state.quarterTaskSnapshot).toHaveLength(f.state.politicalTasks.length)
  })

  it('数值字符串被强制转换', () => {
    const f = migrateGodotSave({ version: 5, provinces: [{ id: 'a', name: 'A' }], treasury: '999' })
    expect(f.state.treasury).toBe(999)
  })

  it('非有限数值回退为缺省', () => {
    const f = migrateGodotSave({ version: 5, provinces: [{ id: 'a', name: 'A' }], treasury: 'abc' })
    expect(f.state.treasury).toBe(120)
  })
})

describe('反序列化兼容', () => {
  it('接受新的 {version, state} 格式', () => {
    const s = createNewGame([prov()], [min()], [])
    const round = deserializeSave(serializeSave(s))
    expect(round.state.treasury).toBe(s.treasury)
    expect(round.state.provinces).toHaveLength(1)
  })

  it('接受旧的扁平 Godot 格式并自动迁移', () => {
    const round = deserializeSave(JSON.stringify(godotSave))
    expect(round.state.provinces).toHaveLength(15)
  })

  it('非法 JSON 抛出可读错误', () => {
    expect(() => deserializeSave('{not json')).toThrow(/不是合法 JSON/)
  })

  it('JSON 数组被拒绝', () => {
    expect(() => deserializeSave('[1,2]')).toThrow(/不是 JSON 对象/)
  })
})

describe('存档管理器', () => {
  function state(): GameState {
    return createNewGame([prov()], [min()], [])
  }

  it('无存档时 hasSave 为 false，load 返回 null', async () => {
    const m = new SaveManager(new MemoryStorage())
    expect(await m.hasSave()).toBe(false)
    expect(await m.load()).toBeNull()
  })

  it('保存后可读回', async () => {
    const m = new SaveManager(new MemoryStorage())
    const s = state()
    s.treasury = 777
    await m.save(s)
    expect(await m.hasSave()).toBe(true)
    const loaded = await m.load()
    expect(loaded!.state.treasury).toBe(777)
  })

  it('保存后再读是深拷贝语义（结构等价）', async () => {
    const m = new SaveManager(new MemoryStorage())
    const s = state()
    s.provinces[0]!.publicSupport = 42
    await m.save(s)
    const loaded = await m.load()
    expect(loaded!.state.provinces[0]!.publicSupport).toBe(42)
  })
})
