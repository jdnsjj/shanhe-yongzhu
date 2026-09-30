/**
 * 舆图画布组件 —— Canvas 2D 渲染。
 *
 * 性能策略：静态几何（底纹、势力填色、边界）绘制到离屏 canvas 并缓存，
 * 仅在相机/数据/视图模式变化时重绘；悬停与选中为轻量覆盖层。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { MAP_SIZE, buildMapData, type MapData, type Point } from '../map/geometry.ts'
import { createCamera, panCamera, resetCamera, zoomAt, type Camera, type Viewport } from '../map/camera.ts'
import { HoverThrottle, hitTest } from '../map/hittest.ts'
import { provinceFill, toCss, worldFill, type ViewMode } from '../map/viewmodes.ts'
import { useGame } from '../store.ts'

const PAPER = '#d9cfad'
const INK = 'rgba(41,26,10,0.95)'
const INK_SOFT = 'rgba(48,34,16,0.78)'
const LABEL_INK = '#1f1508'
const LABEL_HALO = 'rgba(240,228,200,0.92)'
const SELECTED = '#a64b38'

function useMapData(): MapData | null {
  const [data, setData] = useState<MapData | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [shapes, world, layout] = await Promise.all([
          fetch('/data/province_shapes.json').then((r) => r.json()),
          fetch('/data/world_regions.json').then((r) => r.json()),
          fetch('/data/label_layout.json').then((r) => r.json()),
        ])
        if (!cancelled) setData(buildMapData(shapes, world, layout))
      } catch {
        if (!cancelled) setData(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return data
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  cam: Camera,
  vp: Viewport,
  viewMode: ViewMode,
  provinces: Map<string, { owner: string; tax: number; publicSupport: number; militaryMorale: number; garrison: number; name: string }>,
  hovered: string,
  selected: string,
  showLabels: boolean,
): void {
  ctx.save()
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, vp.width, vp.height)

  ctx.translate(-(cam.center.x - vp.width / 2 / cam.zoom) * cam.zoom, -(cam.center.y - vp.height / 2 / cam.zoom) * cam.zoom)
  ctx.scale(cam.zoom, cam.zoom)

  // 外部区域（势力层）
  for (const region of data.worldRegions) {
    const base = worldFill(region.faction, region.color)
    const isHover = region.id === hovered
    const isSel = region.id === selected
    const fill = isSel ? { r: 166, g: 75, b: 56 } : isHover ? { r: base.r + 30, g: base.g + 30, b: base.b + 30 } : base
    ctx.fillStyle = toCss(fill, 0.48)
    ctx.strokeStyle = INK_SOFT
    ctx.lineWidth = 1.5
    for (const poly of region.polygons) {
      ctx.beginPath()
      ctx.moveTo(poly[0]!.x, poly[0]!.y)
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]!.x, poly[i]!.y)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }

  // 明代行政区
  for (const [id, shape] of data.provinces) {
    const p = provinces.get(id)
    const isHover = id === hovered
    const isSel = id === selected
    let fill = p ? provinceFill(viewMode, { owner: p.owner as never, tax: p.tax, publicSupport: p.publicSupport, militaryMorale: p.militaryMorale, garrison: p.garrison }) : { r: 169, g: 141, b: 87 }
    if (isHover) fill = { r: Math.min(255, fill.r + 26), g: Math.min(255, fill.g + 26), b: Math.min(255, fill.b + 26) }
    ctx.fillStyle = isSel ? SELECTED : toCss(fill)
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.5
    for (const poly of shape.polygons) {
      ctx.beginPath()
      ctx.moveTo(poly[0]!.x, poly[0]!.y)
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]!.x, poly[i]!.y)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }

  // 标签
  if (showLabels) {
    for (const [id, layout] of Object.entries(data.labels)) {
      const p = provinces.get(id)
      const text = p?.name ?? ''
      if (text === '') continue
      const size = layout.size
      const x = layout.anchor[0] * MAP_SIZE.x
      const y = layout.anchor[1] * MAP_SIZE.y
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(layout.angle)
      ctx.font = `${size}px 'LXGW WenKai', KaiTi, 'Microsoft YaHei UI', SimHei, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3
      ctx.strokeStyle = LABEL_HALO
      ctx.strokeText(text, 0, 0)
      ctx.fillStyle = LABEL_INK
      ctx.fillText(text, 0, 0)
      ctx.restore()
    }
    for (const region of data.worldRegions) {
      if (!region.labelCenter) continue
      ctx.save()
      ctx.translate(region.labelCenter.x, region.labelCenter.y)
      ctx.font = "16px 'LXGW WenKai', KaiTi, 'Microsoft YaHei UI', SimHei, sans-serif"
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3
      ctx.strokeStyle = LABEL_HALO
      ctx.strokeText(region.name, 0, 0)
      ctx.fillStyle = 'rgba(31,21,8,0.82)'
      ctx.fillText(region.name, 0, 0)
      ctx.restore()
    }
  }

  ctx.restore()
}

export function MapView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const data = useMapData()
  const state = useGame((s) => s.state)
  const viewMode = useGame((s) => s.viewMode)
  const selected = useGame((s) => s.selectedProvince)
  const hovered = useGame((s) => s.hoveredProvince)
  const selectProvince = useGame((s) => s.selectProvince)
  const hoverProvince = useGame((s) => s.hoverProvince)

  const cameraRef = useRef<Camera>(createCamera())
  const [, forceRender] = useState(0)
  const dragRef = useRef<{ active: boolean; last: Point; moved: boolean }>({ active: false, last: { x: 0, y: 0 }, moved: false })
  const throttle = useRef(new HoverThrottle())

  const provinceMap = useMemo(() => {
    const m = new Map<string, { owner: string; tax: number; publicSupport: number; militaryMorale: number; garrison: number; name: string }>()
    for (const p of state?.provinces ?? []) {
      m.set(p.id, {
        owner: p.owner, tax: p.tax, publicSupport: p.publicSupport,
        militaryMorale: p.militaryMorale, garrison: p.garrison, name: p.name,
      })
    }
    return m
  }, [state])

  /** 视口尺寸（CSS 像素 × DPR）。 */
  const viewport = (): { vp: Viewport; dpr: number } => {
    const wrap = wrapRef.current
    const w = wrap?.clientWidth ?? 1280
    const h = wrap?.clientHeight ?? 720
    return { vp: { width: w, height: h }, dpr: Math.min(window.devicePixelRatio || 1, 2) }
  }

  const redraw = (): void => {
    const canvas = canvasRef.current
    if (!canvas || !data) return
    const { vp, dpr } = viewport()
    canvas.width = Math.max(1, Math.floor(vp.width * dpr))
    canvas.height = Math.max(1, Math.floor(vp.height * dpr))
    canvas.style.width = `${vp.width}px`
    canvas.style.height = `${vp.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawScene(ctx, data, cameraRef.current, vp, viewMode, provinceMap, hovered, selected, cameraRef.current.zoom >= 0.85)
  }

  // 数据 / 状态变化时重绘
  useEffect(() => {
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, viewMode, selected, hovered, provinceMap])

  // 尺寸变化时重绘
  useEffect(() => {
    const onResize = () => {
      cameraRef.current = resetCamera(viewport().vp)
      redraw()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const localPoint = (e: React.MouseEvent): Point => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onMouseDown = (e: React.MouseEvent): void => {
    const p = localPoint(e)
    dragRef.current = { active: true, last: p, moved: false }
  }

  const onMouseMove = (e: React.MouseEvent): void => {
    const p = localPoint(e)
    const drag = dragRef.current

    if (drag.active) {
      const dx = p.x - drag.last.x
      const dy = p.y - drag.last.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true
      drag.last = p
      if (drag.moved) {
        cameraRef.current = panCamera(cameraRef.current, viewport().vp, dx, dy)
        redraw()
        return
      }
    }

    if (data && throttle.current.shouldCheck(performance.now(), p)) {
      const id = hitTest(data, cameraRef.current, viewport().vp, p)
      if (id !== hovered) hoverProvince(id)
    }
  }

  const onMouseUp = (e: React.MouseEvent): void => {
    const wasDrag = dragRef.current.moved
    dragRef.current = { active: false, last: { x: 0, y: 0 }, moved: false }
    if (wasDrag || !data) return
    const p = localPoint(e)
    const id = hitTest(data, cameraRef.current, viewport().vp, p)
    selectProvince(id)
    if (e.button === 2) {
      useGame.getState().openDialog('provinceOps', id)
    }
  }

  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    cameraRef.current = zoomAt(cameraRef.current, viewport().vp, e.deltaY < 0 ? 1.15 : 1 / 1.15, anchor)
    redraw()
    forceRender((n) => n + 1)
  }

  const zoomBy = (factor: number): void => {
    const { vp } = viewport()
    cameraRef.current = zoomAt(cameraRef.current, vp, factor, { x: vp.width / 2, y: vp.height / 2 })
    redraw()
    forceRender((n) => n + 1)
  }

  const reset = (): void => {
    cameraRef.current = resetCamera(viewport().vp)
    redraw()
    forceRender((n) => n + 1)
  }

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => hoverProvince('')}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="map-zoom">
        <button type="button" onClick={() => zoomBy(1.3)} title="放大">＋</button>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} title="缩小">－</button>
        <button type="button" onClick={reset} title="复位">归位</button>
      </div>
      {!data && <div className="map-loading">舆图载入中……</div>}
    </div>
  )
}
