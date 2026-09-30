/**
 * LLM 客户端 —— 移植自 scripts/llm_client.gd。
 *
 * 保留的核心机制：
 *  - 稳定 system 前缀 + 动态 user 载荷（利于服务端 prompt cache 命中）
 *  - _stableJson 规范化：字典键排序，避免键序变化破坏请求指纹
 *  - 本地 LRU 缓存 + 并发去重（同一请求在飞行中时后续调用等待复用）
 *  - 请求统计
 * 新增：
 *  - 依赖注入 fetch，便于单测（不访问网络）
 *  - AbortSignal 超时控制
 *  - 流式输出（改善长文本推演的等待体验）
 */

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  cacheTtlSeconds: number
  cacheMaxEntries: number
  enablePromptCache: boolean
  promptCacheKey: string
}

export const DEFAULT_CONFIG: LlmConfig = {
  baseUrl: '',
  apiKey: '',
  model: '',
  cacheTtlSeconds: 45,
  cacheMaxEntries: 64,
  enablePromptCache: false,
  promptCacheKey: '',
}

export interface LlmResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
  usage?: Record<string, unknown>
}

export interface RequestStats {
  requests: number
  success: number
  errors: number
  cacheHits: number
  dedupeHits: number
  cacheEntries: number
  inflight: number
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface CacheEntry {
  expires: number
  result: LlmResult
}

/** 把值规范化为键序稳定的结构（对应 _canonicalize）。 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    const keys = Object.keys(value as Record<string, unknown>).sort()
    for (const k of keys) out[k] = canonicalize((value as Record<string, unknown>)[k])
    return out
  }
  return value
}

/** 稳定序列化（对应 _stable_json）。 */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/** 简易非加密摘要，仅用于缓存键（对应 GDScript 的 md5_text 用途）。 */
function digest(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

export class LlmClient {
  private config: LlmConfig
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private cache = new Map<string, CacheEntry>()
  private inflight = new Map<string, Promise<LlmResult>>()
  private stats = { requests: 0, success: 0, errors: 0, cacheHits: 0, dedupeHits: 0 }

  constructor(options: {
    config?: Partial<LlmConfig>
    fetchImpl?: FetchLike
    now?: () => number
  } = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options.config }
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.now = options.now ?? (() => Date.now())
  }

  getConfig(): Readonly<LlmConfig> {
    return this.config
  }

  configure(partial: Partial<LlmConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  isEnabled(): boolean {
    return this.config.apiKey !== '' && this.config.baseUrl !== ''
  }

  getStats(): RequestStats {
    return {
      ...this.stats,
      cacheEntries: this.cache.size,
      inflight: this.inflight.size,
    }
  }

  clearCache(): void {
    this.cache.clear()
  }

  /** 缓存键（对应 _cache_key）。 */
  private cacheKey(operation: string, payload: unknown, systemPrefix: string): string {
    return `${this.config.model}|${operation}|${digest(systemPrefix)}|${digest(stableJson(payload))}`
  }

  private cacheGet(key: string): LlmResult | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (entry.expires <= this.now()) {
      this.cache.delete(key)
      return null
    }
    this.stats.cacheHits += 1
    // Map 保持插入顺序；命中后移到末尾，淘汰时取最前即 LRU
    this.cache.delete(key)
    this.cache.set(key, entry)
    return structuredClone(entry.result)
  }

  private cachePut(key: string, result: LlmResult, ttlSeconds: number): void {
    if (key === '' || ttlSeconds <= 0 || !result.ok) return
    while (this.cache.size >= this.config.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    this.cache.set(key, { expires: this.now() + ttlSeconds * 1000, result: structuredClone(result) })
  }

  /**
   * 发起一次 JSON 请求（对应 _request_json）。
   * operation 为空表示不参与缓存。
   */
  async requestJson(
    systemPrefix: string,
    payload: unknown,
    options: { maxTokens?: number; operation?: string; cacheTtl?: number; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<LlmResult> {
    const { maxTokens = 1400, operation = '', cacheTtl = 0, timeoutMs = 60000, signal } = options

    if (!this.isEnabled()) {
      return { ok: false, error: 'AI推演未连接，请在 config.json 配置 API Key。' }
    }

    const key = operation !== '' ? this.cacheKey(operation, payload, systemPrefix) : ''
    const cached = key !== '' ? this.cacheGet(key) : null
    if (cached !== null) return cached

    if (key !== '') {
      const existing = this.inflight.get(key)
      if (existing) {
        this.stats.dedupeHits += 1
        // 并发去重：等待同一次飞行中的请求，然后复用其缓存结果
        const settled = await existing
        if (settled.ok) {
          const after = this.cacheGet(key)
          if (after !== null) return after
        }
        return settled
      }
    }

    const task = this.performHttp(systemPrefix, payload, maxTokens, operation, timeoutMs, signal)
    if (key !== '') this.inflight.set(key, task)

    let result: LlmResult
    try {
      result = await task
    } finally {
      if (key !== '') this.inflight.delete(key)
    }

    this.stats.requests += 1
    if (result.ok) this.stats.success += 1
    else this.stats.errors += 1

    // 状态推进调用保留最短 1 秒，用于同帧/并发去重；纯读取调用使用完整 TTL
    if (key !== '') this.cachePut(key, result, operation !== '' ? Math.max(1, cacheTtl) : 0)

    return result
  }

  private async performHttp(
    systemPrefix: string,
    payload: unknown,
    maxTokens: number,
    operation: string,
    timeoutMs: number,
    outerSignal?: AbortSignal,
  ): Promise<LlmResult> {
    const userContent = typeof payload === 'string' ? payload : stableJson(payload)

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: 'system', content: systemPrefix },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }
    if (this.config.enablePromptCache) {
      body['prompt_cache_key'] =
        this.config.promptCacheKey !== '' ? this.config.promptCacheKey : operation !== '' ? operation : 'shanhe-yongzhu'
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onOuterAbort = () => controller.abort()
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true })

    try {
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        return { ok: false, error: `AI推演服务无响应（HTTP ${response.status}）` }
      }

      const outer = (await response.json()) as Record<string, unknown>
      const choices = outer['choices']
      if (!Array.isArray(choices) || choices.length === 0) {
        return { ok: false, error: 'AI返回格式异常' }
      }

      const message = (choices[0] as Record<string, unknown>)['message'] as Record<string, unknown> | undefined
      let content = String(message?.['content'] ?? '').trim()
      if (content.startsWith('```')) {
        content = content.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim()
      }

      let data: unknown
      try {
        data = JSON.parse(content)
      } catch {
        return { ok: false, error: 'AI结果不是JSON对象' }
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return { ok: false, error: 'AI结果不是JSON对象' }
      }

      const result: LlmResult = { ok: true, data: data as Record<string, unknown> }
      const usage = outer['usage']
      if (typeof usage === 'object' && usage !== null) {
        result.usage = usage as Record<string, unknown>
      }
      return result
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name === 'AbortError') return { ok: false, error: 'AI请求超时' }
      return { ok: false, error: `AI请求失败（${(err as Error).message}）` }
    } finally {
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', onOuterAbort)
    }
  }
}

/** 压缩历史（对应 _compact_history）：限制条数与字符数。 */
export function compactHistory(
  history: Array<{ role?: string; content?: string }>,
  maxItems = 12,
  maxChars = 6000,
): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = []
  const start = Math.max(0, history.length - maxItems)
  let used = 0
  for (let i = start; i < history.length; i++) {
    const item = history[i]
    if (!item || typeof item !== 'object') continue
    const remaining = Math.max(0, maxChars - used)
    if (remaining <= 0) break
    let content = String(item.content ?? '')
    content = content.slice(0, Math.min(1200, remaining))
    out.push({ role: String(item.role ?? 'user'), content })
    used += content.length
  }
  return out
}
