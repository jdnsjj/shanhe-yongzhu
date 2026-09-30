/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { gameAssets } from './vite-plugins/game-assets.ts'

const appDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(appDir, '..')

export default defineConfig({
  plugins: [react(), gameAssets(projectRoot)],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // data/ 与 assets/ 合计约 20 MB，属预期体积
    chunkSizeWarningLimit: 4000,
  },

  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // 浏览器调试配置、构建产物等不应触发 HMR 监听（否则 Windows 下会 EBUSY 崩溃）
      ignored: ['**/tmp-*/**', '**/target/**', '**/dist/**', '**/.verify/**'],
    },
  },

  test: {
    // 领域层必须在无 DOM 的 Node 环境下可测 —— 这是「纯逻辑」的客观证明
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
  },
})
