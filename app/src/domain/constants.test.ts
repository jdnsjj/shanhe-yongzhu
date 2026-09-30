import { describe, expect, it } from 'vitest'
import {
  AI_EFFECT_FIELDS,
  AI_EFFECT_LIMITS,
  AI_SCHEMA_VERSION,
  MAX_ACTIONS,
  POLICIES,
  POSITIONS,
  SAVE_VERSION,
  START_YEAR,
} from './constants'

describe('领域常量', () => {
  it('沿用旧原型的存档与协议版本', () => {
    expect(SAVE_VERSION).toBe(5)
    expect(AI_SCHEMA_VERSION).toBe(1)
    expect(START_YEAR).toBe(1627)
    expect(MAX_ACTIONS).toBe(3)
  })

  it('六部与首辅齐全', () => {
    expect(Object.keys(POSITIONS)).toHaveLength(6)
    expect(POSITIONS.shoufu.name).toBe('内阁首辅')
  })

  it('方略数量与省级目标标记保持旧口径', () => {
    expect(Object.keys(POLICIES)).toHaveLength(7)
    expect(POLICIES.zhenji.target).toBe('prov')
    expect(POLICIES.jianmian.target).toBe('')
  })

  it('效果字段为 12 项且上限数值未被改动', () => {
    expect(AI_EFFECT_FIELDS).toHaveLength(12)
    expect(AI_EFFECT_LIMITS.treasury).toBe(500)
    expect(AI_EFFECT_LIMITS.loyalty).toBe(30)
  })
})
