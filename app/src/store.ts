/**
 * 游戏状态 store —— 把纯领域层、AI 层与存档层接到 React。
 *
 * 设计：领域层保持不可变与纯函数；store 只负责持有当前状态、调用领域函数、
 * 触发存档与通知 UI。UI 组件不直接改状态。
 */

import { create } from 'zustand'
import { AiOperations, stateSnapshot } from './ai/operations.ts'
import { LlmClient, type LlmConfig } from './ai/client.ts'
import { POLICIES, type PolicyId, type PositionId } from './domain/constants.ts'
import { simulateQuarterOffline } from './domain/offline.ts'
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
import { SaveManager, TauriStorage } from './persist/storage.ts'
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
  dialogue: (taskId: string, ministerId: string, messages: ChatMessage[]) => void
  debate: (taskId: string, ministerIds: string[]) => void
  acceptSolution: (taskId: string, solution: Record<string, unknown>) => void
  issueEdict: (text: string, taskIds: string[], solutionId: string) => void
  settleQuarter: () => Promise<void>
  chatWithMinister: (minister: Minister, taskId: string, text: string) => Promise<void>

  // 派生查询
  provinceList: () => GameState['provinces']
}

let toastSeq = 0
const llm = new LlmClient()
const ai = new AiOperations(llm)
const saves = new SaveManager(new TauriStorage())

/** 是否运行在 Tauri 环境（决定存档后端与离线引擎可用性）。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function loadConfig(): Promise<Partial<LlmConfig>> {
  try {
    const res = await fetch('/config.json')
    if (!res.ok) return {}
    const raw = (await res.json()) as Record<string, unknown>
    return {
      baseUrl: String(raw['base_url'] ?? ''),
      apiKey: String(raw['api_key'] ?? ''),
      model: String(raw['model'] ?? ''),
      cacheTtlSeconds: Number(raw['prompt_cache_ttl_seconds'] ?? 45),
      cacheMaxEntries: Number(raw['prompt_cache_max_entries'] ?? 64),
      enablePromptCache: Boolean(raw['enable_prompt_cache']),
      promptCacheKey: String(raw['prompt_cache_key'] ?? ''),
    }
  } catch {
    return {}
  }
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
    void saves.save(next)
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
      const cfg = await loadConfig()
      llm.configure(cfg)
      const has = isTauri() ? await saves.hasSave() : false
      set({ hasSave: has, offlineMode: !llm.isEnabled() })
    },

    newGame: async () => {
      set({ busy: true })
      try {
        const { provinces, court, pool } = await loadGameData()
        const state = createNewGame(provinces, court, pool)
        await saves.save(state)
        set({ state, screen: 'game', busy: false, hasSave: true, chats: {} })
        get().toast(llm.isEnabled() ? '崇祯元年，新局已开。' : 'AI 未连接，已启用离线推演引擎。')
      } catch (err) {
        set({ busy: false })
        fail((err as Error).message)
      }
    },

    continueGame: async () => {
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

    backToStart: () => set({ screen: 'start', state: null, dialog: null, chats: {} }),

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
      if (!s) return
      const r = usePolicy(s, id, provinceId)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast(`已拟行方略：${POLICIES[id].name}`)
      set({ dialog: null })
    },

    appoint: (position, ministerId) => {
      const s = get().state
      if (!s) return
      const r = appointMinister(s, position, ministerId)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      set({ dialog: null })
    },

    dismiss: (position) => {
      const s = get().state
      if (!s) return
      const r = dismissMinister(s, position)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      set({ dialog: null })
    },

    dispatchTroops: (src, tgt, troops, general) => {
      const s = get().state
      if (!s) return
      const r = dispatch(s, src, tgt, troops, general)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast(r.value.msg)
      set({ dialog: null })
    },

    moveTroops: (src, tgt, troops) => {
      const s = get().state
      if (!s) return
      const r = moveTroops(s, src, tgt, troops)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast(r.value.msg)
      set({ dialog: null })
    },

    dialogue: (taskId, ministerId, messages) => {
      const s = get().state
      if (!s) return
      const r = recordDialogue(s, taskId, ministerId, messages)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
    },

    debate: (taskId, ministerIds) => {
      const s = get().state
      if (!s) return
      const r = recordDebate(s, taskId, ministerIds, [], '群臣各陈所见。')
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast('朝会已记入本季度议事。')
    },

    acceptSolution: (taskId, solution) => {
      const s = get().state
      if (!s) return
      const r = acceptSolution(s, taskId, solution)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast('已采纳此策，候拟圣旨。')
      set({ dialog: null })
    },

    issueEdict: (text, taskIds, solutionId) => {
      const s = get().state
      if (!s) return
      const r = issueEdict(s, text, taskIds, solutionId)
      if (!r.ok) return fail(r.error)
      apply(r.value.state)
      get().toast('圣旨已颁。')
      set({ dialog: null })
    },

    settleQuarter: async () => {
      const s = get().state
      if (!s) return
      if (s.simulationInFlight) return fail('本季度推演正在进行')

      set({ busy: true, aiStatus: llm.isEnabled() ? 'AI 正在推演本季度国势……' : '离线引擎正在推演本季度国势……' })
      const before = captureTransaction(s)

      let result: QuarterResult
      if (llm.isEnabled()) {
        try {
          const res = await ai.simulateQuarter(
            stateSnapshot(s),
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
      } else {
        // 离线确定性引擎（决策 D1）：无 API Key 时游戏仍可完整推进
        result = simulateQuarterOffline(s, s.year * 100 + s.quarter)
      }

      const applied = applyAiTransition(s, result.effects)
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
      if (!s) return
      const history: ChatMessage[] = [...(get().chats[minister.id] ?? []), { role: 'user', content: text }]
      set({ chats: { ...get().chats, [minister.id]: history } })

      const task = s.politicalTasks.find((t) => t.id === taskId) ?? activeTasks(s)[0]
      if (!task) {
        fail('当前没有可议的时政任务')
        return
      }

      if (!llm.isEnabled()) {
        // 离线：给出人物化的本地应答，并如实记入议事证据
        const reply = offlineMinisterReply(minister)
        set({ chats: { ...get().chats, [minister.id]: [...history, { role: 'assistant' as const, content: reply }] } })
        get().dialogue(task.id, minister.id, [
          { role: 'user', content: text },
          { role: 'assistant', content: reply },
        ])
        return
      }

      const res = await ai.chatWithMinister(minister, task, history, stateSnapshot(s), text, 0)
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

/** 离线模式下的大臣应答（依忠诚与派系生成，移植自 _fallback_reply 的语气）。 */
function offlineMinisterReply(m: Minister): string {
  const byLoyalty = [
    '陛下宵衣旰食，臣万死不辞。眼下之急，在足饷足兵，愿陛下垂察。',
    '臣愚见：事宜徐图，急则生变。伏乞陛下宽以时日。',
    '陛下圣谕，臣惶恐，此事干系重大，容臣从长计议。',
  ]
  if (m.loyalty >= 75) byLoyalty[1] = '民困则寇滋，宽一分则民受一分之赐。'
  if (m.faction === '阉党') return '厂臣一切但凭陛下圣裁。宫里宫外，臣都替陛下看着呢。'
  return byLoyalty[Math.abs(hashString(m.id)) % byLoyalty.length]!
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

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
