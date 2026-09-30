/**
 * 面向玩法的 AI 操作封装 —— 对应 llm_client.gd 的各 generate_* / simulate_* 方法。
 * 统一负责：构造 payload、调用客户端、按需用 zod 校验结构。
 */

import { compactHistory, type LlmClient, type LlmResult } from './client.ts'
import {
  PREFIX_BATTLE,
  PREFIX_BULLETIN,
  PREFIX_DEBATE,
  PREFIX_EDICT,
  PREFIX_EDICT_DRAFT,
  PREFIX_END,
  PREFIX_EVENT,
  PREFIX_QUARTER,
  PREFIX_SOLUTION,
  PREFIX_VALIDATE,
  ministerPrefix,
} from './prefixes.ts'
import { POSITIONS, type PositionId } from '../domain/constants.ts'
import type { GameState, Minister, PoliticalTask, QuarterInputs } from '../domain/types.ts'

/** 供 AI 使用的状态快照（对应 state_snapshot）。 */
export function stateSnapshot(state: GameState): Record<string, unknown> {
  // 大臣 id -> 所任官职名（对应旧 position_of + POSITIONS 查名）
  const positionByMinister: Record<string, string> = {}
  for (const [pos, mid] of Object.entries(state.appointments)) {
    const name = POSITIONS[pos as PositionId]?.name
    if (mid && name) positionByMinister[mid] = name
  }
  return {
    schema_version: 5,
    date: `崇祯${state.year - 1626}年 · 第${state.quarter}季度`,
    year: state.year,
    quarter: state.quarter,
    stage: state.stage,
    treasury: Math.trunc(state.treasury),
    actions_left: state.actionsLeft,
    court_stability: Math.trunc(state.courtStability),
    rebel_power: Math.trunc(state.rebelPower),
    jin_power: Math.trunc(state.jinPower),
    provinces: state.provinces.map((p) => ({
      id: p.id, name: p.name, owner: p.owner, tax: Math.trunc(p.tax),
      pop: Math.trunc(p.publicSupport), morale: Math.trunc(p.militaryMorale),
      garrison: Math.trunc(p.garrison), fort: p.fort, adj: p.adjacent,
    })),
    ministers: state.ministers.map((m) => ({
      id: m.id, name: m.name, faction: m.faction, loyalty: Math.trunc(m.loyalty),
      command: Math.trunc(m.command), politics: Math.trunc(m.politics),
      wisdom: Math.trunc(m.wisdom), position: positionByMinister[m.id] ?? '',
    })),
    pool: state.pool.map((m) => ({
      id: m.id, name: m.name, title: m.title, faction: m.faction,
      command: Math.trunc(m.command), politics: Math.trunc(m.politics), wisdom: Math.trunc(m.wisdom),
    })),
    appointments: { ...state.appointments },
    political_tasks: state.politicalTasks,
    quarter_edicts: state.quarterEdicts,
    current_quarter_bulletins: state.currentQuarterBulletins,
    current_quarter_dialogues: state.currentQuarterDialogues,
    current_quarter_debates: state.currentQuarterDebates,
    current_quarter_decisions: state.currentQuarterDecisions,
    quarter_summaries: state.quarterSummaries,
    pending_actions: state.pendingActions,
    history: state.history.slice(-12),
  }
}

export class AiOperations {
  constructor(private readonly client: LlmClient) {}

  /** 大臣召对。 */
  chatWithMinister(
    minister: Minister,
    task: PoliticalTask,
    history: Array<{ role: string; content: string }>,
    snapshot: Record<string, unknown>,
    userText: string,
    cacheTtl: number,
  ): Promise<LlmResult> {
    const payload = {
      task,
      court_context: {
        date: snapshot['date'], treasury: snapshot['treasury'], avg_pop: snapshot['avg_pop'],
        avg_morale: snapshot['avg_morale'], court_stability: snapshot['court_stability'],
        rebel_power: snapshot['rebel_power'], jin_power: snapshot['jin_power'],
      },
      history: compactHistory(history),
      user_text: userText,
    }
    return this.client.requestJson(ministerPrefix(minister), payload, {
      maxTokens: 600, operation: `minister_chat_${minister.id}`, cacheTtl, timeoutMs: 60000,
    })
  }

