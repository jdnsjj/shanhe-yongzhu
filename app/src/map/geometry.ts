/**
 * 舆图几何 —— 纯 TypeScript，不依赖 Canvas 或 DOM。
 * 移植自 scripts/map_canvas.gd 的几何解析、包围盒、命中与标签锚点计算。
 *
 * 坐标系：归一化 [0,1] 数据 × MAP_SIZE = 地图空间像素。
 */

export const MAP_SIZE = { x: 1920, y: 1080 } as const
export const ZOOM_MIN = 0.7
export const ZOOM_MAX = 4.0

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 把归一化点转为地图空间。 */
export function toMapPoint(raw: readonly number[]): Point {
  return { x: raw[0]! * MAP_SIZE.x, y: raw[1]! * MAP_SIZE.y }
}

/** 解析多边形环；丢弃不足 3 点的环（对应 _parse_polys）。 */
export function parseRings(raw: unknown): Point[][] {
  if (!Array.isArray(raw)) return []
  const out: Point[][] = []
  for (const ring of raw) {
    if (!Array.isArray(ring) || ring.length < 3) continue
    const poly: Point[] = []
    for (const pt of ring) {
      if (Array.isArray(pt) && pt.length >= 2) {
        const x = Number(pt[0])
        const y = Number(pt[1])
        if (Number.isFinite(x) && Number.isFinite(y)) poly.push({ x: x * MAP_SIZE.x, y: y * MAP_SIZE.y })
      }
    }
    if (poly.length >= 3) out.push(poly)
  }
  return out
}

/** 多边形的包围盒（对应 _polygons_bounds）。 */
export function polygonsBounds(polygons: Point[][]): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polygons) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** 射线法点在多边形内判定（对应 Geometry2D.is_point_in_polygon）。 */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    const intersect = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (intersect) inside = !inside
  }
  return inside
}

export function pointInAnyPolygon(p: Point, polygons: Point[][]): boolean {
  for (const poly of polygons) {
    if (pointInPolygon(p, poly)) return true
  }
  return false
}

/** 省份标签锚点：优先包围盒中心，否则顶点均值，均需落在多边形内（对应 _province_label_anchor）。 */
export function provinceLabelAnchor(polygons: Point[][]): Point {
  if (polygons.length === 0) return { x: MAP_SIZE.x / 2, y: MAP_SIZE.y / 2 }
  const center = rectCenter(polygonsBounds(polygons))
  if (pointInAnyPolygon(center, polygons)) return center

  let sx = 0
  let sy = 0
  let count = 0
  for (const poly of polygons) {
    for (const p of poly) {
      sx += p.x
      sy += p.y
      count++
    }
  }
  if (count > 0) {
    const avg = { x: sx / count, y: sy / count }
    if (pointInAnyPolygon(avg, polygons)) return avg
  }
  return center
}

/**
 * 外部区域标签中心：取面积最大的、且质心落在自身多边形内的轮廓质心
 * （对应 _world_label_center_from_polygons）。狭长半岛与多岛集合不能直接用包围盒中心。
 */
export function worldLabelCenter(polygons: Point[][]): Point | null {
  let best: Point | null = null
  let bestArea = 0
  for (const poly of polygons) {
    if (poly.length < 3) continue
    let twiceArea = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      const cross = a.x * b.y - b.x * a.y
      twiceArea += cross
      cx += (a.x + b.x) * cross
      cy += (a.y + b.y) * cross
    }
    const area = Math.abs(twiceArea) * 0.5
    if (area <= 1e-6) continue
    const candidate = { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) }
    if (area > bestArea && pointInPolygon(candidate, poly)) {
      best = candidate
      bestArea = area
    }
  }
  if (best !== null) return best

  // 退化：用最大轮廓的顶点均值
  let largest: Point[] = []
  for (const poly of polygons) if (poly.length > largest.length) largest = poly
  if (largest.length >= 3) {
    let sx = 0
    let sy = 0
    for (const p of largest) {
      sx += p.x
      sy += p.y
    }
    const avg = { x: sx / largest.length, y: sy / largest.length }
    if (pointInPolygon(avg, largest)) return avg
  }
  return null
}

