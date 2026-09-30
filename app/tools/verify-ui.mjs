/**
 * 通过 CDP 驱动 headless Edge：进入游戏、截图、并检查控制台错误。
 * 仅用于开发期视觉验收，不参与产品代码。
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const URL = process.argv[2] ?? 'http://localhost:5199/'
const { spawn } = await import('node:child_process')
const fs = await import('node:fs')
const os = await import('node:os')
const pathMod = await import('node:path')

// profile 必须放在项目树之外，否则 Vite 的 FS 监听会因 EBUSY 崩溃
const PROFILE = pathMod.join(os.tmpdir(), 'shanhe-edge-profile')

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1280,720',
  '--user-data-dir=' + PROFILE,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {}
    await sleep(250)
  }
  throw new Error('CDP target not found')
}

const page = await targets()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let id = 0
const pending = new Map()
const logs = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push({ type: msg.params.type, text: (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ') })
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push({ type: 'exception', text: msg.params.exceptionDetails?.exception?.description ?? JSON.stringify(msg.params.exceptionDetails) })
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: URL })
await sleep(6000)

// 点击「开始新局」
const clicked = await send('Runtime.evaluate', {
  expression: `(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('开始新局'))
    if (!btn) return 'NO_BUTTON:' + document.body.innerText.slice(0,200)
    btn.click()
    return 'CLICKED'
  })()`,
  returnByValue: true,
})
console.log('click:', JSON.stringify(clicked.result?.result?.value))
await sleep(7000)

// 诊断：画布、省份数、离线标记
const diag = await send('Runtime.evaluate', {
  expression: `(() => {
    const canvas = document.querySelector('canvas.map-canvas')
    const text = document.body.innerText
    return JSON.stringify({
      hasCanvas: !!canvas,
      canvasW: canvas?.width ?? 0,
      canvasH: canvas?.height ?? 0,
      hasTopbar: !!document.querySelector('.topbar'),
      hasRightMenu: !!document.querySelector('.rightmenu'),
      chips: [...document.querySelectorAll('.chip')].map(c => c.innerText.replace(/\\s+/g,'')),
      offlineBadge: text.includes('离线推演'),
      dateLine: document.querySelector('.date')?.innerText ?? '',
      toasts: [...document.querySelectorAll('.toast')].map(t => t.innerText),
      bodyHead: text.slice(0, 200).replace(/\n/g, ' | '),
    })
  })()`,
  returnByValue: true,
})
console.log('diag:', diag.result?.result?.value)

const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(process.argv[3] ?? 'verify-game.png', Buffer.from(shot.result.data, 'base64'))
console.log('screenshot written')

const errors = logs.filter((l) => l.type === 'error' || l.type === 'exception')
console.log('console errors:', errors.length)
for (const e of errors.slice(0, 10)) console.log('  ERR:', e.text.slice(0, 300))

ws.close()
proc.kill()
process.exit(0)
