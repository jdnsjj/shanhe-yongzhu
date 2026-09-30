extends Node
## LLM 对话客户端（自动加载单例）
## 稳定规则固定在 system 前缀，动态快照放在 user 载荷；支持本地短期缓存和并发去重。

signal reply_ready(result: Dictionary)
signal edict_ready(result: Dictionary)
signal month_ready(result: Dictionary)
signal quarter_ready(result: Dictionary)
signal battle_ready(result: Dictionary)
signal event_ready(result: Dictionary)
signal end_ready(result: Dictionary)
signal validation_ready(result: Dictionary)
signal bulletin_ready(result: Dictionary)
signal solution_ready(result: Dictionary)
signal debate_ready(result: Dictionary)
signal edict_draft_ready(result: Dictionary)
signal request_finished(cache_key: String, result: Dictionary)

const CORE_SCHEMA_VERSION := 1
const CONFIG_PATHS := ["res://config.json", "user://config.json"]
const DEFAULT_CACHE_TTL := 45.0
const DEFAULT_CACHE_SIZE := 64

const PREFIX_EDICT := """你是《山河永驻》的明末诏书推演引擎。玩家扮演1627年即位的崇祯皇帝。此前已发生的历史事件结果不可改写；诏书务实则产生对应效果，空想则效果打折或引发弊端，未下诏则按惯性推演。只输出一个 JSON 对象，不要 Markdown 或额外文字。效果 target 只能是 global、快照中的 province:id 或 minister:id；field 只能是 treasury、court_stability、rebel_power、jin_power、pop、morale、garrison、loyalty。treasury 限制 ±80 万两，court_stability ±10，rebel_power/jin_power ±12，单省 pop ±10、morale ±12、garrison ±5、单臣 loyalty ±15，效果 0-4 条。narrative 用史册笔法且不超过150字，必须提及至少一条具体后果。输出格式：{"narrative":"...","effects":[{"target":"global|province:id|minister:id","field":"...","delta":整数,"reason":"一句话理由"}]}"""
const PREFIX_BULLETIN := """你是明末政务奏折生成引擎。根据输入生成本季度重要奏折及关联任务。不得输出任何世界数值效果，不得捏造快照中没有的事实；只输出 schema_version、bulletins 和 task_candidates 的 JSON 对象。"""
const PREFIX_DEBATE := """你是明末朝会记录官。围绕指定时政任务组织多人讨论，输出逐人发言、立场、分歧、证据和方案候选，不得改变世界数值，不得虚构未提供的大臣。只输出约定 JSON。"""
const PREFIX_SOLUTION := """你是明末政务方案审议官。只能依据真实奏折、私聊和朝会记录形成结构化方案；没有对话证据时必须返回 eligible=false。不得改变世界数值，不得补写输入中不存在的证据。只输出约定 JSON。"""
const PREFIX_EDICT_DRAFT := """你是明末朝廷中书科拟诏官。把议事记录中已经讨论形成的方案总结为正式圣旨，不得添加议事中从未讨论过的新政策，不得输出世界数值效果。圣旨以“奉天承运皇帝，诏曰：”起首，用半文言逐条列出议定事项、责任归属与执行要求，以“钦此”或“布告天下，咸使闻知”收束，全文150至300字。只输出 {"edict_text":"圣旨全文","summary":"一句话概括所议之策"}。"""
const PREFIX_QUARTER := """你是《山河永驻》的唯一季度世界推演引擎。一个正式回合就是一个季度。必须依据季度起始快照、上一季度任务状态、本季度奏折、私聊、朝会、皇帝决定、玩家已提交行动和全部已颁正式圣旨，决定本季度发生的一切。不得把财政、民心、军心、流寇、后金、战斗、事件、任务完成与结局交给本地公式。草稿和未颁圣旨不得视为命令。pending_actions 只能结算一次，旧季度行动不得重复生效。开科取士若确有依据，只能输出一个 recruit effects 项，delta 必须是快照 pool 中已有的人才 ID。只输出 schema_version=1 的 JSON 对象，字段为 quarter_summary、narrative、treasury、effects、events、battles、task_updates、next_quarter_tasks、end_evaluation、validation。effects 的 field 只能是 treasury、court_stability、rebel_power、jin_power、pop、morale、garrison、loyalty、owner、fort、appointment、recruit；target 只能是 global、快照中的 province:id、minister:id 或 position:id。任务只有在正式圣旨实际解决问题时才能 completed，否则保留 active 并写明阻碍与下一步目标。"""
const PREFIX_BATTLE := "你是明末战争推演引擎。根据快照和战斗意图决定胜负、损失、占领与叙事，不得输出快照不存在的目标或兵力。只输出约定 JSON。"
const PREFIX_EVENT := "你是明末事件结果推演引擎。根据快照、事件和皇帝选择输出真实后果，只输出约定 JSON，不得捏造不存在的地区、人物或效果。"
const PREFIX_END := "你是明末历史结局判定引擎。只依据给出的完整状态判断 ongoing、victory 或 defeat，并说明引用的事实。只输出约定 JSON。"
const PREFIX_VALIDATE := "你是世界状态语义校验官。检查提议状态是否与前状态、历史时序、势力关系和效果叙事一致，只输出约定 JSON，不要修改状态。"

