import fs from 'node:fs'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

/**
 * 把项目根目录下的 data/ 与 assets/ 挂载到前端可访问的 /data 与 /assets。
 *
 * 单一数据源：这两个目录是引擎无关的既有资产，不复制进 app/，避免出现两份副本。
 *  - dev：通过中间件直接读取项目根目录
 *  - build：closeBundle 时复制进 dist，随 Tauri 前端资源一起打包
 */
const MOUNTS: ReadonlyArray<readonly [string, string]> = [
  ['/data', 'data'],
  ['/assets', 'assets'],
]

const MIME: Readonly<Record<string, string>> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ogg': 'audio/ogg',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.url': 'text/plain; charset=utf-8',
}

function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

export function gameAssets(projectRoot: string): Plugin {
  let outDir = 'dist'
  const dirs = MOUNTS.map(([prefix, rel]) => [prefix, path.resolve(projectRoot, rel)] as const)

  return {
    name: 'shanhe-game-assets',

    configResolved(config: ResolvedConfig) {
      outDir = config.build.outDir
    },

    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? ''
        for (const [prefix, base] of dirs) {
          if (url !== prefix && !url.startsWith(prefix + '/')) continue
          const rel = decodeURIComponent(url.slice(prefix.length)).replace(/^\/+/, '')
          const file = path.resolve(base, rel)
          // 目录穿越防护：解析后必须仍位于挂载根之内
          if (file !== base && !file.startsWith(base + path.sep)) return next()
          let stat: fs.Stats
          try {
            stat = fs.statSync(file)
          } catch {
            return next()
          }
          if (!stat.isFile()) return next()
          res.setHeader('Content-Type', contentType(file))
          res.setHeader('Content-Length', String(stat.size))
          fs.createReadStream(file).pipe(res)
          return
        }
        next()
      })
    },

    async closeBundle() {
      for (const [prefix, base] of dirs) {
        if (!fs.existsSync(base)) continue
        const dest = path.resolve(projectRoot, 'app', outDir, prefix.slice(1))
        await fs.promises.cp(base, dest, { recursive: true })
      }
    },
  }
}
