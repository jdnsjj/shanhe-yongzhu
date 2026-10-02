# 山河永驻

明末崇祯题材「王朝末期拯救」模拟游戏。玩家扮演 1627 年（崇祯元年）即位的朱由检，
理政、用人、征战，力挽狂澜——撑过十七年且民心、朝堂、疆域达标，即「山河永驻」。

> **技术栈**：TypeScript + React + Vite 前端，Tauri 2（Rust）桌面壳。
> 本仓库于 2026 年完成从 Godot 4.7 / GDScript 的全面重构，旧实现保留在 `godot-prototype` 标签。

---

## 运行

前置：Node ≥ 20、pnpm、Rust（stable-msvc）、WebView2（Windows 10/11 已内置）。

```bash
cd app
pnpm install
pnpm tauri dev      # 开发（热重载）
pnpm tauri build    # 打包 Windows 安装包（MSI / NSIS；需本机 WiX/NSIS 工具）
```

纯浏览器调试（无需 Rust）：

```bash
cd app
pnpm dev            # http://localhost:5173
```

### 测试与检查

```bash
cd app
pnpm test           # Vitest，267 项单测

生产环境资源校验：`pnpm build` 后确认 `dist/assets/audio/{bell,war,click}.ogg` 均存在。
pnpm typecheck      # tsc --noEmit
pnpm build          # 类型检查 + 生产构建
```

**核心红线**：`src/domain/` 是纯 TypeScript，不得 import React、Tauri 或任何浏览器 API。
所有领域单测在 **Node 环境（无 DOM）** 下运行——这是「纯逻辑」的客观证明。

---

## 玩法（MVP）

- **一回合 = 一个季度**，每季度 3 次行动机会。提交意图后推演并自动存档。
- **朝政**：颁布方略（轻徭薄赋 / 加派赋税 / 开仓赈济 / 整饬军务 / 修缮城防 / 开科取士 / 招抚流民）。
- **大臣**：明末真实人物卡牌（治政/统率/智略/忠诚/野心），任命内阁首辅与六部尚书；可「召见」对话。
- **军事**：舆图上左键查看当地信息，右键打开可执行操作（调兵布防、赈灾、整军、修城、招抚、出兵）。
- **国势视图**：右侧切换「民心、财政、税收、灾害、战乱」五种着色。
- **败亡**：京师陷落 / 国库跌破 -300 万 / 民心 ≤5 / 疆域 ≤6 省。撑到崇祯十七年末依民心、朝堂、疆域评定结局。

### 推演模式

游戏正式玩法为**全 AI 驱动**。历史提供背景与约束，不预设事件结果或固定数值后果。

- 召对由 AI 扮演大臣。玩家讨论解决方法后，可据议拟旨，审阅并颁布。
- 玩家也可在季度结算窗口直接填写圣旨，或依已颁圣旨结算。
- 季度 AI 读取任务、奏折、对话、圣旨、历史背景和待执行行动，推演国势、旧任务进度与下一季度任务。
- 历史事件选项调用 AI 裁决，经统一引用、数值及效果校验后提交，裁决会写入历史以避免重复结算。
- 未配置 AI 时只能查阅局势；请求失败或非法结果不推进回合，不再自动切换本地引擎。

`domain/offline.ts` 暂保留为旧逻辑回归测试辅助，不参与正式游戏流程。

---

## AI 配置（必需）

打包后的应用**不含** API Key。把 `config.json` 放到应用数据目录即可启用 AI 推演：

```
%APPDATA%\com.shanhe.yongzhu\config.json
```

```json
{
  "base_url": "https://open.bigmodel.cn/api/paas/v4",
  "api_key": "你的API Key",
  "model": "glm-4-flash",
  "prompt_cache_ttl_seconds": 45,
  "prompt_cache_max_entries": 64,
  "enable_prompt_cache": false,
  "prompt_cache_key": ""
}
```

支持任何 OpenAI `/chat/completions` 兼容服务（智谱 GLM、DeepSeek、Moonshot、OpenAI 等）。
开发期也可直接编辑项目根目录的 `config.json`（Vite 挂载为 `/config.json`，但**不会**打进安装包）。