var base_url := ""
var api_key := ""
var model := ""
var persona_context := ""
var cache_ttl_seconds := DEFAULT_CACHE_TTL
var cache_max_entries := DEFAULT_CACHE_SIZE
var enable_remote_prompt_cache := false
var remote_prompt_cache_key := ""
var _cache: Dictionary = {}
var _inflight: Dictionary = {}
var _stats := {"requests": 0, "success": 0, "errors": 0, "cache_hits": 0, "dedupe_hits": 0}


func _ready() -> void:
	_load_config()


func reload_config() -> void:
	base_url = ""
	api_key = ""
	model = ""
	enable_remote_prompt_cache = false
	remote_prompt_cache_key = ""
	_load_config()


func is_enabled() -> bool:
	return api_key != "" and base_url != ""


func _load_config() -> void:
	for p in CONFIG_PATHS:
		if not FileAccess.file_exists(p):
			continue
		var f := FileAccess.open(p, FileAccess.READ)
		if f == null:
			continue
		var data = JSON.parse_string(f.get_as_text())
		if data is Dictionary:
			base_url = str(data.get("base_url", ""))
			api_key = str(data.get("api_key", ""))
			model = str(data.get("model", ""))
			cache_ttl_seconds = clampf(float(data.get("prompt_cache_ttl_seconds", DEFAULT_CACHE_TTL)), 0.0, 600.0)
			cache_max_entries = clampi(int(data.get("prompt_cache_max_entries", DEFAULT_CACHE_SIZE)), 8, 256)
			enable_remote_prompt_cache = bool(data.get("enable_prompt_cache", false))
			remote_prompt_cache_key = str(data.get("prompt_cache_key", ""))
			if is_enabled():
				return


func get_request_stats() -> Dictionary:
	var out: Dictionary = _stats.duplicate(true)
	out["cache_entries"] = _cache.size()
	out["inflight"] = _inflight.size()
	return out


func clear_prompt_cache() -> void:
	_cache.clear()


## 稳定排序的 JSON，避免 Dictionary 插入顺序变化破坏前缀和请求指纹。
func _canonicalize(value):
	if value is Dictionary:
		var out: Dictionary = {}
		var keys: Array = value.keys()
		keys.sort_custom(func(a, b): return str(a) < str(b))
		for key in keys:
			out[str(key)] = _canonicalize(value[key])
		return out
	if value is Array:
		var arr: Array = []
		for item in value:
			arr.append(_canonicalize(item))
		return arr
	return value


func _stable_json(value) -> String:
	return JSON.stringify(_canonicalize(value))


