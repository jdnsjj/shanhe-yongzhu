/**
 * 存档存储适配器。
 *
 * 抽象出接口，使领域/UI 层不直接依赖 Tauri：
 *  - 浏览器/测试环境使用内存或 localStorage 实现
 *  - Tauri 环境使用 fs 插件实现
 *
 * 写入采用「临时文件 + 替换」以保证原子性，避免中途崩溃损坏存档。
 */

import { deserializeSave, serializeSave, type SaveFile } from './migrate.ts'
import type { GameState } from '../domain/types.ts'

export interface SaveStorage {
  read(): Promise<string | null>
  write(text: string): Promise<void>
  exists(): Promise<boolean>
}

/** 内存实现：用于测试与无持久化场景。 */
export class MemoryStorage implements SaveStorage {
  private text: string | null = null
  async read(): Promise<string | null> {
    return this.text
  }
  async write(text: string): Promise<void> {
    this.text = text
  }
  async exists(): Promise<boolean> {
    return this.text !== null
  }
}

/** localStorage 实现：用于纯浏览器调试。 */
export class LocalStorageAdapter implements SaveStorage {
  constructor(private readonly key = 'shanhe-save') {}
  async read(): Promise<string | null> {
    return globalThis.localStorage?.getItem(this.key) ?? null
  }
  async write(text: string): Promise<void> {
    globalThis.localStorage?.setItem(this.key, text)
  }
  async exists(): Promise<boolean> {
    return (await this.read()) !== null
  }
}

/** Tauri fs 实现。仅在 Tauri 环境构造（延迟 import 以避免浏览器报错）。 */
export class TauriStorage implements SaveStorage {
  constructor(private readonly fileName = 'save.json') {}

  private async api() {
    return import('@tauri-apps/plugin-fs')
  }

  async read(): Promise<string | null> {
    const fs = await this.api()
    try {
      const dir = await this.dir()
      const path = `${dir}/${this.fileName}`
      if (!(await fs.exists(path))) return null
      return await fs.readTextFile(path)
    } catch {
      return null
    }
  }

  async write(text: string): Promise<void> {
    const fs = await this.api()
    const dir = await this.dir()
    const path = `${dir}/${this.fileName}`
    const tmp = `${path}.tmp`
    await fs.writeTextFile(tmp, text)
    // 原子替换：先删旧再改名，避免半写状态
    if (await fs.exists(path)) await fs.remove(path)
    await fs.rename(tmp, path)
  }

  async exists(): Promise<boolean> {
    const fs = await this.api()
    try {
      return await fs.exists(`${await this.dir()}/${this.fileName}`)
    } catch {
      return false
    }
  }

  private async dir(): Promise<string> {
    const { appDataDir } = await import('@tauri-apps/api/path')
    const base = await appDataDir()
    return `${base.replace(/[\\/]+$/, '')}/`
  }
}

/** 存档管理器：封装序列化与迁移。 */
export class SaveManager {
  constructor(private readonly storage: SaveStorage) {}

  async hasSave(): Promise<boolean> {
    return this.storage.exists()
  }

  async save(state: GameState): Promise<void> {
    await this.storage.write(serializeSave(state))
  }

  /** 读取存档；旧 Godot 格式会被自动迁移。 */
  async load(): Promise<SaveFile | null> {
    const text = await this.storage.read()
    if (text === null) return null
    return deserializeSave(text)
  }
}
