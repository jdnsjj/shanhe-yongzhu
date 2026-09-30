/**
 * 顶部资源牌 + 右侧国势视图 + 底部行动条。
 * 对应旧 main.gd 的 _build_top_plaque / _build_right_menu / _build_bottom_buttons。
 */

import type React from 'react'
import { POSITIONS, type PolicyId, type PositionId } from '../domain/constants.ts'
import { dateText } from '../domain/state.ts'
import { selectors, useGame } from '../store.ts'
import { VIEW_MODE_LABELS, VIEW_MODES } from '../map/viewmodes.ts'

function chip(label: string, value: string | number, tone = ''): React.ReactElement {
  return (
    <div className={`chip ${tone}`} key={label}>
      <span className="chip-label">{label}</span>
      <span className="chip-value">{value}</span>
    </div>
  )
}

export function TopBar() {
  const state = useGame((s) => s.state)
  if (!state) return null
  return (
    <header className="topbar">
      <div className="seal">明</div>
      <div className="chips">
        {chip('银', Math.trunc(state.treasury), state.treasury < 0 ? 'bad' : '')}
        {chip('民心', Math.trunc(selectors.avgSupport(state)))}
        {chip('军心', Math.trunc(selectors.avgMorale(state)))}
        {chip('朝堂', Math.trunc(state.courtStability))}
        {chip('流寇', Math.trunc(state.rebelPower), state.rebelPower > 80 ? 'bad' : '')}
        {chip('后金', Math.trunc(state.jinPower), state.jinPower > 90 ? 'bad' : '')}
      </div>
      <div className="date">
        {dateText(state)} · 行动 {state.actionsLeft}/3
      </div>
    </header>
  )
}

export function RightMenu() {
  const viewMode = useGame((s) => s.viewMode)
  const setViewMode = useGame((s) => s.setViewMode)
  const openDialog = useGame((s) => s.openDialog)

  return (
    <nav className="rightmenu">
      <div className="menu-section">国势</div>
      {VIEW_MODES.map((m) => (
        <button
          key={m}
          type="button"
          className={`menu-btn ${viewMode === m ? 'active' : ''}`}
          onClick={() => setViewMode(m)}
        >
          {VIEW_MODE_LABELS[m]}
        </button>
      ))}
      <div className="menu-section">政务</div>
      <button type="button" className="menu-btn" onClick={() => openDialog('policies')}>布政施策</button>
      <button type="button" className="menu-btn" onClick={() => openDialog('ministers')}>拔擢文武</button>
      <button type="button" className="menu-btn" onClick={() => openDialog('tasks')}>时政任务</button>
      <button type="button" className="menu-btn" onClick={() => openDialog('history')}>条陈奏疏</button>
      <button type="button" className="menu-btn" onClick={() => openDialog('settings')}>设置</button>
    </nav>
  )
}

export function BottomBar() {
  const state = useGame((s) => s.state)
  const busy = useGame((s) => s.busy)
  const aiStatus = useGame((s) => s.aiStatus)
  const settle = useGame((s) => s.settleQuarter)
  const openDialog = useGame((s) => s.openDialog)
  const offlineMode = useGame((s) => s.offlineMode)
  if (!state) return null

  const pending = state.pendingActions.length
  return (
    <footer className="bottombar">
      <div className="bottom-left">
        {offlineMode && <span className="badge offline">离线推演</span>}
        {pending > 0 && <span className="badge">{pending} 项待推演</span>}
        {state.quarterEdicts.length > 0 && <span className="badge">{state.quarterEdicts.length} 道圣旨</span>}
      </div>
      <div className="bottom-center">
        <button type="button" className="ink-btn" onClick={() => openDialog('tasks')}>时政任务（季度政务）</button>
      </div>
      <div className="bottom-right">
        <button type="button" className="ink-btn primary" disabled={busy} onClick={() => void settle()}>
          {busy ? '推演中……' : '颁诏并结算本季度'}
        </button>
      </div>
      {aiStatus !== '' && <div className="ai-status">{aiStatus}</div>}
    </footer>
  )
}

export function ToastLayer() {
  const toasts = useGame((s) => s.toasts)
  const dismiss = useGame((s) => s.dismissToast)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function InfoPanel() {
  const state = useGame((s) => s.state)
  const selected = useGame((s) => s.selectedProvince)
  if (!state || selected === '') return null
  const p = state.provinces.find((x) => x.id === selected)
  if (!p) return null
  const ownerNames: Record<string, string> = { ming: '大明', jin: '后金', rebel: '流寇' }
  return (
    <aside className="infopanel">
      <h3>{p.name}</h3>
      <div className="info-row"><span>归属</span><b>{ownerNames[p.owner] ?? p.owner}</b></div>
      <div className="info-row"><span>民心</span><b>{Math.trunc(p.publicSupport)}</b></div>
      <div className="info-row"><span>军心</span><b>{Math.trunc(p.militaryMorale)}</b></div>
      <div className="info-row"><span>兵力</span><b>{Math.trunc(p.garrison)} 万</b></div>
      <div className="info-row"><span>城防</span><b>{p.fort} 级</b></div>
      <div className="info-row"><span>税基</span><b>{Math.trunc(p.tax)}</b></div>
      <div className="info-note">{p.historicalScope}</div>
    </aside>
  )
}

export function StartScreen() {
  const hasSave = useGame((s) => s.hasSave)
  const busy = useGame((s) => s.busy)
  const newGame = useGame((s) => s.newGame)
  const continueGame = useGame((s) => s.continueGame)
  return (
    <div className="start-screen">
      <div className="start-inner">
        <h1>山河永驻</h1>
        <p className="subtitle">天启帝崩，信王继统 · 崇祯元年</p>
        <p className="hint">一个回合，一个季度</p>
        <div className="start-actions">
          <button type="button" className="ink-btn primary big" disabled={busy} onClick={() => void newGame()}>开始新局</button>
          {hasSave && (
            <button type="button" className="ink-btn big" disabled={busy} onClick={() => void continueGame()}>继续前局</button>
          )}
        </div>
      </div>
    </div>
  )
}

export { POSITIONS }
export type { PolicyId, PositionId }