func _compact_history(history: Array, max_items: int = 12, max_chars: int = 6000) -> Array:
	var out: Array = []
	var start := maxi(0, history.size() - max_items)
	var used := 0
	for i in range(start, history.size()):
		var item = history[i]
		if not item is Dictionary:
			continue
		var content := str(item.get("content", ""))
		var remaining := maxi(0, max_chars - used)
		if remaining <= 0:
			break
		content = content.left(mini(1200, remaining))
		out.append({"role": str(item.get("role", "user")), "content": content})
		used += content.length()
	return out


func _cache_key(operation: String, payload, system_prefix: String = "") -> String:
	return "%s|%s|%s|%s" % [model, operation, system_prefix.md5_text(), _stable_json(payload).md5_text()]


func _cache_get(key: String):
	if not _cache.has(key):
		return null
	var entry: Dictionary = _cache[key]
	if int(entry.get("expires", 0)) <= Time.get_ticks_msec():
		_cache.erase(key)
		return null
	_stats["cache_hits"] += 1
	# Dictionary 保持插入顺序；命中后移到末尾，淘汰时即为 LRU。
	_cache.erase(key)
	_cache[key] = entry
	return entry.get("result", {}).duplicate(true)


func _cache_put(key: String, result: Dictionary, ttl: float) -> void:
	if key == "" or ttl <= 0.0 or not result.get("ok", false):
		return
	while _cache.size() >= cache_max_entries:
		_cache.erase(_cache.keys()[0])
	_cache[key] = {"expires": Time.get_ticks_msec() + int(ttl * 1000.0), "result": result.duplicate(true)}


func _request_json(system_prefix: String, dynamic_payload, max_tokens: int = 1400, operation: String = "", cache_ttl: float = 0.0) -> Dictionary:
	# 兼容旧的内部调用形式：_request_json(prompt, max_tokens)。
	if dynamic_payload is int and max_tokens == 1400:
		max_tokens = int(dynamic_payload)
		dynamic_payload = {}
	if not is_enabled():
		return {"ok": false, "error": "AI推演未连接，请在 config.json 配置 API Key。"}
	var key := _cache_key(operation, dynamic_payload, system_prefix) if operation != "" else ""
	var cached = _cache_get(key)
	if cached is Dictionary:
		return cached
	if key != "" and _inflight.has(key):
		_stats["dedupe_hits"] += 1
		while _inflight.has(key):
			await request_finished
		var deduped = _cache_get(key)
		return deduped if deduped is Dictionary else {"ok": false, "error": "重复请求未返回结果"}
	if key != "":
		_inflight[key] = true
	var result: Dictionary = await _perform_http(system_prefix, dynamic_payload, max_tokens, operation)
	_stats["requests"] += 1
	if result.get("ok", false):
		_stats["success"] += 1
	else:
		_stats["errors"] += 1
	# 状态推进调用也保留一秒结果，用于同帧/并发去重；纯读取调用使用完整 TTL。
	_cache_put(key, result, maxf(1.0, cache_ttl) if operation != "" else 0.0)
	if key != "":
		_inflight.erase(key)
		emit_signal("request_finished", key, result)
	return result


