/**
 * 国势视图着色 —— 移植自 scripts/map_canvas.gd 的 _province_color / _province_view_value。
 * 五种视图：民心(pop) / 财政(finance) / 税收(tax) / 灾害(disaster) / 战乱(war)。
 * 纯函数，返回 0..1 的视图值，由渲染层映射为颜色。
 */

import type { Owner } from '../domain/constants.ts'

export const VIEW_MODES = ['pop', 'finance', 'tax', 'disaster', 'war'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  pop: '民心',
  finance: '财政',
  tax: '税收',
  disaster: '灾害',
  war: '战乱',
}

/** 供着色使用的省份视图输入（与领域 Province 解耦，便于单测）。 */
export interface ProvinceViewInput {
  owner: Owner
  tax: number
  publicSupport: number
  militaryMorale: number
  garrison: number
}

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1)

/** 计算某省在某视图下的 0..1 值（对应 _province_view_value）。 */
export function provinceViewValue(mode: ViewMode, p: ProvinceViewInput): number {
  switch (mode) {
    case 'pop':
      return clamp01(p.publicSupport / 100)
    case 'finance':
      return clamp01(p.tax / 20)
    case 'tax': {
      const effective = p.tax * (0.5 + p.publicSupport / 100)
      return clamp01(effective / 30)
    }
    case 'disaster': {
      const hardship = (55 - p.publicSupport) * 1.7
      const unrest = (50 - p.militaryMorale) * 0.4
      return clamp01((hardship + unrest) / 100)
    }
    case 'war': {
      if (p.owner !== 'ming') return 1
      const unrest = (50 - p.militaryMorale) * 0.8
      return clamp01((unrest + p.garrison * 0.25) / 100)
    }
    default:
      return 0
  }
}

/** RGB 三元组（0-255），避免依赖 Canvas。 */
export interface Rgb {
  r: number
  g: number
  b: number
}

export const VIEW_LOW: Rgb = { r: 184, g: 71, b: 51 }
export const VIEW_MID: Rgb = { r: 214, g: 186, b: 97 }
export const VIEW_HIGH: Rgb = { r: 120, g: 158, b: 87 }
export const FACTION_TINT: Record<string, Rgb> = {
  ming: { r: 198, g: 169, b: 107 },
  jin: { r: 123, g: 114, b: 132 },
  rebel: { r: 170, g: 106, b: 76 },
}
export const WORLD_TINT: Record<string, Rgb> = {
  mongol: { r: 139, g: 128, b: 102 },
  tatar: { r: 129, g: 120, b: 93 },
  russia: { r: 146, g: 144, b: 123 },
  jin: { r: 116, g: 107, b: 120 },
  korea: { r: 143, g: 118, b: 102 },
  japan: { r: 155, g: 128, b: 104 },
  vietnam: { r: 140, g: 128, b: 109 },
  laos: { r: 140, g: 128, b: 109 },
  siam: { r: 140, g: 128, b: 109 },
  burma: { r: 140, g: 128, b: 109 },
  cambodia: { r: 140, g: 128, b: 109 },
  philippines: { r: 140, g: 128, b: 109 },
  ryukyu: { r: 140, g: 128, b: 109 },
  dutch: { r: 141, g: 120, b: 97 },
  ming: { r: 198, g: 169, b: 107 },
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t)
  return {
    r: Math.round(lerp(a.r, b.r, k)),
    g: Math.round(lerp(a.g, b.g, k)),
    b: Math.round(lerp(a.b, b.b, k)),
  }
}

/** 解析十六进制色串（如 "c6a96b"）。 */
export function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '')
  if (h.length !== 6) return { r: 140, g: 128, b: 109 }
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  }
}

/**
 * 省份填充色（对应 _province_color）。
 * 五种国势视图用低-高渐变；disaster/war 反向（值越高越危险）。
 */
export function provinceFill(mode: ViewMode, p: ProvinceViewInput): Rgb {
  const v = provinceViewValue(mode, p)
  if (mode === 'disaster' || mode === 'war') return mixRgb(VIEW_HIGH, VIEW_LOW, v)
  return mixRgb(VIEW_LOW, VIEW_HIGH, v)
}

export function worldFill(faction: string, color: string): Rgb {
  return WORLD_TINT[faction] ?? parseHex(color)
}

export function toCss(c: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${alpha})`
}
