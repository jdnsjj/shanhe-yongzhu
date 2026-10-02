/**
 * 纸面弹窗集合 —— 对应旧 main.gd 的 _paper_layer 系列弹窗。
 * 统一由 store.dialog 驱动，单一弹窗栈（修复旧实现无栈管理的问题）。
 */

import { useState } from 'react'
import { POLICIES, POSITIONS, type PolicyId, type PositionId } from '../domain/constants.ts'
import { mingProvinces, taskById } from '../domain/state.ts'
import { isAudioEnabled, selectors, setAudioEnabled, useGame } from '../store.ts'

function Dialog({ title, children, onClose, wide = false }: {
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`paper ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="paper-head">
          <h2>{title}</h2>
          <button type="button" className="ink-btn small" onClick={onClose}>退下</button>
        </div>
        <div className="paper-body">{children}</div>
      </div>
    </div>
  )
}

export function DialogHost() {
  const dialog = useGame((s) => s.dialog)
  const payload = useGame((s) => s.dialogPayload)
  const close = useGame((s) => s.closeDialog)

  switch (dialog) {
    case 'policies': return <PolicyDialog onClose={close} />
    case 'ministers': return <MinisterDialog onClose={close} />
    case 'tasks': return <TaskDialog onClose={close} />
    case 'edict': return <EdictDialog onClose={close} payload={payload as { text: string; taskId: string; solutionId: string }} />
    case 'settlement': return <SettlementDialog onClose={close} />
    case 'history': return <HistoryDialog onClose={close} />
    case 'chat': return <ChatDialog onClose={close} payload={payload as { ministerId: string; taskId: string }} />
    case 'provinceOps': return <ProvinceOpsDialog onClose={close} payload={payload as string} />
    case 'dispatch': return <DispatchDialog onClose={close} payload={payload as string} />
    case 'moveTroops': return <MoveTroopsDialog onClose={close} payload={payload as string} />
    case 'quarterReport': return <ReportDialog onClose={close} payload={payload as ReportPayload} />
    case 'gameOver': return <GameOverDialog onClose={close} />
    case 'settings': return <SettingsDialog onClose={close} />
    default: return null
  }
}

function PolicyDialog({ onClose }: { onClose: () => void }) {
  const state = useGame((s) => s.state)
  const usePolicy = useGame((s) => s.usePolicy)
  const [pending, setPending] = useState<PolicyId | null>(null)
  if (!state) return null
  const ming = mingProvinces(state)

  return (
    <Dialog title="布政施策" onClose={onClose} wide>
      <div className="policy-grid">
        {(Object.keys(POLICIES) as PolicyId[]).map((pid) => {
          const p = POLICIES[pid]
          const affordable = p.cost === 0 || state.treasury >= p.cost
          return (
            <div key={pid} className="policy-card">
              <h4>{p.name}<span className="cost">{p.cost > 0 ? `${p.cost}万两` : '不费银'}</span></h4>
              <p>{p.desc}</p>
              {p.target === 'prov' ? (
                pending === pid ? (
                  <div className="prov-picker">
                    {ming.map((prov) => (
                      <button key={prov.id} type="button" className="ink-btn small" onClick={() => usePolicy(pid, prov.id)}>
                        {prov.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button type="button" className="ink-btn" disabled={!affordable || state.actionsLeft <= 0} onClick={() => setPending(pid)}>
                    选择省份
                  </button>
                )
              ) : (
                <button type="button" className="ink-btn" disabled={!affordable || state.actionsLeft <= 0} onClick={() => usePolicy(pid)}>
                  施行
                </button>
              )}
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}

function MinisterDialog({ onClose }: { onClose: () => void }) {
  const state = useGame((s) => s.state)
  const openDialog = useGame((s) => s.openDialog)
  const appoint = useGame((s) => s.appoint)
  const dismiss = useGame((s) => s.dismiss)
  if (!state) return null

  const positions = Object.keys(POSITIONS) as PositionId[]
  const taskId = selectors.activeTasks(state)[0]?.id ?? ''

  return (
    <Dialog title="拔擢文武" onClose={onClose} wide>
      <h3 className="section">在朝诸臣</h3>
      <div className="minister-grid">
        {state.ministers.map((m) => {
          const held = positions.find((p) => state.appointments[p] === m.id)
          return (
            <div key={m.id} className="minister-card">
              <div className="minister-head">
                <span className="seal small" role="img" aria-label={`${m.name}立绘暂缺，显示姓氏占位`}>{m.name.slice(0, 1)}</span>
                <div>
                  <b>{m.name}</b>
                  <div className="muted">{m.title} · {m.faction}</div>
                </div>
              </div>
              <div className="stats">治政 {m.politics} · 统率 {m.command} · 智略 {m.wisdom}</div>
              <div className="stats">忠诚 {m.loyalty} · 野心 {m.ambition}</div>
              <p className="desc">{m.desc}</p>
              <div className="row">
                <button type="button" className="ink-btn small" disabled={state.actionsLeft <= 0}
                  onClick={() => openDialog('chat', { ministerId: m.id, taskId })}>
                  召见
                </button>
                {held ? (
                  <button type="button" className="ink-btn small" onClick={() => { if (window.confirm(`确认罢免${held ? POSITIONS[held].name : '该职'}？`)) dismiss(held) }}>罢{held ? POSITIONS[held].name : ''}</button>
                ) : (
                  <select className="ink-select" defaultValue="" onChange={(e) => {
                    if (e.target.value !== '') appoint(e.target.value as PositionId, m.id)
                  }}>
                    <option value="">任命为…</option>
                    {positions.map((p) => (
                      <option key={p} value={p}>{POSITIONS[p].name}{state.appointments[p] ? '（现任' + (state.ministers.find((x) => x.id === state.appointments[p])?.name ?? '') + '）' : ''}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {state.pool.length > 0 && (
        <>
          <h3 className="section">在野人才（开科取士可擢用）</h3>
          <div className="minister-grid">
            {state.pool.map((m) => (
              <div key={m.id} className="minister-card muted-card">
                <b>{m.name}</b>
                <div className="muted">{m.title} · {m.faction}</div>
                <div className="stats">治政 {m.politics} · 统率 {m.command} · 智略 {m.wisdom}</div>
                <p className="desc">{m.desc}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  )
}

function TaskDialog({ onClose }: { onClose: () => void }) {
  const state = useGame((s) => s.state)
  const openDialog = useGame((s) => s.openDialog)
  if (!state) return null
  const tasks = selectors.activeTasks(state)
  const all = state.politicalTasks

  return (
    <Dialog title="时政任务" onClose={onClose} wide>
      <h3 className="section">进行中</h3>
      {tasks.length === 0 && <p className="muted">本季无活动任务。</p>}
      {tasks.map((t) => (
        <div key={t.id} className="task-card">
          <h4>{t.title}<span className="badge">{t.priority}</span></h4>
          <p>{t.description}</p>
          <div className="muted">起源：{t.origin} · 进度 {t.progress}</div>
          {t.obstacles.length > 0 && <div className="muted">阻碍：{t.obstacles.join('、')}</div>}
          {t.continuation && <div className="muted">后续：{t.continuation}</div>}
          {t.nextObjective && <div className="muted">目标：{t.nextObjective}</div>}
          <div className="row">
            <button type="button" className="ink-btn small" onClick={() => openDialog('chat', { ministerId: state.ministers[0]?.id ?? '', taskId: t.id })}>
              召对议事
            </button>
          </div>
        </div>
      ))}
      <h3 className="section">已结 / 归档</h3>
      {all.filter((t) => t.status !== 'active').map((t) => (
        <div key={t.id} className="task-card done">
          <h4>{t.title}<span className="badge">{t.status}</span></h4>
          {t.completionReason && <div className="muted">{t.completionReason}</div>}
        </div>
      ))}
    </Dialog>
  )
}

function HistoryDialog({ onClose }: { onClose: () => void }) {
  const state = useGame((s) => s.state)
  if (!state) return null
  return (
    <Dialog title="条陈奏疏" onClose={onClose} wide>
      {state.quarterReports.length > 0 && <>
        <h3 className="section">历季战报</h3>
        <div className="report-archive">
          {state.quarterReports.slice().reverse().map((report, i) => (
            <details key={`${report.quarter}-${i}`} className="report-archive-item">
              <summary>{report.quarter} · {report.quarterSummary}</summary>
              {report.events.map((event) => <div key={event.id} className="report-event"><strong>{event.title ?? '大事'}</strong><p className="muted">{event.narrative}</p></div>)}
              {report.battles.map((battle, j) => <p key={j} className="muted">{battle.source} → {battle.target}：{battle.outcome}</p>)}
            </details>
          ))}
        </div>
      </>}
      <h3 className="section">编年记录</h3>
      <ol className="history">
        {state.history.slice().reverse().map((h, i) => <li key={i}>{h}</li>)}
      </ol>
    </Dialog>
  )
}

function ChatDialog({ onClose, payload }: { onClose: () => void; payload: { ministerId: string; taskId: string } }) {
  const state = useGame((s) => s.state)
  const chats = useGame((s) => s.chats)
  const chat = useGame((s) => s.chatWithMinister)
  const draft = useGame((s) => s.draftTaskEdict)
  const busy = useGame((s) => s.busy)
  const [text, setText] = useState('')
  if (!state) return null
  const minister = state.ministers.find((m) => m.id === payload.ministerId)
  if (!minister) return null
  const history = chats[minister.id] ?? []
  const task = taskById(state, payload.taskId) ?? selectors.activeTasks(state)[0]

  const send = (): void => {
    const q = text.trim()
    if (q === '' || busy) return
    setText('')
    void chat(minister, task?.id ?? '', q)
  }

  return (
    <Dialog title={`召对 · ${minister.name}`} onClose={onClose} wide>
      <div className="chat-meta">
        {minister.title} · {minister.faction} · 忠诚 {minister.loyalty} · 野心 {minister.ambition}
        {task && <div className="muted">议题：{task.title}</div>}
      </div>
      <div className="chat-log">
        {history.length === 0 && <p className="muted">召卿觐见。请围绕当前时政任务陈明利弊。</p>}
        {history.map((m, i) => (
          <div key={i} className={`chat-line ${m.role}`}>
            <b>{m.role === 'user' ? '帝' : minister.name}</b>
            <span>{m.content}</span>
          </div>
        ))}
      </div>
      <div className="row">
        <input
          className="ink-input"
          value={text}
          placeholder="向大臣垂询……"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
        />
        <button type="button" className="ink-btn" disabled={busy} onClick={send}>垂询</button>
        <button type="button" className="ink-btn" disabled={busy || !task || !state.currentQuarterDialogues.some((d) => d.taskId === task.id)} onClick={() => { if (task) void draft(task.id) }}>据议拟旨</button>
      </div>
      {!task && <p className="muted">当前无活动任务，无法形成议事证据。</p>}
    </Dialog>
  )
}

function EdictDialog({ onClose, payload }: { onClose: () => void; payload: { text: string; taskId: string; solutionId: string } }) {
  const [text, setText] = useState(payload.text)
  const issue = useGame((s) => s.issueEdict)
  const busy = useGame((s) => s.busy)
  return <Dialog title="审阅圣旨" onClose={onClose} wide>
    <textarea className="ink-input" rows={9} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} aria-label="圣旨正文" />
    <button type="button" className="ink-btn primary" disabled={busy || !text.trim()} onClick={() => issue(text, [payload.taskId], payload.solutionId)}>颁布圣旨</button>
  </Dialog>
}

function SettlementDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const busy = useGame((s) => s.busy)
  const offline = useGame((s) => s.offlineMode)
  const settle = useGame((s) => s.settleQuarter)
  return <Dialog title="季度结算圣旨" onClose={onClose} wide>
    <textarea className="ink-input" rows={9} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} aria-label="结算圣旨正文" placeholder="本季圣旨……" />
    <button type="button" className="ink-btn primary" disabled={busy || offline} onClick={() => void settle(text)}>{busy ? '推演中……' : text.trim() ? '颁诏并结算' : '依已颁圣旨结算'}</button>
  </Dialog>
}

function ProvinceOpsDialog({ onClose, payload }: { onClose: () => void; payload: string }) {
  const state = useGame((s) => s.state)
  const usePolicy = useGame((s) => s.usePolicy)
  const openDialog = useGame((s) => s.openDialog)
  if (!state) return null
  const p = state.provinces.find((x) => x.id === payload)
  if (!p) return null

  const ming = p.owner === 'ming'
  return (
    <Dialog title={`${p.name} · 军政`} onClose={onClose}>
      {ming ? (
        <div className="ops">
          <button type="button" className="ink-btn" onClick={() => usePolicy('zhenji', p.id)}>开仓赈灾（民心+15，50万两）</button>
          <button type="button" className="ink-btn" onClick={() => usePolicy('lianbing', p.id)}>整饬军务（兵力+20%，军心+15，40万两）</button>
          <button type="button" className="ink-btn" onClick={() => usePolicy('xiulv', p.id)}>修缮城防（城防+1，40万两）</button>
          <button type="button" className="ink-btn" onClick={() => usePolicy('zhaofu', p.id)}>招抚流民（民心+10，35万两）</button>
          <button type="button" className="ink-btn" onClick={() => openDialog('dispatch', p.id)}>出兵光复失地</button>
          <button type="button" className="ink-btn" onClick={() => openDialog('moveTroops', p.id)}>调兵布防</button>
        </div>
      ) : (
        <div className="ops">
          <p className="muted">{p.name}目前为{p.owner === 'jin' ? '后金' : '流寇'}所占。需自我方相邻省份出兵光复。</p>
          <button type="button" className="ink-btn" onClick={() => openDialog('dispatch', p.id)}>自相邻省份出兵</button>
        </div>
      )}
    </Dialog>
  )
}

/** 出兵：自相邻我方省份向敌占城池出兵。 */
function DispatchDialog({ onClose, payload }: { onClose: () => void; payload: string }) {
  const state = useGame((s) => s.state)
  const dispatchTroops = useGame((s) => s.dispatchTroops)
  const [troops, setTroops] = useState(10)
  if (!state) return null
  const target = state.provinces.find((p) => p.id === payload)
  if (!target) return null

  // 候选：我方、与目标相邻、兵力 >= 5（对应 canDispatchFrom）
  const sources = state.provinces.filter(
    (p) => p.owner === 'ming' && p.adjacent.includes(target.id) && p.garrison >= 5,
  )
  if (sources.length === 0) {
    return (
      <Dialog title={`出兵 ${target.name}`} onClose={onClose}>
        <p className="muted">无相邻我方省份可供出兵（需兵力 5 万以上）。</p>
      </Dialog>
    )
  }

  const maxTroops = (src: (typeof sources)[number]): number => Math.max(3, Math.trunc(src.garrison) - 2)

  return (
    <Dialog title={`出兵 ${target.name}`} onClose={onClose}>
      <p className="muted">目标为{target.owner === 'jin' ? '后金' : '流寇'}所占。请择一出兵省份。</p>
      <div className="ops">
        {sources.map((src) => (
          <div key={src.id} className="row">
            <span style={{ minWidth: '6rem' }}>{src.name}（兵 {Math.trunc(src.garrison)} 万）</span>
            <input
              className="ink-input"
              type="number"
              min={3}
              max={maxTroops(src)}
              value={troops}
              onChange={(e) => setTroops(Number(e.target.value))}
            />
            <button
              type="button"
              className="ink-btn small"
              disabled={state.actionsLeft <= 0 || troops < 3 || troops > maxTroops(src)}
              onClick={() => {
                if (window.confirm(`确认从${src.name}向${target.name}派出${troops}万兵？`)) dispatchTroops(src.id, target.id, troops, state.ministers[0]?.id ?? '')
              }}
            >
              发兵
            </button>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

/** 调兵：我方相邻省份之间移驻。 */
function MoveTroopsDialog({ onClose, payload }: { onClose: () => void; payload: string }) {
  const state = useGame((s) => s.state)
  const moveTroops = useGame((s) => s.moveTroops)
  const [troops, setTroops] = useState(5)
  if (!state) return null
  const source = state.provinces.find((p) => p.id === payload)
  if (!source || source.owner !== 'ming') return null

  const targets = state.provinces.filter(
    (p) => p.owner === 'ming' && source.adjacent.includes(p.id),
  )
  if (targets.length === 0) {
    return (
      <Dialog title={`自 ${source.name} 调兵`} onClose={onClose}>
        <p className="muted">无相邻我方省份可供调驻。</p>
      </Dialog>
    )
  }

  const maxTroops = Math.max(1, Math.trunc(source.garrison) - 2)

  return (
    <Dialog title={`自 ${source.name} 调兵`} onClose={onClose}>
      <p className="muted">需留 2 万守土。可调 1 至 {maxTroops} 万。</p>
      <div className="row">
        <label>
          兵力
          <input
            className="ink-input"
            type="number"
            min={1}
            max={maxTroops}
            value={troops}
            onChange={(e) => setTroops(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="ops">
        {targets.map((tgt) => (
          <button
            key={tgt.id}
            type="button"
            className="ink-btn"
            disabled={state.actionsLeft <= 0 || troops < 1 || troops > maxTroops}
            onClick={() => {
              if (window.confirm(`确认从${source.name}向${tgt.name}调动${troops}万兵？`)) moveTroops(source.id, tgt.id, troops)
            }}
          >
            移驻 {tgt.name}（现兵 {Math.trunc(tgt.garrison)} 万）
          </button>
        ))}
      </div>
    </Dialog>
  )
}

interface ReportPayload {
  result: { narrative: string; quarterSummary: string; events: Array<{ id: string; narrative: string; title?: string; choices?: Array<{ id: string; label: string }> }>; battles: Array<{ source: string; target: string; outcome: string }>; endEvaluation: { status: string } }
  applied: string[]
}

function ReportDialog({ onClose, payload }: { onClose: () => void; payload: ReportPayload }) {
  const r = payload?.result
  const state = useGame((s) => s.state)
  const chooseHistoricalEvent = useGame((s) => s.chooseHistoricalEvent)
  if (!r) return null
  const outcomeText: Record<string, string> = { attacker_win: '攻方胜', defender_win: '守方胜', stalemate: '相持' }
  return (
    <Dialog title="季度奏报" onClose={onClose} wide>
      <p className="narrative">{r.narrative}</p>
      {r.events.length > 0 && (
        <>
          <h3 className="section">大事</h3>
          {r.events.map((e) => (
            <div key={e.id} className="report-event">
              {e.title && <strong>{e.title}</strong>}
              <p className="muted">{e.narrative}</p>
              {e.choices && e.choices.length > 0 && (
                <div className="report-choices" aria-label="事件选项">
                  {e.choices.map((choice) => {
                    const chosen = state?.historicalChoices[e.id]
                    return <button key={choice.id} type="button" className={`ink-btn small ${chosen === choice.id ? 'primary' : ''}`} disabled={Boolean(chosen)} onClick={() => chooseHistoricalEvent(e.id, choice.id)}>{choice.label}{chosen === choice.id ? '（已择）' : ''}</button>
                  })}
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {r.battles.length > 0 && (
        <>
          <h3 className="section">战报</h3>
          {r.battles.map((b, i) => (
            <p key={i} className="muted">{b.source} → {b.target}：{outcomeText[b.outcome] ?? b.outcome}</p>
          ))}
        </>
      )}
      {payload.applied.length > 0 && (
        <>
          <h3 className="section">落库效果</h3>
          <ul className="applied">{payload.applied.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </>
      )}
    </Dialog>
  )
}

function GameOverDialog({ onClose }: { onClose: () => void }) {
  const state = useGame((s) => s.state)
  const backToStart = useGame((s) => s.backToStart)
  if (!state) return null
  return (
    <Dialog title={state.victory ? '山河永驻' : '社稷倾覆'} onClose={onClose}>
      <p className="narrative">{state.history[state.history.length - 1]}</p>
      <button type="button" className="ink-btn primary" onClick={backToStart}>返回开始界面</button>
    </Dialog>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const offlineMode = useGame((s) => s.offlineMode)
  const newGame = useGame((s) => s.newGame)
  const [audioOn, setAudioOn] = useState(isAudioEnabled())
  return (
    <Dialog title="设置" onClose={onClose}>
      <p className="muted">
        推演模式：{offlineMode ? 'AI 未配置，召对与推演不可用' : 'AI 推演（已连接）'}
      </p>
      <p className="muted">存档位于应用数据目录 save.json；旧 Godot 存档会被自动迁移。</p>
      <label className="setting-row"><input type="checkbox" checked={audioOn} onChange={(e) => { setAudioOn(e.target.checked); setAudioEnabled(e.target.checked) }} /> 播放战报音效</label>
      <button type="button" className="ink-btn" onClick={() => { if (window.confirm('重开新局将覆盖当前存档，确定继续吗？')) void newGame() }}>重开新局</button>
    </Dialog>
  )
}
