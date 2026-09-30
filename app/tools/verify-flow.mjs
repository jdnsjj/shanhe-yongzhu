/**
 * 端到端流程验证：新局 → 舆图渲染 → 离线结算一个季度 → 季度奏报。
 * 仅开发期使用，不参与产品代码。
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9334
const URL = process.argv[2] ?? 'http://localhost:5199/'
const { spawn } = await import('node:child_process')
const fs = await import('node:fs')
const os = await import('node:os')
const pathMod = await import('node:path')

const PROFILE = pathMod.join(os.tmpdir(), 'shanhe-edge-profile2')
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,720',
  '--user-data-dir=' + PROFILE, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p) return p
    } catch {}
    await sleep(250)
  }
  throw new Error('no CDP page')
}

const page = await findPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception')
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push((m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '))
  }
}
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description }
  return r.result?.result?.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(name, Buffer.from(s.result.data, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: URL })
await sleep(6000)

const report = {}

// 1) 开始新局
report.start = await evalJs("(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('开始新局')); if(!b) return 'NO_BUTTON'; b.click(); return 'ok' })()")
await sleep(7000)

// 2) 舆图与 HUD
report.hud = await evalJs(`(() => {
  const c = document.querySelector('canvas.map-canvas')
  const chips = [...document.querySelectorAll('.chip')].map(x => x.innerText.replace(/\\s+/g,''))
  return {
    canvas: !!c, w: c?.width ?? 0, h: c?.height ?? 0,
    topbar: !!document.querySelector('.topbar'),
    rightMenu: document.querySelectorAll('.menu-btn').length,
    chips,
    date: document.querySelector('.date')?.innerText ?? '',
    offline: document.body.innerText.includes('离线推演'),
    zoomBtns: document.querySelectorAll('.map-zoom button').length,
  }
})()`)

// 3) 画布是否真的画了东西（采样非背景色像素）
report.canvasPainted = await evalJs(`(() => {
  const c = document.querySelector('canvas.map-canvas')
  if (!c) return 'no canvas'
  const ctx = c.getContext('2d')
  const data = ctx.getImageData(0, 0, c.width, c.height).data
  const seen = new Set()
  for (let i = 0; i < data.length; i += 4 * 997) {
    seen.add(\`\${data[i]},\${data[i+1]},\${data[i+2]}\`)
  }
  return { distinctColors: seen.size }
})()`)

// 4) 打开时政任务面板
report.tasksDialog = await evalJs("(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('时政任务')); if(!b) return 'NO_BUTTON'; b.click(); return 'ok' })()")
await sleep(1200)
report.taskDialogVisible = await evalJs("(() => document.querySelector('.paper h2')?.innerText ?? 'none')()")
await shot('verify-tasks.png')
await evalJs("(() => { const b=[...document.querySelectorAll('.paper-head button')][0]; if(b) b.click(); return 'closed' })()")
await sleep(800)

// 5) 离线结算一个季度
report.settle = await evalJs("(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('颁诏并结算本季度')); if(!b) return 'NO_BUTTON'; b.click(); return 'ok' })()")
await sleep(9000)

report.afterSettle = await evalJs(`(() => {
  const paper = document.querySelector('.paper h2')?.innerText ?? ''
  const narrative = document.querySelector('.narrative')?.innerText ?? ''
  const applied = [...document.querySelectorAll('.applied li')].map(li => li.innerText)
  return {
    dialogTitle: paper,
    narrativeLen: narrative.length,
    narrativeHead: narrative.slice(0, 120),
    appliedCount: applied.length,
    appliedHead: applied.slice(0, 6),
    date: document.querySelector('.date')?.innerText ?? '',
  }
})()`)
await shot('verify-report.png')

// 6) 关闭奏报，确认季度已推进
await evalJs("(() => { const b=[...document.querySelectorAll('.paper-head button')][0]; if(b) b.click(); return 'closed' })()")
await sleep(1500)
report.afterClose = await evalJs(`(() => ({
  date: document.querySelector('.date')?.innerText ?? '',
  historyEntries: document.querySelectorAll('.history li').length,
}))()`)

console.log(JSON.stringify(report, null, 2))
console.log('console errors:', errors.length)
for (const e of errors.slice(0, 8)) console.log('  ERR:', String(e).slice(0, 200))

ws.close()
proc.kill()
process.exit(0)
