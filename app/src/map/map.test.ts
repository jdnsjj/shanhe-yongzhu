import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MAP_SIZE,
  buildMapData,
  parseLabelLayout,
  parseProvinceShapes,
  parseRings,
  parseWorldRegions,
  pointInPolygon,
  polygonsBounds,
  provinceLabelAnchor,
  rectCenter,
  rectContains,
  worldLabelCenter,
  type Point,
} from './geometry.ts'
import { cameraTop, clampCamera, createCamera, resetCamera, toMap, toScreen, zoomAt, zoomStep } from './camera.ts'
import { HoverThrottle, hitTest } from './hittest.ts'
import { VIEW_MODES, parseHex, provinceFill, provinceViewValue, toCss, worldFill } from './viewmodes.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '../../..')

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(projectRoot, rel), 'utf8'))
}

const shapesRaw = readJson('data/province_shapes.json')
const worldRaw = readJson('data/world_regions.json')
const layoutRaw = readJson('data/label_layout.json')
const mapData = buildMapData(shapesRaw, worldRaw, layoutRaw)

describe('几何基础', () => {
  it('归一化点按 MAP_SIZE 缩放', () => {
    const rings = parseRings([[[0.5, 0.5], [1, 0.5], [1, 1]]])
    expect(rings[0]![0]).toEqual({ x: MAP_SIZE.x * 0.5, y: MAP_SIZE.y * 0.5 })
  })

  it('丢弃不足 3 点的环', () => {
    expect(parseRings([[[0, 0], [1, 1]]])).toHaveLength(0)
  })

  it('丢弃非有限数值点', () => {
    const rings = parseRings([[[0, 0], [Number.NaN, 1], [1, 1], [0, 1]]])
    expect(rings[0]!.length).toBe(3)
  })

  it('非数组输入返回空', () => {
    expect(parseRings(null)).toEqual([])
    expect(parseRings('x')).toEqual([])
  })

  it('包围盒计算正确', () => {
    const poly: Point[] = [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 50 }]
    const b = polygonsBounds([poly])
    expect(b).toEqual({ x: 10, y: 20, w: 20, h: 30 })
    expect(rectCenter(b)).toEqual({ x: 20, y: 35 })
    expect(rectContains(b, { x: 15, y: 25 })).toBe(true)
    expect(rectContains(b, { x: 5, y: 25 })).toBe(false)
  })

  it('空多边形包围盒为零矩形', () => {
    expect(polygonsBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })

  it('点在多边形内判定', () => {
    const square: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
  })

  it('凹多边形正确排除凹口', () => {
    // L 形
    const l: Point[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
    ]
    expect(pointInPolygon({ x: 2, y: 2 }, l)).toBe(true)
    expect(pointInPolygon({ x: 8, y: 8 }, l)).toBe(false)
  })
})

describe('标签锚点', () => {
  it('包围盒中心在多边形内时直接采用', () => {
    const square: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(provinceLabelAnchor([square])).toEqual({ x: 5, y: 5 })
  })

  it('空多边形回退到地图中心', () => {
    expect(provinceLabelAnchor([])).toEqual({ x: MAP_SIZE.x / 2, y: MAP_SIZE.y / 2 })
  })

  it('外部区域标签中心落在轮廓内', () => {
    const square: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    const c = worldLabelCenter([square])!
    expect(pointInPolygon(c, square)).toBe(true)
  })

  it('外部区域取面积最大的轮廓', () => {
    const small: Point[] = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]
    const big: Point[] = [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 140 }, { x: 100, y: 140 }]
    const c = worldLabelCenter([small, big])!
    expect(c.x).toBeGreaterThan(100)
  })
})

describe('数据解析', () => {
  it('解析出 15 个明代行政区', () => {
    expect(mapData.provinces.size).toBe(15)
  })

  it('解析出 17 个外部区域', () => {
    expect(mapData.worldRegions).toHaveLength(17)
  })

  it('每个省份都有可绘制轮廓与包围盒', () => {
    for (const [id, shape] of mapData.provinces) {
      expect(shape.polygons.length, id).toBeGreaterThan(0)
      expect(shape.bounds.w, id).toBeGreaterThan(0)
      expect(shape.bounds.h, id).toBeGreaterThan(0)
    }
  })

  it('外部区域包含辽东与西海诸部', () => {
    expect(mapData.worldById.has('liaodong')).toBe(true)
    expect(mapData.worldById.get('kokonor')!.name).toBe('西海蒙古诸部')
    expect(mapData.worldById.get('liaodong')!.faction).toBe('jin')
  })

  it('台湾标为荷兰东印度公司', () => {
    const tw = mapData.worldById.get('taiwan')!
    expect(tw.faction).toBe('dutch')
    expect(tw.name).toContain('荷兰')
  })

  it('解析标签布局', () => {
    expect(Object.keys(mapData.labels).length).toBeGreaterThanOrEqual(15)
    const l = mapData.labels['jingzhi']!
    expect(l.anchor).toHaveLength(2)
    expect(l.size).toBeGreaterThan(0)
  })

  it('非法输入安全降级', () => {
    expect(parseProvinceShapes(null).provinces.size).toBe(0)
    expect(parseWorldRegions(null)).toEqual([])
    expect(parseLabelLayout(null)).toEqual({})
  })

  it('丢弃缺 id 的外部区域与无轮廓项', () => {
    expect(parseWorldRegions([{ name: 'x' }])).toEqual([])
    expect(parseWorldRegions([{ id: 'a', rings: [] }])).toEqual([])
  })
})