// ---------- 数据文件解析 ----------

export interface ProvinceShape {
  id: string
  polygons: Point[][]
  bounds: Rect
}

export interface WorldRegion {
  id: string
  name: string
  faction: string
  color: string
  polygons: Point[][]
  bounds: Rect
  labelCenter: Point | null
}

export interface LabelLayout {
  anchor: [number, number]
  angle: number
  size: number
}

export interface MapData {
  provinces: Map<string, ProvinceShape>
  worldRegions: WorldRegion[]
  worldById: Map<string, WorldRegion>
  labels: Record<string, LabelLayout>
  decor: Record<string, unknown>
}

/** 解析 province_shapes.json。 */
export function parseProvinceShapes(raw: unknown): { provinces: Map<string, ProvinceShape>; decor: Record<string, unknown> } {
  const provinces = new Map<string, ProvinceShape>()
  let decor: Record<string, unknown> = {}
  if (typeof raw !== 'object' || raw === null) return { provinces, decor }
  const obj = raw as Record<string, unknown>
  if (typeof obj['decor'] === 'object' && obj['decor'] !== null) {
    decor = obj['decor'] as Record<string, unknown>
  }
  const shapes = obj['provinces']
  if (typeof shapes !== 'object' || shapes === null) return { provinces, decor }
  for (const [id, entry] of Object.entries(shapes as Record<string, unknown>)) {
    const polys = parseRings((entry as Record<string, unknown> | null)?.['polys'])
    if (polys.length === 0) continue
    provinces.set(id, { id, polygons: polys, bounds: polygonsBounds(polys) })
  }
  return { provinces, decor }
}

/** 解析 world_regions.json。 */
export function parseWorldRegions(raw: unknown): WorldRegion[] {
  if (!Array.isArray(raw)) return []
  const out: WorldRegion[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const id = String(r['id'] ?? '')
    if (id === '') continue
    const polygons: Point[][] = []
    for (const ring of Array.isArray(r['rings']) ? r['rings'] : []) {
      const parsed = parseRings([ring])
      if (parsed.length > 0) polygons.push(parsed[0]!)
    }
    if (polygons.length === 0) continue
    out.push({
      id,
      name: String(r['name'] ?? id),
      faction: String(r['faction'] ?? ''),
      color: String(r['color'] ?? '8c806d'),
      polygons,
      bounds: polygonsBounds(polygons),
      labelCenter: worldLabelCenter(polygons),
    })
  }
  return out
}

/** 解析 label_layout.json。 */
export function parseLabelLayout(raw: unknown): Record<string, LabelLayout> {
  const out: Record<string, LabelLayout> = {}
  if (typeof raw !== 'object' || raw === null) return out
  const labels = (raw as Record<string, unknown>)['labels']
  if (typeof labels !== 'object' || labels === null) return out
  for (const [id, entry] of Object.entries(labels as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const anchor = e['anchor']
    if (!Array.isArray(anchor) || anchor.length < 2) continue
    out[id] = {
      anchor: [Number(anchor[0]), Number(anchor[1])],
      angle: Number(e['angle'] ?? 0),
      size: Number(e['size'] ?? 25),
    }
  }
  return out
}

/** 汇总解析全部地图数据。 */
export function buildMapData(
  shapes: unknown,
  world: unknown,
  layout: unknown,
): MapData {
  const { provinces, decor } = parseProvinceShapes(shapes)
  const worldRegions = parseWorldRegions(world)
  return {
    provinces,
    worldRegions,
    worldById: new Map(worldRegions.map((r) => [r.id, r])),
    labels: parseLabelLayout(layout),
    decor,
  }
}