  /** 季度重要奏折（仅作议事证据，不改数值）。 */
  generateQuarterBulletins(
    snapshot: Record<string, unknown>,
    previousTasks: PoliticalTask[],
    quarterContext: Record<string, unknown>,
    cacheTtl: number,
  ): Promise<LlmResult> {
    return this.client.requestJson(
      PREFIX_BULLETIN,
      { snapshot, previous_tasks: previousTasks, quarter_context: quarterContext },
      { maxTokens: 1100, operation: 'quarter_bulletins', cacheTtl },
    )
  }

  /** 朝会记录。 */
  runCourtDebate(
    snapshot: Record<string, unknown>,
    task: PoliticalTask,
    ministers: Minister[],
    transcript: Array<{ role: string; content: string }>,
    cacheTtl: number,
  ): Promise<LlmResult> {
    return this.client.requestJson(
      PREFIX_DEBATE,
      { task, ministers, transcript: compactHistory(transcript, 24, 10000), snapshot },
      { maxTokens: 1400, operation: 'court_debate', cacheTtl },
    )
  }

  /** 方案审议。 */
  deriveTaskSolution(
    snapshot: Record<string, unknown>,
    task: PoliticalTask,
    bulletins: unknown[],
    dialogues: unknown[],
    debates: unknown[],
    cacheTtl: number,
  ): Promise<LlmResult> {
    return this.client.requestJson(
      PREFIX_SOLUTION,
      { task, bulletins, dialogues, debates, snapshot },
      { maxTokens: 1200, operation: 'task_solution', cacheTtl },
    )
  }

  /** 依议事记录拟旨。 */
  draftEdictFromDialogue(
    snapshot: Record<string, unknown>,
    task: PoliticalTask,
    transcript: Array<{ role: string; content: string }>,
    cacheTtl: number,
  ): Promise<LlmResult> {
    return this.client.requestJson(
      PREFIX_EDICT_DRAFT,
      { snapshot, task, transcript: compactHistory(transcript, 24, 10000) },
      { maxTokens: 800, operation: 'edict_draft', cacheTtl },
    )
  }

  /** 季度世界推演（核心调用）。 */
  simulateQuarter(
    snapshot: Record<string, unknown>,
    previousTasks: PoliticalTask[],
    quarterInputs: QuarterInputs,
    edicts: unknown[],
    history: string[],
  ): Promise<LlmResult> {
    return this.client.requestJson(
      PREFIX_QUARTER,
      {
        quarter_start_snapshot: snapshot,
        previous_tasks: previousTasks,
        quarter_inputs: quarterInputs,
        formal_edicts: edicts,
        history: compactHistory(history.map((h) => ({ role: 'user', content: h })), 24, 10000),
      },
      { maxTokens: 2400, operation: 'simulate_quarter', timeoutMs: 90000 },
    )
  }

  /** 语义校验。 */
  validateState(before: unknown, proposed: unknown, cacheTtl: number): Promise<LlmResult> {
    return this.client.requestJson(
      PREFIX_VALIDATE,
      { before, proposed },
      { maxTokens: 700, operation: 'validate_state', cacheTtl },
    )
  }

  /** 诏书推演。 */
  simulateEdict(snapshot: unknown, monthLog: unknown[], edict: string): Promise<LlmResult> {
    return this.client.requestJson(
      PREFIX_EDICT,
      { snapshot, previous_events: monthLog, edict: edict.trim() !== '' ? edict : '（本回合未下诏）' },
      { maxTokens: 800, operation: 'simulate_edict' },
    )
  }

  /** 战斗推演。 */
  resolveBattle(snapshot: unknown, intent: unknown): Promise<LlmResult> {
    return this.client.requestJson(PREFIX_BATTLE, { snapshot, intent }, { maxTokens: 900, operation: 'resolve_battle' })
  }

  /** 事件裁决。 */
  resolveEventChoice(snapshot: unknown, event: unknown, choice: unknown): Promise<LlmResult> {
    return this.client.requestJson(
      PREFIX_EVENT,
      { snapshot, event, choice },
      { maxTokens: 1000, operation: 'resolve_event' },
    )
  }

  /** 终局判定。 */
  evaluateGameEnd(snapshot: unknown, cacheTtl: number): Promise<LlmResult> {
    return this.client.requestJson(PREFIX_END, { snapshot }, { maxTokens: 500, operation: 'evaluate_end', cacheTtl })
  }
}