func _perform_http(system_prefix: String, dynamic_payload, max_tokens: int, operation: String) -> Dictionary:
	var user_content: String = str(dynamic_payload) if dynamic_payload is String else _stable_json(dynamic_payload)
	var body_data: Dictionary = {
		"model": model,
		"messages": [{"role": "system", "content": system_prefix}, {"role": "user", "content": user_content}],
		"temperature": 0.7,
		"max_tokens": max_tokens,
		"response_format": {"type": "json_object"},
	}
	if enable_remote_prompt_cache:
		body_data["prompt_cache_key"] = remote_prompt_cache_key if remote_prompt_cache_key != "" else (operation if operation != "" else "shanhe-yongzhu")
	var http := HTTPRequest.new()
	http.timeout = 60
	add_child(http)
	var headers := PackedStringArray(["Content-Type: application/json", "Authorization: Bearer " + api_key])
	var err := http.request(base_url.trim_suffix("/") + "/chat/completions", headers, HTTPClient.METHOD_POST, JSON.stringify(body_data))
	if err != OK:
		http.queue_free()
		return {"ok": false, "error": "AI请求发送失败（%s）" % err}
	var res: Array = await http.request_completed
	http.queue_free()
	if res[0] != HTTPRequest.RESULT_SUCCESS or int(res[1]) < 200 or int(res[1]) >= 300:
		return {"ok": false, "error": "AI推演服务无响应（HTTP %d）" % int(res[1])}
	var outer = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
	if not outer is Dictionary or not outer.has("choices") or outer["choices"].is_empty():
		return {"ok": false, "error": "AI返回格式异常"}
	var content := str(outer["choices"][0].get("message", {}).get("content", "")).strip_edges()
	if content.begins_with("```"):
		content = content.trim_prefix("```json").trim_prefix("```").trim_suffix("```").strip_edges()
	var data = JSON.parse_string(content)
	if not data is Dictionary:
		return {"ok": false, "error": "AI结果不是JSON对象"}
	var result: Dictionary = {"ok": true, "data": data}
	if outer.has("usage") and outer["usage"] is Dictionary:
		result["usage"] = outer["usage"].duplicate(true)
	return result


func _minister_prefix(m: Dictionary) -> String:
	return "这是一场明末历史模拟游戏中的君臣召对。玩家扮演1627年即位的明朝皇帝朱由检。你扮演大臣「%s」（%s，%s）。人物设定：%s。属性：治政%d 统率%d 智略%d 忠诚%d 野心%d。要求：始终以“臣”自称，用带文言色彩的半白话回答，结合输入朝局给出真实态度和建议，可以迎合、劝谏、隐瞒或推诿，但不得改变世界状态，不得提及游戏或 AI。" % [m.get("name", "?"), m.get("title", ""), m.get("faction", "中立"), m.get("persona", m.get("desc", "")), int(m.get("politics", 50)), int(m.get("command", 50)), int(m.get("wisdom", 50)), int(m.get("loyalty", 50)), int(m.get("ambition", 50))]


func _build_system_prompt(m: Dictionary) -> String:
	# 保留旧接口名称，调用方得到不含动态快照的稳定前缀。
	return _minister_prefix(m)


func chat_with_minister(minister: Dictionary, task: Dictionary, history: Array, snapshot: Dictionary, user_text: String) -> void:
	if not is_enabled():
		emit_signal("reply_ready", {"ok": false, "error": "AI推演未连接，请配置 config.json。"})
		return
	var payload := {"task": task, "court_context": {"date": snapshot.get("date", ""), "treasury": snapshot.get("treasury", 0), "avg_pop": snapshot.get("avg_pop", 0), "avg_morale": snapshot.get("avg_morale", 0), "court_stability": snapshot.get("court_stability", 0), "rebel_power": snapshot.get("rebel_power", 0), "jin_power": snapshot.get("jin_power", 0)}, "history": _compact_history(history), "user_text": user_text}
	var result := await _request_json(_minister_prefix(minister), payload, 600, "minister_chat_%s" % str(minister.get("id", "")), 0.0)
	emit_signal("reply_ready", result)


func _fallback_reply(m: Dictionary, user_text: String) -> String:
	var loyalty: float = m.get("loyalty", 50)
	var faction: String = m.get("faction", "中立")
	var by_loyalty: Array = ["陛下宵衣旰食，臣万死不辞。眼下之急，在足饷足兵，愿陛下垂察。", "臣愚见：事宜徐图，急则生变。伏乞陛下宽以时日。", "陛下圣谕，臣惶恐，此事干系重大，容臣从长计议。"]
	if loyalty >= 75:
		by_loyalty[1] = "民困则寇滋，宽一分则民受一分之赐。"
	if faction == "阉党":
		return "厂臣一切但凭陛下圣裁。宫里宫外，臣都替陛下看着呢。"
	return by_loyalty[randi() % by_loyalty.size()]


