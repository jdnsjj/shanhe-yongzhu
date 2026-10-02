/**
 * 游戏状态 store —— 把纯领域层、AI 层与存档层接到 React。
 *
 * 设计：领域层保持不可变与纯函数；store 只负责持有当前状态、调用领域函数、
 * 触发存档与通知 UI。UI 组件不直接改状态。
 */

import { create } from 'zustand'
import { AiOperations, stateSnapshot } from './ai/operations.ts'
import { LlmClient, type LlmConfig } from './ai/client.ts'

const UI_AUDIO = { click: '/assets/audio/click.ogg', bell: '/assets/audio/bell.ogg', war: '/assets/audio/war.ogg' } as const
let audioEnabled = (() => {
  try { return globalThis.localStorage?.getItem('shanhe-audio-enabled') !== '0' } catch { return true }
})()

export function isAudioEnabled(): boolean { return audioEnabled }

export function setAudioEnabled(enabled: boolean): void {
  audioEnabled = enabled
  try { globalThis.localStorage?.setItem('shanhe-audio-enabled', enabled ? '1' : '0') } catch { /* 无 localStorage 时仅保持本次会话设置 */ }
}

function playUiSound(kind: keyof typeof UI_AUDIO): void {
  if (!audioEnabled) return
  try {
    const audio = new Audio(UI_AUDIO[kind])
    audio.volume = kind === 'war' ? 0.3 : 0.2
    void audio.play().catch(() => undefined)
  } catch {
    // 自动播放被浏览器/桌面壳禁止时静默降级。
  }
}
import { POLICIES, type PolicyId, type PositionId } from './domain/constants.ts'
import { historicalContext } from './domain/historical.ts'
import {
  acceptSolution,
  appointMinister,
  dismissMinister,
  dispatch,
  issueEdict,
  moveTroops,
  recordDebate,
  recordDialogue,
  setStage,
  usePolicy,
} from './domain/pipeline.ts'
import { validateQuarterResult, validationContextFrom } from './domain/schemas.ts'
import {
  activeTasks,
  averageMilitaryMorale,
  averagePublicSupport,
  createNewGame,
  dateText,
  mingProvinces,
  parseMinisters,
  parseProvinces,
  quarterKey,
} from './domain/state.ts'
import {
  applyAiTransition,
  applyTaskUpdates,
  captureTransaction,
  commitQuarter,
  restoreTransaction,
} from './domain/transition.ts'
import type { ChatMessage, GameState, Minister, QuarterResult } from './domain/types.ts'
import { LocalStorageAdapter, SaveManager, TauriStorage } from './persist/storage.ts'
import type { ViewMode } from './map/viewmodes.ts'

export type Screen = 'start' | 'game'

export interface Toast {
  id: number
  text: string
}

export interface GameStore {
  screen: Screen
  state: GameState | null
  viewMode: ViewMode
  selectedProvince: string
  hoveredProvince: string
  toasts: Toast[]
  aiStatus: string
  busy: boolean
  offlineMode: boolean
  hasSave: boolean
  dialog: string | null
  dialogPayload: unknown
  /** 大臣召对的会话历史（按大臣 id 分组，避免旧实现的串消息问题）。 */
  chats: Record<string, ChatMessage[]>

  boot: () => Promise<void>
  newGame: () => Promise<void>
  continueGame: () => Promise<void>
  backToStart: () => void
  setViewMode: (m: ViewMode) => void
  selectProvince: (id: string) => void
  hoverProvince: (id: string) => void
  openDialog: (name: string, payload?: unknown) => void
  closeDialog: () => void
  toast: (text: string) => void
  dismissToast: (id: number) => void

  usePolicy: (id: PolicyId, provinceId?: string) => void
  appoint: (position: PositionId, ministerId: string) => void
  dismiss: (position: PositionId) => void
  dispatchTroops: (src: string, tgt: string, troops: number, general: string) => void
  moveTroops: (src: string, tgt: string, troops: number) => void
  chooseHistoricalEvent: (eventId: string, choiceId: string) => Promise<void>
  dialogue: (taskId: string, ministerId: string, messages: ChatMessage[]) => void
  debate: (taskId: string, ministerIds: string[]) => Promise<void>
  acceptSolution: (taskId: string, solution: Record<string, unknown>) => void
  issueEdict: (text: string, taskIds: string[], solutionId: string) => void
  draftTaskEdict: (taskId: string) => Promise<void>
  settleQuarter: (edictText?: string) => Promise<void>
  chatWithMinister: (minister: Minister, taskId: string, text: string) => Promise<void>