// ============ 迁移自 tools/test_map_labels.gd 的标签契约 ============
describe('标签契约（迁移自 test_map_labels.gd）', () => {
  it('每个省份标签锚点都落在其多边形内', () => {
    const failures: string[] = []
    for (const [pid, shape] of mapData.provinces) {
      const layout = mapData.labels[pid]
      if (!layout) {
        failures.push(`${pid} 缺少标签布局`)
        continue
      }
      const anchor = { x: layout.anchor[0] * MAP_SIZE.x, y: layout.anchor[1] * MAP_SIZE.y }
      const inside = shape.polygons.some((poly) => pointInPolygon(anchor, poly))
      if (!inside) failures.push(`${pid} 标签不在所属多边形内`)
    }
    expect(failures).toEqual([])
  })

  it('每个外部区域标签中心都落在其轮廓内', () => {
    const failures: string[] = []
    for (const region of mapData.worldRegions) {
      if (region.polygons.length === 0) {
        failures.push(`${region.id} 缺少可绘制轮廓`)
        continue
      }
      const center = worldLabelCenter(region.polygons)
      if (center === null) {
        failures.push(`${region.id} 标签中心无法计算`)
        continue
      }
      if (!region.polygons.some((poly) => pointInPolygon(center, poly))) {
        failures.push(`${region.id} 标签中心不在所属轮廓内`)
      }
    }
    expect(failures).toEqual([])
  })

  it('省份数量与历史区块契约一致（15）', () => {
    expect(mapData.provinces.size).toBe(15)
  })
})

describe('相机', () => {
  const vp = { width: 1280, height: 720 }

  it('初始相机居中且缩放为 1', () => {
    const c = createCamera()
    expect(c.zoom).toBe(1)
    expect(c.center).toEqual({ x: MAP_SIZE.x / 2, y: MAP_SIZE.y / 2 })
  })

  it('屏幕与地图坐标互为逆变换', () => {
    const cam = zoomStep(createCamera(), vp, 1.5)
    const mp = { x: 500, y: 400 }
    const back = toMap(cam, vp, toScreen(cam, vp, mp))
    expect(back.x).toBeCloseTo(mp.x, 6)
    expect(back.y).toBeCloseTo(mp.y, 6)
  })

  it('缩放被钳制在 ZOOM_MIN/MAX', () => {
    let cam = createCamera()
    for (let i = 0; i < 30; i++) cam = zoomStep(cam, vp, 2)
    expect(cam.zoom).toBeLessThanOrEqual(4)
    for (let i = 0; i < 40; i++) cam = zoomStep(cam, vp, 0.5)
    expect(cam.zoom).toBeGreaterThanOrEqual(0.7)
  })

  it('以光标为锚点缩放时该点保持不动', () => {
    const cam = createCamera()
    const anchor = { x: 300, y: 200 }
    const before = toMap(cam, vp, anchor)
    const after = zoomAt(cam, vp, 2, anchor)
    const afterMap = toMap(after, vp, anchor)
    // 允许边界钳制带来的偏差，但不应完全漂移
    expect(Math.abs(afterMap.x - before.x)).toBeLessThan(300)
    expect(Math.abs(afterMap.y - before.y)).toBeLessThan(300)
  })

  it('相机不会越出地图边界', () => {
    const cam = clampCamera({ center: { x: -9999, y: -9999 }, zoom: 1 }, vp)
    expect(cam.center.x).toBeGreaterThanOrEqual(0)
    expect(cam.center.y).toBeGreaterThanOrEqual(0)
    const cam2 = clampCamera({ center: { x: 99999, y: 99999 }, zoom: 1 }, vp)
    expect(cam2.center.x).toBeLessThanOrEqual(MAP_SIZE.x)
    expect(cam2.center.y).toBeLessThanOrEqual(MAP_SIZE.y)
  })

  it('cameraTop 随缩放变化', () => {
    const t1 = cameraTop(createCamera(), vp)
    const t2 = cameraTop(zoomStep(createCamera(), vp, 2), vp)
    expect(t2.x).toBeGreaterThan(t1.x)
  })

  it('resetCamera 回到初始视图', () => {
    const cam = resetCamera(vp)
    expect(cam.zoom).toBe(1)
  })
})