func simulate_edict(snapshot: Dictionary, month_log: Array, edict: String) -> void:
	if not is_enabled():
		emit_signal("edict_ready", {"ok": false, "fallback": true, "edict": edict})
		return
	var payload := {"snapshot": snapshot, "previous_events": month_log, "edict": edict if edict.strip_edges() != "" else "（本回合未下诏）"}
	var result := await _request_json(PREFIX_EDICT, payload, 800, "simulate_edict", 0.0)
	result["edict"] = edict
	emit_signal("edict_ready", result)


func generate_quarter_bulletins(snapshot: Dictionary, previous_tasks: Array, quarter_context: Dictionary) -> void:
	var payload := {"snapshot": snapshot, "previous_tasks": previous_tasks, "quarter_context": quarter_context}
	emit_signal("bulletin_ready", await _request_json(PREFIX_BULLETIN, payload, 1100, "quarter_bulletins", cache_ttl_seconds))


func run_court_debate(snapshot: Dictionary, task: Dictionary, ministers: Array, transcript: Array) -> void:
	var payload := {"task": task, "ministers": ministers, "transcript": _compact_history(transcript, 24, 10000), "snapshot": snapshot}
	emit_signal("debate_ready", await _request_json(PREFIX_DEBATE, payload, 1400, "court_debate", cache_ttl_seconds))


func derive_task_solution(snapshot: Dictionary, task: Dictionary, bulletins: Array, dialogues: Array, debates: Array) -> void:
	var payload := {"task": task, "bulletins": bulletins, "dialogues": dialogues, "debates": debates, "snapshot": snapshot}
	emit_signal("solution_ready", await _request_json(PREFIX_SOLUTION, payload, 1200, "task_solution", cache_ttl_seconds))


func draft_edict_from_dialogue(snapshot: Dictionary, task: Dictionary, transcript: Array) -> void:
	var payload := {"snapshot": snapshot, "task": task, "transcript": _compact_history(transcript, 24, 10000)}
	emit_signal("edict_draft_ready", await _request_json(PREFIX_EDICT_DRAFT, payload, 800, "edict_draft", cache_ttl_seconds))


func simulate_quarter(snapshot: Dictionary, previous_tasks: Array, quarter_inputs: Dictionary, edicts: Array, history: Array) -> void:
	var payload := {"quarter_start_snapshot": snapshot, "previous_tasks": previous_tasks, "quarter_inputs": quarter_inputs, "formal_edicts": edicts, "history": _compact_history(history, 24, 10000)}
	emit_signal("quarter_ready", await _request_json(PREFIX_QUARTER, payload, 2400, "simulate_quarter", 0.0))


func simulate_month(snapshot: Dictionary, actions: Array, edict: String) -> void:
	emit_signal("month_ready", {"ok": false, "error": "旧月度结算接口已停用，正式流程为季度 AI 推演"})


func resolve_battle(snapshot: Dictionary, intent: Dictionary) -> void:
	emit_signal("battle_ready", await _request_json(PREFIX_BATTLE, {"snapshot": snapshot, "intent": intent}, 900, "resolve_battle", 0.0))


func resolve_event_choice(snapshot: Dictionary, event: Dictionary, choice: Dictionary) -> void:
	emit_signal("event_ready", await _request_json(PREFIX_EVENT, {"snapshot": snapshot, "event": event, "choice": choice}, 1000, "resolve_event", 0.0))


func evaluate_game_end(snapshot: Dictionary) -> void:
	emit_signal("end_ready", await _request_json(PREFIX_END, {"snapshot": snapshot}, 500, "evaluate_end", cache_ttl_seconds))


func validate_state(before: Dictionary, proposed: Dictionary) -> void:
	emit_signal("validation_ready", await _request_json(PREFIX_VALIDATE, {"before": before, "proposed": proposed}, 700, "validate_state", cache_ttl_seconds))
