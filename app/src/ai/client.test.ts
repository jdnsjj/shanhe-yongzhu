import { describe, expect, it, vi } from 'vitest'
import { LlmClient, canonicalize, compactHistory, stableJson } from './client.ts'

/** 构造一个返回指定 JSON 的假 fetch。 */
function mockFetch(payload: unknown, init: { status?: number; ok?: boolean } = {}) {
  const { status = 200, ok = true } = init
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    ({
      ok,
      status,
      json: async () => payload,
    }) as unknown as Response,
  )
}

/** 读取假 fetch 第 n 次调用的参数（避免 vi.fn 元组推断问题）。 */
function callArgs(f: { mock: { calls: unknown[][] } }, n = 0): [string, RequestInit] {
  const call = f.mock.calls[n]
  if (!call) throw new Error(`mock fetch 未被调用第 ${n} 次`)
  return call as [string, RequestInit]
}

function chatResponse(content: unknown, usage?: Record<string, unknown>) {
  return {
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    ...(usage ? { usage } : {}),
  }
}

const cfg = { baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm' }

describe('稳定序列化', () => {
  it('键序不同但内容相同的对象序列化一致', () => {
    const a = { z: { b: 2, a: 1 }, a: [3, 2, 1] }
    const b = { a: [3, 2, 1], z: { a: 1, b: 2 } }
    expect(stableJson(a)).toBe(stableJson(b))
  })

  it('数组顺序不被改变', () => {
    expect(stableJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('canonicalize 递归处理嵌套结构', () => {
    const out = canonicalize({ b: [{ d: 1, c: 2 }], a: 1 }) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['a', 'b'])
  })
})

describe('启用判定', () => {
  it('缺少 key 或 baseUrl 时视为未启用', () => {
    expect(new LlmClient().isEnabled()).toBe(false)
    expect(new LlmClient({ config: { baseUrl: 'x' } }).isEnabled()).toBe(false)
    expect(new LlmClient({ config: { apiKey: 'k' } }).isEnabled()).toBe(false)
    expect(new LlmClient({ config: cfg }).isEnabled()).toBe(true)
  })

  it('未启用时直接返回错误且不发请求', async () => {
    const f = mockFetch(chatResponse({}))
    const client = new LlmClient({ fetchImpl: f })
    const r = await client.requestJson('sys', {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未连接')
    expect(f).not.toHaveBeenCalled()
  })
})

describe('请求与解析', () => {
  it('成功解析 JSON 结果与 usage', async () => {
    const f = mockFetch(chatResponse({ narrative: '事定' }, { total_tokens: 12 }))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    const r = await client.requestJson('sys', { a: 1 })
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ narrative: '事定' })
    expect(r.usage).toEqual({ total_tokens: 12 })
  })

  it('剥离 Markdown 代码块围栏', async () => {
    const f = mockFetch(chatResponse('```json\n{"ok":1}\n```'))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    const r = await client.requestJson('sys', {})
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ ok: 1 })
  })

  it('拒绝非 JSON 内容', async () => {
    const f = mockFetch(chatResponse('这不是JSON'))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    const r = await client.requestJson('sys', {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('JSON')
  })

  it('拒绝 JSON 数组（必须是对象）', async () => {
    const f = mockFetch(chatResponse([1, 2, 3]))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    expect((await client.requestJson('sys', {})).ok).toBe(false)
  })

  it('HTTP 非 2xx 返回错误', async () => {
    const f = mockFetch({}, { ok: false, status: 500 })
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    const r = await client.requestJson('sys', {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('500')
  })

  it('缺少 choices 时返回格式异常', async () => {
    const f = mockFetch({ choices: [] })
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    const r = await client.requestJson('sys', {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('格式异常')
  })

  it('网络异常被捕获为错误结果', async () => {
    const f = vi.fn(async () => {
      throw new Error('boom')
    })
    const client = new LlmClient({ config: cfg, fetchImpl: f as never })
    const r = await client.requestJson('sys', {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
  })

  it('请求体包含模型、双消息与 JSON 模式', async () => {
    const f = mockFetch(chatResponse({ ok: 1 }))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    await client.requestJson('SYS', { q: 1 }, { maxTokens: 999 })
    const [url, init] = callArgs(f)
    expect(url).toBe('https://example.test/v1/chat/completions')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('m')
    expect(body.max_tokens).toBe(999)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(body.messages[1].role).toBe('user')
  })

  it('baseUrl 末尾斜杠被规范化', async () => {
    const f = mockFetch(chatResponse({ ok: 1 }))
    const client = new LlmClient({ config: { ...cfg, baseUrl: 'https://example.test/v1///' }, fetchImpl: f })
    await client.requestJson('sys', {})
    expect(callArgs(f)[0]).toBe('https://example.test/v1/chat/completions')
  })

  it('启用远端 prompt cache 时附带 cache key', async () => {
    const f = mockFetch(chatResponse({ ok: 1 }))
    const client = new LlmClient({
      config: { ...cfg, enablePromptCache: true, promptCacheKey: 'ck' },
      fetchImpl: f,
    })
    await client.requestJson('sys', {}, { operation: 'op' })
    const body = JSON.parse(String(callArgs(f)[1].body))
    expect(body.prompt_cache_key).toBe('ck')
  })
})

describe('缓存', () => {
  it('相同请求第二次命中缓存', async () => {
    const f = mockFetch(chatResponse({ v: 1 }))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    await client.requestJson('sys', { a: 1 }, { operation: 'op', cacheTtl: 60 })
    const second = await client.requestJson('sys', { a: 1 }, { operation: 'op', cacheTtl: 60 })
    expect(second.data).toEqual({ v: 1 })
    expect(f).toHaveBeenCalledTimes(1)
    expect(client.getStats().cacheHits).toBeGreaterThan(0)
  })

  it('键序不同的相同请求也命中缓存', async () => {
    const f = mockFetch(chatResponse({ v: 1 }))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    await client.requestJson('sys', { a: 1, b: 2 }, { operation: 'op', cacheTtl: 60 })
    await client.requestJson('sys', { b: 2, a: 1 }, { operation: 'op', cacheTtl: 60 })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('不同 system 前缀不共享缓存', async () => {
    const f = mockFetch(chatResponse({ v: 1 }))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    await client.requestJson('SYS-A', { a: 1 }, { operation: 'op', cacheTtl: 60 })
    await client.requestJson('SYS-B', { a: 1 }, { operation: 'op', cacheTtl: 60 })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('无 operation 时不缓存', async () => {
    const f = mockFetch(chatResponse({ v: 1 }))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    await client.requestJson('sys', { a: 1 })
    await client.requestJson('sys', { a: 1 })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('失败结果不被缓存', async () => {
    const f = mockFetch({}, { ok: false, status: 500 })
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    await client.requestJson('sys', {}, { operation: 'op', cacheTtl: 60 })
    await client.requestJson('sys', {}, { operation: 'op', cacheTtl: 60 })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('TTL 过期后重新请求', async () => {
    let clock = 0
    const f = mockFetch(chatResponse({ v: 1 }))
    const client = new LlmClient({ config: cfg, fetchImpl: f, now: () => clock })
    await client.requestJson('sys', {}, { operation: 'op', cacheTtl: 10 })
    clock = 11_000
    await client.requestJson('sys', {}, { operation: 'op', cacheTtl: 10 })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('超出容量时按 LRU 淘汰', async () => {
    const f = mockFetch(chatResponse({ v: 1 }))
    const client = new LlmClient({ config: { ...cfg, cacheMaxEntries: 8 }, fetchImpl: f })
    for (let i = 0; i < 20; i++) {
      await client.requestJson('sys', { i }, { operation: 'op', cacheTtl: 600 })
    }
    expect(client.getStats().cacheEntries).toBeLessThanOrEqual(8)
  })

  it('clearCache 清空缓存', async () => {
    const f = mockFetch(chatResponse({ v: 1 }))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    await client.requestJson('sys', {}, { operation: 'op', cacheTtl: 60 })
    client.clearCache()
    expect(client.getStats().cacheEntries).toBe(0)
  })
})

describe('并发去重', () => {
  it('同一请求并发时只发一次', async () => {
    let resolve!: (v: Response) => void
    const pending = new Promise<Response>((r) => (resolve = r))
    const f = vi.fn(() => pending)
    const client = new LlmClient({ config: cfg, fetchImpl: f as never })

    const p1 = client.requestJson('sys', { a: 1 }, { operation: 'op', cacheTtl: 60 })
    const p2 = client.requestJson('sys', { a: 1 }, { operation: 'op', cacheTtl: 60 })

    resolve({
      ok: true,
      status: 200,
      json: async () => chatResponse({ v: 7 }),
    } as unknown as Response)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(f).toHaveBeenCalledTimes(1)
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(client.getStats().dedupeHits).toBe(1)
  })
})

describe('统计', () => {
  it('记录成功、失败与缓存命中', async () => {
    const f = mockFetch(chatResponse({ v: 1 }))
    const client = new LlmClient({ config: cfg, fetchImpl: f })
    await client.requestJson('sys', {}, { operation: 'op', cacheTtl: 60 })
    await client.requestJson('sys', {}, { operation: 'op', cacheTtl: 60 })
    const s = client.getStats()
    expect(s.requests).toBe(1)
    expect(s.success).toBe(1)
    expect(s.errors).toBe(0)
    expect(s.cacheHits).toBe(1)
  })
})

describe('历史压缩', () => {
  it('限制条数', () => {
    const h = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: 'x' + i }))
    expect(compactHistory(h, 5)).toHaveLength(5)
  })

  it('限制总字符数', () => {
    const h = Array.from({ length: 20 }, () => ({ role: 'user', content: 'y'.repeat(1000) }))
    const out = compactHistory(h, 20, 2500)
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(2500)
  })

  it('跳过非对象条目', () => {
    expect(compactHistory([null as never, { role: 'user', content: 'ok' }])).toHaveLength(1)
  })

  it('缺省 role 为 user', () => {
    expect(compactHistory([{ content: 'x' }])[0]!.role).toBe('user')
  })
})

describe('超时', () => {
  it('超时返回可读错误', async () => {
    const f = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          rej(e)
        })
      }),
    )
    const client = new LlmClient({ config: cfg, fetchImpl: f as never })
    const r = await client.requestJson('sys', {}, { timeoutMs: 10 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('超时')
  })
})

describe('配置', () => {
  it('configure 可局部更新', () => {
    const client = new LlmClient({ config: cfg })
    client.configure({ model: 'm2' })
    expect(client.getConfig().model).toBe('m2')
    expect(client.getConfig().apiKey).toBe('k')
  })
})