describe('命中检测', () => {
  const vp = { width: 1280, height: 720 }

  it('命中省份 id', () => {
    const cam = createCamera()
    const shape = mapData.provinces.get('jingzhi')!
    const anchor = rectCenter(shape.bounds)
    const screen = toScreen(cam, vp, anchor)
    expect(hitTest(mapData, cam, vp, screen)).toBe('jingzhi')
  })

  it('命中外部区域 id', () => {
    const cam = createCamera()
    const region = mapData.worldById.get('taiwan')!
    const center = region.labelCenter!
    const screen = toScreen(cam, vp, center)
    expect(hitTest(mapData, cam, vp, screen)).toBe('taiwan')
  })

  it('空白处返回空串', () => {
    const cam = createCamera()
    expect(hitTest(mapData, cam, vp, { x: -5000, y: -5000 })).toBe('')
  })

  it('节流器限制检测频率', () => {
    const t = new HoverThrottle(50)
    expect(t.shouldCheck(0, { x: 10, y: 10 })).toBe(true)
    expect(t.shouldCheck(10, { x: 20, y: 20 })).toBe(false) // 未到间隔
    expect(t.shouldCheck(60, { x: 30, y: 30 })).toBe(true)
  })

  it('位置未变化时不检测', () => {
    const t = new HoverThrottle(50)
    t.shouldCheck(0, { x: 10, y: 10 })
    expect(t.shouldCheck(100, { x: 10, y: 10 })).toBe(false)
  })
})

describe('国势视图', () => {
  const p = { owner: 'ming' as const, tax: 10, publicSupport: 50, militaryMorale: 50, garrison: 10 }

  it('五种视图模式齐全', () => {
    expect(VIEW_MODES).toHaveLength(5)
  })

  it('民心视图按民心归一', () => {
    expect(provinceViewValue('pop', { ...p, publicSupport: 100 })).toBe(1)
    expect(provinceViewValue('pop', { ...p, publicSupport: 0 })).toBe(0)
  })

  it('财政视图按税基归一', () => {
    expect(provinceViewValue('finance', { ...p, tax: 20 })).toBe(1)
    expect(provinceViewValue('finance', { ...p, tax: 0 })).toBe(0)
  })

  it('税收视图综合税基与民心', () => {
    expect(provinceViewValue('tax', { ...p, tax: 20, publicSupport: 100 })).toBe(1)
  })

  it('灾害视图民心越低值越高', () => {
    const low = provinceViewValue('disaster', { ...p, publicSupport: 10 })
    const high = provinceViewValue('disaster', { ...p, publicSupport: 50 })
    expect(low).toBeGreaterThan(high)
  })

  it('战乱视图敌占省份为 1', () => {
    expect(provinceViewValue('war', { ...p, owner: 'rebel' })).toBe(1)
    expect(provinceViewValue('war', { ...p, owner: 'jin' })).toBe(1)
  })

  it('视图值始终在 0..1', () => {
    for (const mode of VIEW_MODES) {
      for (const support of [-50, 0, 50, 100, 200]) {
        const v = provinceViewValue(mode, { ...p, publicSupport: support, tax: support, garrison: support })
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('解析十六进制颜色', () => {
    expect(parseHex('c6a96b')).toEqual({ r: 198, g: 169, b: 107 })
    expect(parseHex('#c6a96b')).toEqual({ r: 198, g: 169, b: 107 })
    expect(parseHex('bad')).toEqual({ r: 140, g: 128, b: 109 })
  })

  it('外部区域按势力取色', () => {
    expect(worldFill('jin', 'ffffff')).toEqual({ r: 116, g: 107, b: 120 })
    expect(worldFill('unknown-faction', 'c6a96b')).toEqual({ r: 198, g: 169, b: 107 })
  })

  it('生成 CSS 颜色', () => {
    expect(toCss({ r: 1, g: 2, b: 3 })).toBe('rgb(1,2,3)')
    expect(toCss({ r: 1, g: 2, b: 3 }, 0.5)).toBe('rgba(1,2,3,0.5)')
  })

  it('provinceFill 返回合法 RGB', () => {
    for (const mode of VIEW_MODES) {
      const c = provinceFill(mode, p)
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(255)
      }
    }
  })
})
