/**
 * 命中检测 —— 包围盒预筛 + 点在多边形内。
 * 移植自 scripts/map_canvas.gd 的 _province_at / _world_at，并保留悬停节流。
 */

import type { MapData, Point } from './geometry.ts'
import { pointInAnyPolygon, rectContains } from './geometry.ts'
import { cameraTop, type Camera, type Viewport } from './camera.ts'

export const HOVER_INTERVAL_MS = 50

/** 屏幕坐标命中省份或外部区域（对应 _province_at + _world_at）。 */
export function hitTest(data: MapData, cam: Camera, vp: Viewport, screen: Point): string {
  const top = cameraTop(cam, vp)
  const mp: Point = { x: screen.x / cam.zoom + top.x, y: screen.y / cam.zoom + top.y }

  for (const [id, shape] of data.provinces) {
    if (!rectContains(shape.bounds, mp)) continue
    if (pointInAnyPolygon(mp, shape.polygons)) return id
  }

  for (const region of data.worldRegions) {
    if (!rectContains(region.bounds, mp)) continue
    if (pointInAnyPolygon(mp, region.polygons)) return region.id
  }

  return ''
}

/** 悬停节流器：仅在超过间隔后允许一次检测（对应 _process 中的节流）。 */
export class HoverThrottle {
  // 初值取 -Infinity，保证第一次检测必定通过
  // （旧实现用 Time.get_ticks_msec()，进程启动后即为大数，语义等价）
  private last = Number.NEGATIVE_INFINITY
  private pending = false
  private lastPosition: Point = { x: -10000, y: -10000 }

  constructor(private readonly intervalMs = HOVER_INTERVAL_MS) {}

  /** 记录一次鼠标移动。返回 true 表示应当执行命中检测。 */
  shouldCheck(now: number, position: Point): boolean {
    const moved = Math.abs(position.x - this.lastPosition.x) > 0.5 || Math.abs(position.y - this.lastPosition.y) > 0.5
    this.lastPosition = position
    this.pending = true
    if (!moved) return false
    if (now - this.last < this.intervalMs) return false
    this.last = now
    this.pending = false
    return true
  }

  /** 是否有待处理的悬停检查。 */
  get hasPending(): boolean {
    return this.pending
  }
}

export { toMap } from './camera.ts'
