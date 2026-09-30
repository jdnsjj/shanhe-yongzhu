/**
 * 舆图相机 —— 平移、以光标为锚点的缩放、边界钳制。
 * 移植自 scripts/map_canvas.gd 的 _cam_top / clamp_cam / zoom_at。
 * 纯函数式：输入相机状态，返回新状态。
 */

import { MAP_SIZE, ZOOM_MAX, ZOOM_MIN, type Point } from './geometry.ts'

export interface Camera {
  center: Point
  zoom: number
}

export interface Viewport {
  width: number
  height: number
}

export function createCamera(): Camera {
  return { center: { x: MAP_SIZE.x / 2, y: MAP_SIZE.y / 2 }, zoom: 1 }
}

/** 视口左上角在地图空间中的坐标（对应 _cam_top）。 */
export function cameraTop(cam: Camera, vp: Viewport): Point {
  return { x: cam.center.x - vp.width / 2 / cam.zoom, y: cam.center.y - vp.height / 2 / cam.zoom }
}

/** 地图空间 -> 屏幕空间。 */
export function toScreen(cam: Camera, vp: Viewport, mp: Point): Point {
  const top = cameraTop(cam, vp)
  return { x: (mp.x - top.x) * cam.zoom, y: (mp.y - top.y) * cam.zoom }
}

/** 屏幕空间 -> 地图空间。 */
export function toMap(cam: Camera, vp: Viewport, sp: Point): Point {
  const top = cameraTop(cam, vp)
  return { x: sp.x / cam.zoom + top.x, y: sp.y / cam.zoom + top.y }
}

/** 钳制相机，避免视口越出地图（对应 clamp_cam）。 */
export function clampCamera(cam: Camera, vp: Viewport): Camera {
  const halfX = vp.width / 2 / cam.zoom
  const halfY = vp.height / 2 / cam.zoom
  const minX = Math.min(halfX, MAP_SIZE.x / 2)
  const maxX = Math.max(MAP_SIZE.x - halfX, MAP_SIZE.x / 2)
  const minY = Math.min(halfY, MAP_SIZE.y / 2)
  const maxY = Math.max(MAP_SIZE.y - halfY, MAP_SIZE.y / 2)
  return {
    zoom: cam.zoom,
    center: {
      x: Math.min(Math.max(cam.center.x, minX), maxX),
      y: Math.min(Math.max(cam.center.y, minY), maxY),
    },
  }
}

/** 以指定屏幕点为锚点缩放（对应 zoom_at）。 */
export function zoomAt(cam: Camera, vp: Viewport, factor: number, anchorScreen: Point): Camera {
  const before = toMap(cam, vp, anchorScreen)
  const zoom = Math.min(Math.max(cam.zoom * factor, ZOOM_MIN), ZOOM_MAX)
  const center = {
    x: before.x + vp.width / 2 / zoom - anchorScreen.x / zoom,
    y: before.y + vp.height / 2 / zoom - anchorScreen.y / zoom,
  }
  return clampCamera({ center, zoom }, vp)
}

/** 以视口中心为锚点缩放（对应 zoom_step）。 */
export function zoomStep(cam: Camera, vp: Viewport, factor: number): Camera {
  return zoomAt(cam, vp, factor, { x: vp.width / 2, y: vp.height / 2 })
}

/** 复位（对应 reset_cam）。 */
export function resetCamera(vp: Viewport): Camera {
  return clampCamera(createCamera(), vp)
}

/** 平移（拖拽）。 */
export function panCamera(cam: Camera, vp: Viewport, dxScreen: number, dyScreen: number): Camera {
  return clampCamera(
    { zoom: cam.zoom, center: { x: cam.center.x - dxScreen / cam.zoom, y: cam.center.y - dyScreen / cam.zoom } },
    vp,
  )
}
