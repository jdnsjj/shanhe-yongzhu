const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9335
const { spawn } = await import('node:child_process')
const os = await import('node:os'); const pathMod = await import('node:path')
const proc = spawn(EDGE, ['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--window-size=1280,720','--user-data-dir='+pathMod.join(os.tmpdir(),'shanhe-p3'),'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function findPage(){for(let i=0;i<40;i++){try{const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(t=>t.type==='page');if(p)return p}catch{}await sleep(250)}throw new Error('no page')}
const page = await findPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej})
let id=0; const pending=new Map()
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
const send=(method,params={})=>new Promise(res=>{const mid=++id;pending.set(mid,res);ws.send(JSON.stringify({id:mid,method,params}))})
const evalJs=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.result?.result?.value}
await send('Runtime.enable'); await send('Page.enable')
await send('Page.navigate',{url:'http://localhost:5199/'})
await sleep(6000)
await evalJs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('开始新局'));b.click();return 1})()")
await sleep(7000)
const chipsOf = "(()=>[...document.querySelectorAll('.chip')].map(x=>x.innerText.replace(/\\s+/g,'')))()"
const before = await evalJs(chipsOf)
await evalJs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('颁诏并结算本季度'));b.click();return 1})()")
await sleep(9000)
const narrative = await evalJs("(()=>document.querySelector('.narrative')?.innerText??'')()")
await evalJs("(()=>{const b=[...document.querySelectorAll('.paper-head button')][0];if(b)b.click();return 1})()")
await sleep(1500)
const after = await evalJs(chipsOf)
console.log(JSON.stringify({ before, narrative, after }, null, 2))
ws.close(); proc.kill(); process.exit(0)