  // 派生查询
  provinceList: () => GameState['provinces']
}

let toastSeq = 0
const llm = new LlmClient()
const ai = new AiOperations(llm)

/** 是否运行在 Tauri 环境（决定存档后端）。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 依运行环境选择存档后端。
 * Tauri 下用 fs 插件写应用数据目录；纯浏览器（开发调试）退化为 localStorage，
 * 否则在浏览器中调用 Tauri IPC 会抛错，导致新局无法进入。
 */
function createStorage(): SaveManager {
  return new SaveManager(isTauri() ? new TauriStorage() : new LocalStorageAdapter())
}

const saves = createStorage()

/** 把原始 config.json 对象规范化。 */
function normalizeConfig(raw: Record<string, unknown>): Partial<LlmConfig> {
  return {
    baseUrl: String(raw['base_url'] ?? ''),
    apiKey: String(raw['api_key'] ?? ''),
    model: String(raw['model'] ?? ''),
    cacheTtlSeconds: Number(raw['prompt_cache_ttl_seconds'] ?? 45),
    cacheMaxEntries: Number(raw['prompt_cache_max_entries'] ?? 64),
    enablePromptCache: Boolean(raw['enable_prompt_cache']),
    promptCacheKey: String(raw['prompt_cache_key'] ?? ''),
  }
}

/**
 * 读取 API 配置。
 *  - 开发期：Vite 中间件提供的 /config.json
 *  - 打包后：应用数据目录下的 config.json
 *    （刻意不把含密钥的 config.json 打进安装包，避免密钥随分发泄露）
 */
async function loadConfig(): Promise<Partial<LlmConfig>> {
  try {
    const res = await fetch('/config.json')
    if (res.ok) {
      const raw = (await res.json()) as Record<string, unknown>
      const cfg = normalizeConfig(raw)
      if (cfg.apiKey) return cfg
    }
  } catch {
    // 生产环境没有该路由，继续走应用数据目录
  }

  if (isTauri()) {
    try {
      const fs = await import('@tauri-apps/plugin-fs')
      const { appDataDir } = await import('@tauri-apps/api/path')
      const dir = (await appDataDir()).replace(/[\\/]+$/, '')
      const path = `${dir}/config.json`
      if (await fs.exists(path)) {
        const text = await fs.readTextFile(path)
        const raw = JSON.parse(text) as Record<string, unknown>
        return normalizeConfig(raw)
      }
    } catch {
      // 无配置文件即离线模式
    }
  }

  return {}
}

async function loadGameData(): Promise<{ provinces: ReturnType<typeof parseProvinces>; court: Minister[]; pool: Minister[] }> {
  const [pRes, mRes] = await Promise.all([fetch('/data/provinces.json'), fetch('/data/ministers.json')])
  if (!pRes.ok) throw new Error('无法加载 data/provinces.json')
  if (!mRes.ok) throw new Error('无法加载 data/ministers.json')
  const provinces = parseProvinces(await pRes.json())
  const { court, pool } = parseMinisters(await mRes.json())
  return { provinces, court, pool }
}