---

## 架构

```
app/
├── src/
│   ├── domain/      【纯 TS】类型、常量、zod 协议校验、状态机、事务、离线引擎
│   ├── ai/          【纯 TS】LLM 客户端（稳定序列化 / LRU 缓存 / 并发去重）、提示词、操作封装
│   ├── map/         【纯 TS】几何、相机、命中检测、国势着色
│   ├── persist/     【纯 TS】存档序列化、Godot v5 存档迁移、存储适配器
│   ├── components/  【React】舆图 Canvas、HUD、弹窗
│   └── store.ts     zustand：把领域层接到 UI
└── src-tauri/       Rust 壳（极薄：窗口 + fs/dialog 插件）
```

依赖方向（架构红线，由 Node 环境单测与代码审查共同强制）：

```
components/store ──▶ domain ◀── ai
                     ▲
              map ───┘   persist ──┘
```

### 数据与素材

`data/`（1.5 MB 历史 JSON）与 `assets/`（含地图/UI/音频素材）为**引擎无关资产**，前后端共用同一份，
由 `app/vite-plugins/game-assets.ts` 在开发期挂载、构建期复制，**不产生副本**。

| 文件 | 内容 |
|---|---|
| `data/provinces.json` | 15 个明代一级行政区（两京十三布政使司），含 `historical_scope` 历史口径 |
| `data/world_regions.json` | 17 个外部区域（辽东都司、西海蒙古诸部、朝鲜、日本、台湾等） |
| `data/ministers.json` | 24 位真实明末人物（12 朝中 + 12 在野），含 `persona` 人格设定 |
| `data/events.json` | 14 个历史事件 |
| `data/province_shapes.json` | 省界多边形 |
| `data/label_layout.json` | 标签锚点/角度/字号 |

> **命名注意**：旧 GDScript 的 `pop` 实际语义是**民心**，`morale` 是**军心**。
> 新领域模型已更正为 `publicSupport` / `militaryMorale`，旧存档由 `persist/migrate.ts` 双向映射。

### 工具

- `tools/MapGen`、`tools/MapBuilder`、`tools/UiAssetPrep` —— 独立 .NET 8 控制台程序，仅开发期用于生成地图与 UI 素材，游戏运行时不依赖。
- `app/tools/verify-ui.mjs`、`verify-flow.mjs` —— 通过 CDP 驱动无头浏览器做端到端可视化验收。
- `legacy/legacy-python/` —— 历史 Python 脚本，仅供查阅。

---

## 文档

- `docs/00_交接报告.md` —— 交接报告：现状、架构、已知问题、后续路线
- `docs/01_明末历史背景与走向.md` —— 1627–1644 大事年表与事件化建议
- `docs/02_历史模拟器崇祯调研.md` —— 对标作品逐项拆解
- `docs/03_明末世界版图.md` —— 东亚与世界格局史料
- `docs/historical_map_sources.md` —— 明代区划口径与底图来源

---

## 重构说明

本次重构推翻了原 Godot/GDScript 实现（约 4,389 行），但**完整保留**了历史数据、素材与研究文档。
旧实现可通过 `git checkout godot-prototype` 取回；工作树中的原型文件和契约测试集中存放于 `legacy-godot/`，不参与 TypeScript/Tauri 构建。

重构修复的关键问题：

1. **推演定位**：重构初期曾引入离线引擎；现已按全 AI 玩法移出正式调用链，无 API 配置时不伪造世界变化。
2. **事件系统不可达**：`event_raised` 信号永不发射，14 个事件数据形同废纸 → 重新纳入推演流程。
3. **离线推演空转**（重构中自查发现）：离线引擎只改叙事不改数值 → 见 `diffEffects`。
4. **召对串消息**：全局单例信号无请求身份校验 → 改为按大臣 id 分组会话。
5. **死代码**：旧引擎中 16 个无调用者的本地公式函数、丢失的 Shader 源文件、空壳 C# 模块 → 全部清理。
6. **工程基建**：无版本控制 → 建立 git + 基线标签；清理 `nul` 等杂散文件（该文件曾导致 `git add` 直接失败）。
