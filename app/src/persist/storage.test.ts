import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNewGame } from '../domain/state.ts'
import { deserializeSave } from './migrate.ts'
import { SaveManager, TauriStorage, type SaveStorage } from './storage.ts'

const fs = vi.hoisted(() => ({
  mkdir: vi.fn(), writeTextFile: vi.fn(), rename: vi.fn(), remove: vi.fn(),
  exists: vi.fn(), readTextFile: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-fs', () => fs)
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: async () => 'C:/AppData/com.shanhe.yongzhu/' }))

beforeEach(() => {
  vi.resetAllMocks()
  fs.mkdir.mockResolvedValue(undefined)
  fs.writeTextFile.mockResolvedValue(undefined)
  fs.rename.mockResolvedValue(undefined)
})

describe('Tauri 首次运行与安全存档', () => {
  const dir = 'C:/AppData/com.shanhe.yongzhu'
  const save = dir + '/save.json'

  it('先创建应用目录，再写临时文件，最后替换存档', async () => {
    await new TauriStorage().write('new save')
    expect(fs.mkdir).toHaveBeenCalledWith(dir, { recursive: true })
    expect(fs.writeTextFile).toHaveBeenCalledWith(save + '.tmp', 'new save')
    expect(fs.rename).toHaveBeenCalledWith(save + '.tmp', save)
    expect(fs.mkdir.mock.invocationCallOrder[0]).toBeLessThan(fs.writeTextFile.mock.invocationCallOrder[0]!)
    expect(fs.writeTextFile.mock.invocationCallOrder[0]).toBeLessThan(fs.rename.mock.invocationCallOrder[0]!)
    expect(fs.remove).not.toHaveBeenCalled()
  })

  it('临时文件写入失败时不动旧存档', async () => {
    fs.writeTextFile.mockRejectedValueOnce(new Error('disk full'))
    await expect(new TauriStorage().write('new')).rejects.toThrow('disk full')
    expect(fs.rename).not.toHaveBeenCalled()
    expect(fs.remove).not.toHaveBeenCalled()
  })

  it('替换失败时不预先删除旧存档', async () => {
    fs.rename.mockRejectedValueOnce(new Error('locked'))
    await expect(new TauriStorage().write('new')).rejects.toThrow('locked')
    expect(fs.remove).not.toHaveBeenCalled()
  })

  it('目录创建失败时不写入文件', async () => {
    fs.mkdir.mockRejectedValueOnce(new Error('denied'))
    await expect(new TauriStorage().write('new')).rejects.toThrow('denied')
    expect(fs.writeTextFile).not.toHaveBeenCalled()
  })

  it('全新安装没有存档', async () => {
    fs.exists.mockResolvedValue(false)
    const storage = new TauriStorage()
    expect(await storage.read()).toBeNull()
    expect(await storage.exists()).toBe(false)
    expect(fs.readTextFile).not.toHaveBeenCalled()
  })

  it('读取存档权限失败时不伪装成空存档', async () => {
    fs.exists.mockResolvedValue(true)
    fs.readTextFile.mockRejectedValueOnce(new Error('permission denied'))
    await expect(new TauriStorage().read()).rejects.toThrow('permission denied')
  })
})

describe('自动存档排队', () => {
  it('串行写入并在提交时捕获状态快照', async () => {
    const recorded: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const storage: SaveStorage = {
      read: async () => recorded.at(-1) ?? null,
      exists: async () => recorded.length > 0,
      write: vi.fn(async (text: string) => { await gate; recorded.push(text) }),
    }
    const manager = new SaveManager(storage)
    const state = createNewGame([], [], [])
    const a = manager.save(state)
    state.treasury = 456
    const b = manager.save(state)
    state.treasury = 999
    await Promise.resolve()
    expect(storage.write).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([a, b])
    expect(recorded.map((text) => deserializeSave(text).state.treasury)).toEqual([120, 456])
  })

  it('一次失败不会阻断后续存档', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('full')).mockResolvedValueOnce(undefined)
    const manager = new SaveManager({ read: async () => null, exists: async () => false, write })
    const state = createNewGame([], [], [])
    await expect(manager.save(state)).rejects.toThrow('full')
    await expect(manager.save(state)).resolves.toBeUndefined()
    expect(write).toHaveBeenCalledTimes(2)
  })
})