export const useGame = create<GameStore>((set, get) => {
  /** 统一的「应用新状态 + 自动存档」流程。 */
  const apply = (next: GameState): void => {
    set({ state: next })
    void saves.save(next).catch((err: unknown) => get().toast(`存档失败：${err instanceof Error ? err.message : String(err)}`))
  }

  const fail = (error: string): void => {
    get().toast(error)
  }

  return {
    screen: 'start',
    state: null,
    viewMode: 'pop',
    selectedProvince: '',
    hoveredProvince: '',
    toasts: [],
    aiStatus: '',
    busy: false,
    offlineMode: false,
    hasSave: false,
    dialog: null,
    dialogPayload: null,
    chats: {},

    boot: async () => {
      try {
        const cfg = await loadConfig()
        llm.configure(cfg)
        const has = await saves.hasSave()
        set({ hasSave: has, offlineMode: !llm.isEnabled() })
      } catch (err) {
        // 权限/应用数据目录错误不能伪装成“没有存档”；仍允许进入离线新局，但明确提示用户。
        set({ offlineMode: !llm.isEnabled() })
        get().toast(`存档检查失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },

    newGame: async () => {
      if (get().busy) return
      set({ busy: true })
      try {
        const { provinces, court, pool } = await loadGameData()
        const state = createNewGame(provinces, court, pool)
        await saves.save(state)
        set({ state, screen: 'game', busy: false, hasSave: true, chats: {}, dialog: null, dialogPayload: null, selectedProvince: '', hoveredProvince: '' })
        get().toast(llm.isEnabled() ? '崇祯元年，新局已开。' : 'AI 未配置，可查阅局势；召对与结算需配置 AI。')
      } catch (err) {
        set({ busy: false })
        fail((err as Error).message)
      }
    },

    continueGame: async () => {
      if (get().busy) return
      set({ busy: true })
      try {
        const file = await saves.load()
        if (!file) {
          set({ busy: false })
          fail('没有可继续的存档')
          return
        }
        set({ state: file.state, screen: 'game', busy: false, chats: {} })
      } catch (err) {
        set({ busy: false })
        fail((err as Error).message)
      }
    },

    backToStart: () => { if (!get().busy) set({ screen: 'start', state: null, dialog: null, chats: {} }) },

    setViewMode: (m) => set({ viewMode: m }),
    selectProvince: (id) => set({ selectedProvince: id }),
    hoverProvince: (id) => set({ hoveredProvince: id }),
    openDialog: (name, payload) => set({ dialog: name, dialogPayload: payload ?? null }),
    closeDialog: () => set({ dialog: null, dialogPayload: null }),

    toast: (text) => {
      const id = ++toastSeq
      set((s) => ({ toasts: [...s.toasts, { id, text }] }))
      setTimeout(() => get().dismissToast(id), 4200)
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    usePolicy: (id, provinceId = '') => {
      const s = get().state
      if (!s || get().busy) return
      const r = usePolicy(s, id, provinceId)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast(`已拟行方略：${POLICIES[id].name}`)
      set({ dialog: null })
    },

    appoint: (position, ministerId) => {
      const s = get().state
      if (!s || get().busy) return
      const r = appointMinister(s, position, ministerId)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      set({ dialog: null })
    },

    dismiss: (position) => {
      const s = get().state
      if (!s || get().busy) return
      const r = dismissMinister(s, position)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      set({ dialog: null })
    },

    dispatchTroops: (src, tgt, troops, general) => {
      const s = get().state
      if (!s || get().busy) return
      const r = dispatch(s, src, tgt, troops, general)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast(r.value.msg)
      set({ dialog: null })
    },

    chooseHistoricalEvent: async (eventId, choiceId) => {
      const s = get().state
      if (!s || get().busy || !eventId.startsWith('historical-') || s.historicalChoices[eventId]) return
      if (!llm.isEnabled()) return fail('历史事件需要连接 AI 后才能裁决，请先配置 config.json')
      const event = s.quarterReports.flatMap((report) => report.events).find((item) => item.id === eventId)
      const choice = event?.choices?.find((item) => item.id === choiceId)
      if (!choice) return fail('该历史事件选项无效或已处理')
      set({ busy: true, aiStatus: 'AI 正在裁决历史事件……' })
      const res = await ai.resolveEventChoice(stateSnapshot(s), event, choice)
      set({ busy: false, aiStatus: '' })
      if (!res.ok || !res.data) return fail(res.error ?? '历史事件裁决失败，本回合未改变')
      if (res.data['schema_version'] !== 1 || typeof res.data['narrative'] !== 'string' || !res.data['narrative'].trim() || !Array.isArray(res.data['effects'])) return fail('历史事件裁决格式非法，本回合未改变')
      const checked = validateQuarterResult({
        schema_version: 1, quarter_summary: '', narrative: res.data['narrative'],
        treasury: {}, effects: Array.isArray(res.data['effects']) ? res.data['effects'] : [], events: [], battles: [], task_updates: [], next_quarter_tasks: [], end_evaluation: { status: 'ongoing' }, validation: { ok: true },
      }, validationContextFrom(s))
      if (!checked.ok) return fail(`历史事件结果校验失败：${checked.error}`)
      const applied = applyAiTransition(s, checked.data.effects)
      const next = applied.state
      next.historicalChoices[eventId] = choiceId
      next.history.push(`【历史抉择】${event?.title ?? eventId}：${choice.label}`)
      next.history.push(`【历史裁决】${checked.data.narrative}`)
      apply(next)
      get().toast(`AI 已裁决：${checked.data.narrative}`)
    },

    moveTroops: (src, tgt, troops) => {
      const s = get().state
      if (!s || get().busy) return
      const r = moveTroops(s, src, tgt, troops)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast(r.value.msg)
      set({ dialog: null })
    },

    dialogue: (taskId, ministerId, messages) => {
      const s = get().state
      if (!s || get().busy) return
      const r = recordDialogue(s, taskId, ministerId, messages)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
    },

    debate: async (taskId, ministerIds) => {
      const s = get().state
      if (!s || get().busy) return
      if (!llm.isEnabled()) return fail('朝会需要连接 AI')
      const task = activeTasks(s).find((t) => t.id === taskId)
      const ministers = s.ministers.filter((m) => ministerIds.includes(m.id))
      if (!task || ministers.length < 2) return fail('请选择活动任务和至少两名大臣')
      set({ busy: true, aiStatus: 'AI 正在推演群臣议事……' })
      const res = await ai.runCourtDebate(stateSnapshot(s), task, ministers, [], 0)
      set({ busy: false, aiStatus: '' })
      if (!res.ok || !res.data || !Array.isArray(res.data['transcript'])) return fail(res.error ?? '朝会记录格式非法')
      const transcript = res.data['transcript'] as ChatMessage[]
      if (transcript.length === 0 || transcript.some((t) => !t || !['user', 'assistant'].includes(t.role) || typeof t.content !== 'string' || !t.content.trim())) return fail('朝会发言格式非法')
      const r = recordDebate(s, taskId, ministerIds, transcript, String(res.data['summary'] ?? ''))
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast('朝会已记入本季度议事。')
    },

    acceptSolution: (taskId, solution) => {
      const s = get().state
      if (!s || get().busy) return
      const r = acceptSolution(s, taskId, solution)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast('已采纳此策，候拟圣旨。')
      set({ dialog: null })
    },

    issueEdict: (text, taskIds, solutionId) => {
      const s = get().state
      if (!s || get().busy) return
      if (!llm.isEnabled()) return fail('颁旨需要先配置 AI')
      const r = issueEdict(s, text, taskIds, solutionId)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast('圣旨已颁。')
      set({ dialog: null })
    },

    draftTaskEdict: async (taskId) => {
      const s = get().state
      if (!s || get().busy) return
      if (!llm.isEnabled()) return fail('拟旨需要连接 AI，请先配置 config.json')
      const task = activeTasks(s).find((t) => t.id === taskId)
      const records = s.currentQuarterDialogues.filter((d) => d.taskId === taskId)
      if (!task || records.length === 0) return fail('请先与大臣召对，讨论解决方法')
      set({ busy: true, aiStatus: 'AI 正在根据议事记录拟旨……' })
      const res = await ai.draftEdictFromDialogue(stateSnapshot(s), task, records.flatMap((d) => d.messages), 0)
      set({ busy: false, aiStatus: '' })
      if (!res.ok || !res.data || typeof res.data['edict_text'] !== 'string' || !res.data['edict_text'].trim()) return fail(res.error ?? '拟旨结果无效')
      const accepted = acceptSolution(s, taskId, { title: String(res.data['summary'] ?? '召对议定方案'), summary: String(res.data['summary'] ?? ''), evidenceRefs: records.map((d) => d.id) })
      if (!accepted.ok) return fail(accepted.error)
      apply(accepted.value.state)
      get().openDialog('edict', { text: res.data['edict_text'], taskId, solutionId: accepted.value.solution.id })
    },

    settleQuarter: async (edictText = '') => {
      let s = get().state
      if (!s || get().busy) return
      if (s.simulationInFlight) return fail('本季度推演正在进行')

      if (!llm.isEnabled()) return fail('季度结算需要连接 AI，请先配置 config.json；本回合未推进')
      if (edictText.trim()) {
        const issued = issueEdict(s, edictText, [], '', [], '', true)
        if (!issued.ok) return fail(issued.error)
        s = issued.value.state
        apply(s)
      }
      set({ busy: true, aiStatus: 'AI 正在推演本季度国势……' })
      const before = captureTransaction(s)

      let result: QuarterResult
      {
        try {
          const sources = await fetch('/data/events.json')
          if (!sources.ok) throw new Error('无法加载历史事件资料')
          const snapshot = stateSnapshot(s)
          snapshot['historical_context'] = historicalContext(await sources.json(), s.year)
          const res = await ai.simulateQuarter(
            snapshot,
            s.quarterTaskSnapshot,
            {
              bulletins: s.currentQuarterBulletins,
              dialogues: s.currentQuarterDialogues,
              debates: s.currentQuarterDebates,
              decisions: s.currentQuarterDecisions,
              pendingActions: s.pendingActions,
              summaries: s.quarterSummaries,
            },
            s.quarterEdicts,
            s.history,
          )
          if (!res.ok || !res.data) {
            const restored = restoreTransaction(before)
            set({ state: restored, busy: false, aiStatus: '' })
            return fail(res.error ?? 'AI 推演失败，本回合未推进')
          }
          const checked = validateQuarterResult(res.data, validationContextFrom(s))
          if (!checked.ok) {
            const restored = restoreTransaction(before)
            set({ state: restored, busy: false, aiStatus: '' })
            return fail(`推演结果校验失败：${checked.error}`)
          }
          result = checked.data
        } catch (err) {
          const restored = restoreTransaction(before)
          set({ state: restored, busy: false, aiStatus: '' })
          return fail(`AI 推演异常：${(err as Error).message}`)
        }
      }

      const applied = applyAiTransition(s, result.effects)
      if (result.battles.length > 0) playUiSound('war')
      else if (result.events.length > 0) playUiSound('bell')
      const withTasks = applyTaskUpdates(applied.state, result)
      const { state: next, report } = commitQuarter(withTasks, result, applied.applied)

      set({ busy: false, aiStatus: '' })
      apply(next)
      get().openDialog('quarterReport', { result, applied: applied.applied })

      if (report.status !== 'ongoing') {
        set({ dialog: 'gameOver' })
        get().toast(report.status === 'victory' ? '山河永驻！' : '社稷倾覆……')
      }
    },

    chatWithMinister: async (minister, taskId, text) => {
      const s = get().state
      if (!s || get().busy) return
      if (!llm.isEnabled()) return fail('召对需要连接 AI，请先配置 config.json')
      const task = activeTasks(s).find((t) => t.id === taskId) ?? activeTasks(s)[0]
      if (!task) {
        fail('当前没有可议的时政任务')
        return
      }

      const history: ChatMessage[] = [...(get().chats[minister.id] ?? []), { role: 'user', content: text }]
      set({ chats: { ...get().chats, [minister.id]: history } })
      set({ busy: true, aiStatus: `${minister.name}正在奏对……` })

      const res = await ai.chatWithMinister(minister, task, history, stateSnapshot(s), text, 0)
      set({ busy: false, aiStatus: '' })
      if (!res.ok || !res.data) {
        fail(res.error ?? 'AI 暂无回复')
        return
      }
      const reply = String(res.data['message'] ?? res.data['advice'] ?? '（无言以对）')
      set({ chats: { ...get().chats, [minister.id]: [...history, { role: 'assistant' as const, content: reply }] } })
      get().dialogue(task.id, minister.id, [
        { role: 'user', content: text },
        { role: 'assistant', content: reply },
      ])
    },

    provinceList: () => get().state?.provinces ?? [],
  }
})

// ---------- 派生选择器 ----------
export const selectors = {
  date: (s: GameState) => dateText(s),
  avgSupport: (s: GameState) => averagePublicSupport(s),
  avgMorale: (s: GameState) => averageMilitaryMorale(s),
  mingCount: (s: GameState) => mingProvinces(s).length,
  quarter: (s: GameState) => quarterKey(s.year, s.quarter),
  activeTasks: (s: GameState) => activeTasks(s),
}

export { setStage }
