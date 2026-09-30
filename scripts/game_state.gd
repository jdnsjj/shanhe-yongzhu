extends Node
## 山河永驻 —— 核心游戏状态与模拟引擎（自动加载单例）
## 民心（名声）与军心按省份单独计算；全国数值为加权平均，仅用于显示与终局评定。

signal state_changed
signal event_raised(ev: Dictionary)
signal history_added(text: String)
signal game_over(victory: bool, reason: String)
signal toast(text: String)
signal ai_status(text: String)
signal ai_failed(text: String)
signal month_report(report: Dictionary)
signal quarter_report(report: Dictionary)
signal event_result(result: Dictionary)
signal bulletin_ready(result: Dictionary)
signal solution_ready(result: Dictionary)
signal debate_ready(result: Dictionary)

const SAVE_PATH := "user://save.json"
const SAVE_VERSION := 5
const START_YEAR := 1627
const START_MONTH := 1
const START_DAY := 1
const END_YEAR := 1644
const END_MONTH := 12
const MAX_ACTIONS := 3
const STAGE_MORNING_COURT := "morning_court"
const STAGE_BULLETIN_REVIEW := "bulletin_review"
const STAGE_PRIVATE_AUDIENCE := "private_audience"
const STAGE_COURT_DEBATE := "court_debate"
const STAGE_SOLUTION_REVIEW := "solution_review"
const STAGE_EDICT_DRAFTING := "edict_drafting"
const STAGE_QUARTER_FINAL_EDICT := "quarter_final_edict"
const STAGE_QUARTER_SETTLEMENT := "quarter_settlement"
const STAGE_QUARTER_REPORT := "quarter_report"

const POSITIONS := {
	"shoufu": {"name": "内阁首辅", "stat": "politics", "desc": "执掌票拟：每季度朝堂稳定随其治政提升"},
	"hubu": {"name": "户部尚书", "stat": "politics", "desc": "执掌天下钱粮：税收随其治政提升"},
	"bingshi": {"name": "兵部尚书", "stat": "command", "desc": "执掌兵马：每季度各镇军心随其统率提升"},
	"lijun": {"name": "吏部尚书", "stat": "wisdom", "desc": "执掌铨选：每季度百官忠诚小幅回升"},
	"gongbu": {"name": "工部尚书", "stat": "politics", "desc": "执掌营造：每隔数月修缮一处城防"},
	"xingbu": {"name": "刑部尚书", "stat": "wisdom", "desc": "执掌刑名：每季度朝堂稳定小幅回升"},
}

const FACTION_COLORS := {
	"阉党": Color(0.62, 0.30, 0.22),
	"东林": Color(0.24, 0.42, 0.58),
	"浙党": Color(0.50, 0.44, 0.20),
	"帝党": Color(0.30, 0.52, 0.36),
	"中立": Color(0.45, 0.45, 0.45),
}

const POLICIES := {
	"jianmian": {"name": "轻徭薄赋", "cost": 0, "target": "", "desc": "通行全国：蠲免逋赋，各省民心+3；三月内税收-30%"},
	"jiazheng": {"name": "加派赋税", "cost": 0, "target": "", "desc": "通行全国：加征三饷，得银80万两；各省民心-4"},
	"zhenji": {"name": "开仓赈灾", "cost": 50, "target": "prov", "desc": "择一省施行的：该省民心+15"},
	"lianbing": {"name": "整饬军务", "cost": 40, "target": "prov", "desc": "择一镇施行的：该省兵力+20%（上限30万），军心+15"},
	"xiulv": {"name": "修缮城防", "cost": 40, "target": "prov", "desc": "择一省施行的：该省城防+1（上限6）"},
	"keju": {"name": "开科取士", "cost": 30, "target": "", "desc": "广纳贤才：从在野人才中擢用一位大臣"},
	"zhaofu": {"name": "招抚流民", "cost": 35, "target": "prov", "desc": "择一省施行的：该省民心+10，流寇势力-5"},
}

# ---------- 状态 ----------
var year: int = START_YEAR
var month: int = START_MONTH
var day: int = START_DAY
var quarter: int = 1
var quarter_day: int = 1
var treasury: float = 120.0
var court_stability: float = 50.0
var rebel_power: float = 20.0
var jin_power: float = 45.0
var actions_left: int = MAX_ACTIONS
var game_ended: bool = false
var victory: bool = false

var provinces: Array = []
var province_by_id: Dictionary = {}
var ministers: Array = []
var pool: Array = []
var appointments: Dictionary = {}   # pos_id -> minister_id
var fired_once: Array = []
var tax_cut_months: int = 0
var history: Array = []
var pending_actions: Array = []
var current_quarter_bulletins: Array = []
var current_quarter_dialogues: Array = []
var current_quarter_debates: Array = []
var current_quarter_decisions: Array = []
var quarter_edicts: Array = []
var quarter_summaries: Array = []
var quarter_reports: Array = []
var political_tasks: Array = []
var quarter_task_snapshot: Array = []
var stage: String = STAGE_MORNING_COURT
var simulation_in_flight: bool = false
var bulletin_in_flight: bool = false
var last_ai_result: Dictionary = {}
var last_ai_validation: Dictionary = {}
var ai_error: String = ""
var ai_request_id: int = 0
var rng := RandomNumberGenerator.new()
var booted := false


func _ready() -> void:
	rng.randomize()
	new_game()


# ---------- 初始化 ----------
func new_game() -> void:
	year = START_YEAR
	month = START_MONTH
	day = START_DAY
	quarter = 1
	quarter_day = 1
	treasury = 120.0
	court_stability = 50.0
	rebel_power = 20.0
	jin_power = 45.0
	actions_left = MAX_ACTIONS
	game_ended = false
	victory = false
	appointments = {}
	fired_once = []
	tax_cut_months = 0
	history = []
	pending_actions = []
	current_quarter_bulletins = []
	current_quarter_dialogues = []
	current_quarter_debates = []
	current_quarter_decisions = []
	quarter_edicts = []
	quarter_summaries = []
	quarter_reports = []
	political_tasks = [_initial_political_task()]
	quarter_task_snapshot = political_tasks.duplicate(true)
	stage = STAGE_MORNING_COURT
	simulation_in_flight = false
	bulletin_in_flight = false
	last_ai_result = {}
	last_ai_validation = {}
	ai_error = ""
	ai_request_id = 0
	booted = false

	provinces = _load_json("res://data/provinces.json")
	if provinces == null:
		provinces = []
	province_by_id = {}
	for p in provinces:
		_backfill_province(p)
		province_by_id[p["id"]] = p

	ministers = []
	pool = []
	var mdata = _load_json("res://data/ministers.json")
	if mdata is Dictionary:
		for m in mdata.get("court", []):
			ministers.append(m.duplicate(true))
		for m in mdata.get("pool", []):
			pool.append(m.duplicate(true))

	var court := living_ministers()
	if court.size() > 0:
		appointments["shoufu"] = court[0]["id"]
		appointments["hubu"] = _best_of("politics")["id"]
		appointments["bingshi"] = _best_of("command")["id"]

	add_history("天启帝驾崩，信王朱由检入继大统，改元崇祯。新帝初登大宝，内有阉党余势，外有边患与流民。")
	add_history("本季度时政任务：先定继位之局，再寻可行之策。凡决策须经召对或朝会，提交后交由 AI 推演。")
	emit_signal("state_changed")


func _initial_political_task() -> Dictionary:
	return {
		"id": "succession_crisis",
		"title": "新帝继位与朝局定鼎",
		"description": "天启帝驾崩，崇祯帝初即大位。魏忠贤及阉党余势未清，百官观望，需先稳定朝局并确立新政方向。",
		"origin": "天启帝驾崩、崇祯帝继位",
		"parent_task_id": "",
		"continuation_reason": "开局根任务",
		"status": "active",
		"priority": "critical",
		"created_quarter": quarter_key(),
		"updated_quarter": quarter_key(),
		"progress": 0,
		"obstacles": ["阉党余势", "百官观望", "钱粮军务积弊"],
		"required_dialogue": true,
		"evidence_refs": [],
		"solution_candidates": [],
		"selected_solution_id": "",
		"continuation": "需经大臣召对或朝会，形成可执行方案。",
		"completion_reason": "",
	}


func quarter_key() -> String:
	return "%04d-Q%d" % [year, quarter]


func is_quarter_end() -> bool:
	# 现在按季度离散推进，不再模拟季度内的 90 个日回合。
	return true


func quarter_progress_text() -> String:
	return "%s · 本季度" % quarter_key()


func _advance_quarter() -> void:
	quarter += 1
	if quarter > 4:
		quarter = 1
		year += 1
	month = (quarter - 1) * 3 + 1
	day = 1
	quarter_day = 1


func active_tasks() -> Array:
	return political_tasks.filter(func(task): return task.get("status", "active") == "active")


func task_by_id(task_id: String) -> Dictionary:
	for task in political_tasks:
		if str(task.get("id", "")) == task_id:
			return task
	return {}


## 旧档/缺省字段回填
func _backfill_province(p: Dictionary) -> void:
	if not p.has("morale"):
		p["morale"] = 55.0
	if not p.has("pop"):
		p["pop"] = 50.0
	if not p.has("fort"):
		p["fort"] = 2
	if not p.has("map_name"):
		p["map_name"] = p.get("name", "")


func _normalize_loaded_provinces(raw: Array) -> Array:
	# 旧版存档曾把甘肃、辽东作为普通省份；迁移到严格的两京十三司模型。
	var normalized: Array = []
	var shaanxi: Dictionary = {}
	for item in raw:
		if not item is Dictionary:
			continue
		var pid := str(item.get("id", ""))
		if pid == "liaodong":
			continue # 辽东都司现在由外部边防层绘制。
		if pid == "gansu":
			shaanxi = item
			continue
		normalized.append(item)
	for item in normalized:
		if str(item.get("id", "")) == "shaanxi":
			if not shaanxi.is_empty():
				item["tax"] = float(item.get("tax", 0)) + float(shaanxi.get("tax", 0))
				item["garrison"] = float(item.get("garrison", 0)) + float(shaanxi.get("garrison", 0))
				item["pop"] = (float(item.get("pop", 0)) + float(shaanxi.get("pop", 0))) * 0.5
				item["morale"] = (float(item.get("morale", 0)) + float(shaanxi.get("morale", 0))) * 0.5
				item["historical_scope"] = "陕西布政使司（含甘肃、宁夏等边镇）"
			break
	return normalized


func _best_of(stat: String) -> Dictionary:
	var sorted := living_ministers().duplicate()
	sorted.sort_custom(func(a, b): return a[stat] > b[stat])
	return sorted[0] if sorted.size() > 0 else {}


func _load_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		push_warning("缺少数据文件: " + path)
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	return JSON.parse_string(f.get_as_text())


# ---------- 查询 ----------
func living_ministers() -> Array:
	return ministers


func minister(id: String) -> Dictionary:
	for m in ministers:
		if m["id"] == id:
			return m
	return {}


func date_text() -> String:
	return "崇祯%d年 · 第%d季度" % [year - 1626, quarter]


func ming_provinces() -> Array:
	return provinces.filter(func(p): return p["owner"] == "ming")


## 全国平均民心（按税基加权）
func avg_pop() -> float:
	var mp := ming_provinces()
	if mp.is_empty():
		return 0.0
	var wsum := 0.0
	var s := 0.0
	for p in mp:
		var w: float = maxf(p["tax"], 1.0)
		wsum += w
		s += p["pop"] * w
	return s / wsum


## 全国平均军心（按兵力加权）
func avg_morale() -> float:
	var mp := ming_provinces()
	if mp.is_empty():
		return 0.0
	var wsum := 0.0
	var s := 0.0
	for p in mp:
		var w: float = maxf(p["garrison"], 1.0)
		wsum += w
		s += p["morale"] * w
	return s / wsum


func position_of(mid: String) -> String:
	for pos in appointments:
		if appointments[pos] == mid:
			return pos
	return ""


func record_minister_dialogue(task_id: String, minister_id: String, messages: Array, summary: String = "") -> Dictionary:
	if simulation_in_flight:
		return {"ok": false, "error": "季度推演进行中"}
	var task := task_by_id(task_id)
	if task.is_empty() or task.get("status", "") != "active":
		return {"ok": false, "error": "时政任务不存在或已结束"}
	if minister(minister_id).is_empty():
		return {"ok": false, "error": "大臣不存在"}
	var dialogue_id := "dialogue_%s_%03d" % [quarter_key(), current_quarter_dialogues.size() + 1]
	var record := {"id": dialogue_id, "quarter": quarter_key(), "task_id": task_id, "minister_id": minister_id, "messages": messages.duplicate(true), "summary": summary, "date": date_text()}
	current_quarter_dialogues.append(record)
	task["evidence_refs"].append(dialogue_id)
	stage = STAGE_PRIVATE_AUDIENCE
	add_history("【召对】%s围绕「%s」提出见解。" % [minister(minister_id).get("name", minister_id), task.get("title", task_id)])
	emit_signal("state_changed")
	return {"ok": true, "id": dialogue_id}


func record_court_debate(task_id: String, minister_ids: Array, transcript: Array, summary: String = "", solution_candidates: Array = []) -> Dictionary:
	if simulation_in_flight:
		return {"ok": false, "error": "季度推演进行中"}
	var task := task_by_id(task_id)
	if task.is_empty() or task.get("status", "") != "active":
		return {"ok": false, "error": "时政任务不存在或已结束"}
	if minister_ids.size() < 2:
		return {"ok": false, "error": "朝会至少需要两名大臣"}
	for mid in minister_ids:
		if minister(str(mid)).is_empty():
			return {"ok": false, "error": "朝会包含不存在的大臣"}
	var debate_id := "debate_%s_%03d" % [quarter_key(), current_quarter_debates.size() + 1]
	var record := {"id": debate_id, "quarter": quarter_key(), "task_id": task_id, "minister_ids": minister_ids.duplicate(), "transcript": transcript.duplicate(true), "summary": summary, "solution_candidates": solution_candidates.duplicate(true), "date": date_text()}
	current_quarter_debates.append(record)
	task["evidence_refs"].append(debate_id)
	task["solution_candidates"].append_array(solution_candidates.duplicate(true))
	stage = STAGE_COURT_DEBATE
	add_history("【朝会】群臣围绕「%s」议定一番。" % task.get("title", task_id))
	emit_signal("state_changed")
	return {"ok": true, "id": debate_id}


func has_task_dialogue(task_id: String) -> bool:
	for record in current_quarter_dialogues:
		if str(record.get("task_id", "")) == task_id:
			return true
	for record in current_quarter_debates:
		if str(record.get("task_id", "")) == task_id:
			return true
	return false


func accept_task_solution(task_id: String, solution: Dictionary) -> Dictionary:
	if simulation_in_flight:
		return {"ok": false, "error": "季度推演进行中"}
	var task := task_by_id(task_id)
	if task.is_empty() or task.get("status", "") != "active":
		return {"ok": false, "error": "时政任务不存在或已结束"}
	if not has_task_dialogue(task_id):
		return {"ok": false, "error": "必须先通过召对或朝会形成对话证据"}
	var solution_id := str(solution.get("id", ""))
	if solution_id == "":
		solution_id = "solution_%s_%03d" % [quarter_key(), current_quarter_decisions.size() + 1]
	var record := solution.duplicate(true)
	record["id"] = solution_id
	record["task_id"] = task_id
	record["quarter"] = quarter_key()
	record["accepted"] = true
	record["accepted_date"] = date_text()
	current_quarter_decisions.append(record)
	task["selected_solution_id"] = solution_id
	task["solution_candidates"].append(record)
	stage = STAGE_SOLUTION_REVIEW
	add_history("【决策】朕已采纳「%s」之策，候拟圣旨。" % str(record.get("title", record.get("summary", ""))))
	emit_signal("state_changed")
	return {"ok": true, "solution": record}


func issue_edict(text: String, task_ids: Array, solution_id: String = "", source_dialogue_ids: Array = [], source_debate_id: String = "", is_settlement_edict: bool = false) -> Dictionary:
	if simulation_in_flight:
		return {"ok": false, "error": "季度推演进行中"}
	if not LLMClient.is_enabled():
		return {"ok": false, "error": "AI推演未连接，不能颁布正式圣旨"}
	var body := text.strip_edges()
	if body == "":
		return {"ok": false, "error": "圣旨正文不可为空"}
	if not is_settlement_edict and task_ids.is_empty():
		return {"ok": false, "error": "任务圣旨必须关联时政任务"}
	if not is_settlement_edict:
		for task_id in task_ids:
			var task := task_by_id(str(task_id))
			if task.is_empty() or task.get("status", "") != "active":
				return {"ok": false, "error": "圣旨关联了不存在或已结束的任务"}
			if not has_task_dialogue(str(task_id)):
				return {"ok": false, "error": "任务必须先经过召对或朝会"}
			if solution_id == "" or str(task.get("selected_solution_id", "")) != solution_id:
				return {"ok": false, "error": "圣旨必须来自已采纳的解决方案"}
	var edict_id := "edict_%s_%03d" % [quarter_key(), quarter_edicts.size() + 1]
	var record := {"edict_id": edict_id, "quarter": quarter_key(), "date_order": quarter_edicts.size() + 1, "date": date_text(), "text": body, "task_ids": task_ids.duplicate(), "solution_id": solution_id, "source_dialogue_ids": source_dialogue_ids.duplicate(), "source_debate_id": source_debate_id, "is_settlement_edict": is_settlement_edict, "status": "issued"}
	quarter_edicts.append(record)
	stage = STAGE_EDICT_DRAFTING if not is_settlement_edict else STAGE_QUARTER_FINAL_EDICT
	add_history("【圣旨】%s" % body)
	emit_signal("state_changed")
	return {"ok": true, "edict": record}


func spend_action() -> bool:
	if actions_left <= 0:
		return false
	actions_left -= 1
	return true


func use_policy(pid: String, prov_id := "") -> String:
	if simulation_in_flight:
		return "本季度推演尚未完成"
	if not POLICIES.has(pid):
		return "无此方略"
	var pol: Dictionary = POLICIES[pid]
	var cost: float = pol["cost"]
	if actions_left <= 0:
		return "本季度行动机会已用尽"
	if cost > 0 and treasury < cost:
		return "国库存银不足（需 %d 万两）" % int(cost)
	var prov: Dictionary = {}
	if pol["target"] == "prov":
		prov = province_by_id.get(prov_id, {})
		if prov.is_empty() or prov["owner"] != "ming":
			return "请先选择施行省份"
	# 行动点先冻结为玩家意图；费用与实际世界效果由 AI 季度推演决定。
	actions_left -= 1
	pending_actions.append({"type": "policy", "id": pid, "province_id": prov_id, "cost": cost})
	add_history("【诏议】拟行方略：%s%s" % [pol["name"], ("（" + prov["name"] + "）") if not prov.is_empty() else ""])
	emit_signal("state_changed")
	return "已记入本季度政务，提交后交由 AI 推演实际成效。"


func recruit() -> Dictionary:
	if pool.size() == 0:
		return {}
	var idx := rng.randi_range(0, pool.size() - 1)
	var m: Dictionary = pool[idx]
	pool.remove_at(idx)
	ministers.append(m)
	return m


func appoint(pos: String, mid: String) -> void:
	if simulation_in_flight or not POSITIONS.has(pos) or minister(mid).is_empty():
		return
	if actions_left <= 0:
		return
	actions_left -= 1
	pending_actions.append({"type": "appoint", "position": pos, "minister_id": mid})
	add_history("【诏议】拟任%s出任%s，待 AI 推演本季度朝局。" % [minister(mid).get("name", "?"), POSITIONS[pos]["name"]])
	emit_signal("state_changed")


func dismiss(pos: String) -> void:
	if simulation_in_flight or not appointments.has(pos) or actions_left <= 0:
		return
	actions_left -= 1
	pending_actions.append({"type": "dismiss", "position": pos, "minister_id": appointments[pos]})
	add_history("【诏议】拟罢%s，待 AI 推演本季度朝局。" % POSITIONS.get(pos, {}).get("name", pos))
	emit_signal("state_changed")


# ---------- 战争意图（胜负与损失交给 AI） ----------
func can_dispatch_from(src: Dictionary, target: Dictionary) -> bool:
	return src["owner"] == "ming" and target["owner"] != "ming" \
		and src["adj"].has(target["id"]) and src["garrison"] >= 5


func dispatch(src_id: String, tgt_id: String, troops: int, general_id: String) -> Dictionary:
	var src: Dictionary = province_by_id.get(src_id, {})
	var tgt: Dictionary = province_by_id.get(tgt_id, {})
	if simulation_in_flight:
		return {"ok": false, "msg": "本季度推演尚未完成"}
	if src.is_empty() or tgt.is_empty() or not can_dispatch_from(src, tgt):
		return {"ok": false, "msg": "只能从我方相邻省份向敌占城池出兵"}
	if troops < 3 or troops > int(src["garrison"]) - 2:
		return {"ok": false, "msg": "兵力须在 3 至 %d 万之间（需留 2 万守土）" % (int(src["garrison"]) - 2)}
	if actions_left <= 0:
		return {"ok": false, "msg": "本季度行动机会已用尽"}
	actions_left -= 1
	pending_actions.append({"type": "battle", "source": src_id, "target": tgt_id, "troops": troops, "general_id": general_id})
	add_history("【军议】拟自%s出兵%s，胜负待 AI 推演。" % [src["name"], tgt["name"]])
	emit_signal("state_changed")
	return {"ok": true, "msg": "出兵意图已记入，提交后由 AI 推演战果。"}


func move_troops(src_id: String, tgt_id: String, troops: int) -> Dictionary:
	var src: Dictionary = province_by_id.get(src_id, {})
	var tgt: Dictionary = province_by_id.get(tgt_id, {})
	if simulation_in_flight:
		return {"ok": false, "msg": "本季度推演尚未完成"}
	if src.is_empty() or tgt.is_empty() or src["owner"] != "ming" or tgt["owner"] != "ming":
		return {"ok": false, "msg": "只能在我方省份之间调兵"}
	if not src["adj"].has(tgt_id):
		return {"ok": false, "msg": "两地不相邻"}
	if troops < 1 or troops > int(src["garrison"]) - 2:
		return {"ok": false, "msg": "兵力须在 1 至 %d 万之间（需留 2 万守土）" % (int(src["garrison"]) - 2)}
	if actions_left <= 0:
		return {"ok": false, "msg": "本季度行动机会已用尽"}
	actions_left -= 1
	pending_actions.append({"type": "move_troops", "source": src_id, "target": tgt_id, "troops": troops})
	add_history("【军议】拟调%d万兵自%s移驻%s，后果待 AI 推演。" % [troops, src["name"], tgt["name"]])
	emit_signal("state_changed")
	return {"ok": true, "msg": "调防意图已记入，提交后由 AI 推演后果。"}


# ---------- AI 季度事务 ----------
func request_quarter_bulletins() -> Dictionary:
	if game_ended:
		return {"ok": false, "error": "本局已经结束"}
	if simulation_in_flight or bulletin_in_flight:
		return {"ok": false, "error": "AI 请求正在进行"}
	if not LLMClient.is_enabled():
		return {"ok": false, "error": "AI推演未连接，不能生成重要奏折"}
	bulletin_in_flight = true
	stage = STAGE_BULLETIN_REVIEW
	LLMClient.bulletin_ready.connect(func(result: Dictionary):
		bulletin_in_flight = false
		if result.get("ok", false):
			var data: Dictionary = result.get("data", {})
			if not data.get("bulletins", []) is Array:
				emit_signal("bulletin_ready", {"ok": false, "error": "奏折结果格式非法"})
			else:
				current_quarter_bulletins = data.get("bulletins", [])
				emit_signal("bulletin_ready", {"ok": true, "bulletins": current_quarter_bulletins})
		else:
			emit_signal("bulletin_ready", {"ok": false, "error": str(result.get("error", "奏折生成失败"))})
		emit_signal("state_changed"), CONNECT_ONE_SHOT)
	LLMClient.generate_quarter_bulletins(state_snapshot(), quarter_task_snapshot.duplicate(true), {"quarter": quarter_key(), "stage": stage})
	return {"ok": true, "pending": true}


func settle_quarter(final_edict_text: String = "") -> Dictionary:
	if game_ended:
		return {"ok": false, "msg": "本局已经结束"}
	if simulation_in_flight:
		return {"ok": false, "msg": "季度推演正在进行"}
	if not LLMClient.is_enabled():
		ai_error = "AI推演未连接，请配置 config.json 后才能结算季度。"
		emit_signal("ai_failed", ai_error)
		emit_signal("toast", ai_error)
		return {"ok": false, "msg": ai_error}
	if final_edict_text.strip_edges() != "":
		var issued := issue_edict(final_edict_text, [], "", [], "", true)
		if not issued.get("ok", false):
			return issued
	simulation_in_flight = true
	stage = STAGE_QUARTER_SETTLEMENT
	ai_error = ""
	ai_request_id += 1
	var request_id := ai_request_id
	var before := _capture_transaction_state()
	quarter_task_snapshot = political_tasks.duplicate(true)
	emit_signal("ai_status", "AI 正在依据本季度任务、政务行动与全部圣旨推演国势……")
	LLMClient.quarter_ready.connect(func(result: Dictionary):
		if request_id != ai_request_id:
			return
		_finish_quarter_simulation(result, before, request_id), CONNECT_ONE_SHOT)
	LLMClient.simulate_quarter(state_snapshot(), quarter_task_snapshot.duplicate(true), {
		"bulletins": current_quarter_bulletins.duplicate(true),
		"dialogues": current_quarter_dialogues.duplicate(true),
		"debates": current_quarter_debates.duplicate(true),
		"decisions": current_quarter_decisions.duplicate(true),
		"pending_actions": pending_actions.duplicate(true),
		"summaries": quarter_summaries.duplicate(true),
	}, quarter_edicts.duplicate(true), recent_history(24))
	return {"ok": true, "pending": true, "msg": "季度 AI 推演已开始"}


func _capture_transaction_state() -> Dictionary:
	return {
		"year": year, "month": month, "day": day, "quarter": quarter, "quarter_day": quarter_day,
		"treasury": treasury, "court_stability": court_stability, "rebel_power": rebel_power, "jin_power": jin_power,
		"actions_left": actions_left,
		"provinces": provinces.duplicate(true), "ministers": ministers.duplicate(true), "pool": pool.duplicate(true),
		"appointments": appointments.duplicate(true), "political_tasks": political_tasks.duplicate(true),
		"quarter_edicts": quarter_edicts.duplicate(true), "current_quarter_bulletins": current_quarter_bulletins.duplicate(true),
		"current_quarter_dialogues": current_quarter_dialogues.duplicate(true), "current_quarter_debates": current_quarter_debates.duplicate(true),
		"current_quarter_decisions": current_quarter_decisions.duplicate(true), "quarter_summaries": quarter_summaries.duplicate(true),
		"quarter_reports": quarter_reports.duplicate(true), "history": history.duplicate(true),
		"pending_actions": pending_actions.duplicate(true), "stage": stage,
		"last_ai_result": last_ai_result.duplicate(true), "last_ai_validation": last_ai_validation.duplicate(true),
		"ai_error": ai_error,
	}


func _restore_transaction_state(snapshot: Dictionary) -> void:
	year = int(snapshot["year"]); month = int(snapshot["month"]); day = int(snapshot["day"])
	quarter = int(snapshot["quarter"]); quarter_day = int(snapshot["quarter_day"])
	treasury = float(snapshot["treasury"]); court_stability = float(snapshot["court_stability"])
	rebel_power = float(snapshot["rebel_power"]); jin_power = float(snapshot["jin_power"])
	actions_left = int(snapshot["actions_left"])
	provinces = snapshot["provinces"].duplicate(true); province_by_id = {}
	for p in provinces:
		province_by_id[p["id"]] = p
	ministers = snapshot["ministers"].duplicate(true); pool = snapshot["pool"].duplicate(true)
	appointments = snapshot["appointments"].duplicate(true); political_tasks = snapshot["political_tasks"].duplicate(true)
	quarter_edicts = snapshot["quarter_edicts"].duplicate(true)
	current_quarter_bulletins = snapshot["current_quarter_bulletins"].duplicate(true)
	current_quarter_dialogues = snapshot["current_quarter_dialogues"].duplicate(true)
	current_quarter_debates = snapshot["current_quarter_debates"].duplicate(true)
	current_quarter_decisions = snapshot["current_quarter_decisions"].duplicate(true)
	quarter_summaries = snapshot["quarter_summaries"].duplicate(true)
	quarter_reports = snapshot["quarter_reports"].duplicate(true); history = snapshot["history"].duplicate(true)
	pending_actions = snapshot["pending_actions"].duplicate(true); stage = str(snapshot["stage"])
	last_ai_result = snapshot["last_ai_result"].duplicate(true); last_ai_validation = snapshot["last_ai_validation"].duplicate(true)
	ai_error = str(snapshot["ai_error"])


func _finish_quarter_simulation(result: Dictionary, before: Dictionary, request_id: int) -> void:
	if not simulation_in_flight or request_id != ai_request_id:
		return
	if not result.get("ok", false):
		_restore_transaction_state(before)
		_simulation_failed(str(result.get("error", "季度 AI 推演失败")))
		return
	var data: Dictionary = result.get("data", {})
	var treasury_result: Dictionary = data.get("treasury", {})
	if treasury_result.has("delta"):
		data["effects"] = data.get("effects", [])
		data["effects"].append({"target": "global", "field": "treasury", "delta": treasury_result.get("delta", 0), "reason": "AI季度财政结算"})
	var checked := validate_quarter_result(data)
	if not checked.get("ok", false):
		_restore_transaction_state(before)
		_simulation_failed(str(checked.get("error", "季度结果校验失败")))
		return
	emit_signal("ai_status", "季度结果已返回，正在执行语义校验……")
	LLMClient.validation_ready.connect(func(validation_result: Dictionary):
		if request_id != ai_request_id:
			return
		if not validation_result.get("ok", false):
			_restore_transaction_state(before)
			_simulation_failed(str(validation_result.get("error", "AI语义校验请求失败")))
			return
		var validation: Dictionary = validation_result.get("data", {})
		if int(validation.get("schema_version", 0)) != 1 or not bool(validation.get("ok", false)):
			_restore_transaction_state(before)
			_simulation_failed("AI语义校验未通过")
			return
		_commit_quarter_simulation(data, validation, before), CONNECT_ONE_SHOT)
	LLMClient.validate_state(state_snapshot(), data)


func validate_quarter_result(data: Dictionary) -> Dictionary:
	if int(data.get("schema_version", 0)) != 1:
		return {"ok": false, "error": "季度 AI 协议版本不支持"}
	for key in ["effects", "events", "battles", "task_updates", "next_quarter_tasks"]:
		if not data.get(key, []) is Array:
			return {"ok": false, "error": "季度结果缺少数组：" + key}
	if data["effects"].size() > 120 or data["events"].size() > 12 or data["battles"].size() > 20 or data["task_updates"].size() > 30:
		return {"ok": false, "error": "季度结果数量超出安全上限"}
	var known_edicts := {}
	for edict in quarter_edicts:
		known_edicts[str(edict.get("edict_id", ""))] = true
	for update in data["task_updates"]:
		if not update is Dictionary:
			return {"ok": false, "error": "任务更新格式非法"}
		var task_id := str(update.get("task_id", ""))
		if task_by_id(task_id).is_empty():
			return {"ok": false, "error": "AI引用了不存在的时政任务"}
		if not ["completed", "active", "failed", "superseded"].has(str(update.get("status", ""))):
			return {"ok": false, "error": "AI返回了未知任务状态"}
		for ref in update.get("edict_refs", []):
			if not known_edicts.has(str(ref)):
				return {"ok": false, "error": "任务引用了不存在的圣旨"}
	return validate_ai_result(data)


func _commit_quarter_simulation(data: Dictionary, validation: Dictionary, before: Dictionary) -> void:
	var applied := apply_ai_transition(data)
	if not applied.get("ok", false):
		_restore_transaction_state(before)
		_simulation_failed(str(applied.get("error", "季度效果应用失败")))
		return
	_apply_task_updates(data.get("task_updates", []), data.get("next_quarter_tasks", []))
	last_ai_result = data.duplicate(true)
	last_ai_result["before_snapshot"] = before
	last_ai_validation = validation.duplicate(true)
	var report := {"quarter": quarter_key(), "narrative": data.get("narrative", ""), "quarter_summary": data.get("quarter_summary", ""), "treasury": data.get("treasury", {}), "events": data.get("events", []), "battles": data.get("battles", []), "task_updates": data.get("task_updates", []), "edicts": quarter_edicts.duplicate(true), "validation": validation.duplicate(true), "end_evaluation": data.get("end_evaluation", {})}
	quarter_reports.append(report)
	quarter_summaries.append(str(data.get("quarter_summary", data.get("narrative", ""))))
	add_history("【%s季度结算】%s" % [quarter_key(), str(data.get("narrative", "季度局势按 AI 推演而变。"))])
	_advance_quarter()
	actions_left = MAX_ACTIONS
	pending_actions = []
	current_quarter_bulletins = []
	current_quarter_dialogues = []
	current_quarter_debates = []
	current_quarter_decisions = []
	quarter_edicts = []
	quarter_task_snapshot = political_tasks.duplicate(true)
	stage = STAGE_MORNING_COURT
	simulation_in_flight = false
	save_game()
	emit_signal("quarter_report", report)
	emit_signal("ai_status", "季度推演已校验并落库")
	emit_signal("state_changed")
	var end_eval: Dictionary = data.get("end_evaluation", {})
	if end_eval.get("status", "ongoing") != "ongoing":
		_end(end_eval.get("status") == "victory", str(end_eval.get("reason", "AI 判定国运已尽。")))


func _apply_task_updates(updates: Array, next_tasks: Array) -> void:
	for update in updates:
		var task := task_by_id(str(update.get("task_id", "")))
		if task.is_empty():
			continue
		task["status"] = str(update.get("status", task.get("status", "active")))
		task["progress"] = update.get("progress", task.get("progress", 0))
		task["updated_quarter"] = quarter_key()
		task["completion_reason"] = str(update.get("resolution", update.get("completion_reason", "")))
		task["continuation"] = str(update.get("continuation", task.get("continuation", "")))
		task["next_objective"] = str(update.get("next_objective", task.get("next_objective", "")))
		task["obstacles"] = update.get("obstacles", task.get("obstacles", []))
	for task_data in next_tasks:
		if not task_data is Dictionary:
			continue
		var next_id := str(task_data.get("id", ""))
		if next_id == "" or not task_by_id(next_id).is_empty():
			continue
		var created: Dictionary = task_data.duplicate(true)
		created["status"] = str(created.get("status", "active"))
		created["created_quarter"] = quarter_key()
		created["updated_quarter"] = quarter_key()
		political_tasks.append(created)


func _simulation_failed(reason: String) -> void:
	simulation_in_flight = false
	ai_error = reason
	last_ai_validation = {"ok": false, "error": reason}
	emit_signal("ai_failed", reason)
	emit_signal("ai_status", "AI 推演失败，当前回合未推进")
	emit_signal("toast", "推演失败：" + reason)
	emit_signal("state_changed")


func validate_ai_result(data: Dictionary) -> Dictionary:
	if int(data.get("schema_version", 0)) != 1:
		return {"ok": false, "error": "AI协议版本不支持"}
	if not data.get("effects", []) is Array or not data.get("events", []) is Array or not data.get("battles", []) is Array:
		return {"ok": false, "error": "AI结果缺少结构化数组"}
	if data.get("validation", {}).get("ok", true) == false:
		return {"ok": false, "error": "AI语义校验未通过"}
	if data["effects"].size() > 80 or data["events"].size() > 8 or data["battles"].size() > 12:
		return {"ok": false, "error": "AI结果数量超出安全上限"}
	for event in data["events"]:
		if not event is Dictionary:
			return {"ok": false, "error": "季度事件格式非法"}
		if str(event.get("id", "")).strip_edges() == "" or str(event.get("narrative", "")).strip_edges() == "":
			return {"ok": false, "error": "季度事件缺少标识或叙事"}
	for battle in data["battles"]:
		if not battle is Dictionary:
			return {"ok": false, "error": "季度战斗格式非法"}
		if not ["attacker_win", "defender_win", "stalemate"].has(str(battle.get("outcome", ""))):
			return {"ok": false, "error": "季度战斗结果非法"}
		if not province_by_id.has(str(battle.get("source", ""))) or not province_by_id.has(str(battle.get("target", ""))):
			return {"ok": false, "error": "季度战斗引用了不存在的省份"}
	var recruit_ids := {}
	for e in data["effects"]:
		if not e is Dictionary or not AI_EFFECT_FIELDS.has(str(e.get("field", ""))):
			return {"ok": false, "error": "AI效果字段非法"}
		var field := str(e.get("field", ""))
		var value = e.get("delta", 0)
		var target := str(e.get("target", ""))
		if field == "recruit":
			var recruit_id := str(value).strip_edges()
			if target != "global" or recruit_id == "" or recruit_ids.has(recruit_id):
				return {"ok": false, "error": "AI招募效果格式非法或重复"}
			var pool_match := false
			for candidate in pool:
				if str(candidate.get("id", "")) == recruit_id:
					pool_match = true
					break
			if not pool_match:
				return {"ok": false, "error": "AI招募了不存在或已不在人才池的人才"}
			recruit_ids[recruit_id] = true
			continue
		if AI_EFFECT_LIMITS.has(field) and (not value is int and not value is float or not is_finite(float(value))):
			return {"ok": false, "error": "AI效果数值非法"}
		if target.begins_with("province:"):
			if not province_by_id.has(target.substr(9)):
				return {"ok": false, "error": "AI引用了不存在的省份"}
			if field == "owner" and not ["ming", "jin", "rebel"].has(str(value)):
				return {"ok": false, "error": "AI返回了未知省份控制者"}
		if target.begins_with("minister:") and minister(target.substr(9)).is_empty():
			return {"ok": false, "error": "AI引用了不存在的大臣"}
		if target.begins_with("position:"):
			if not POSITIONS.has(target.substr(9)) or field != "appointment":
				return {"ok": false, "error": "AI引用了不存在的官职"}
			if str(value) != "" and minister(str(value)).is_empty():
				return {"ok": false, "error": "AI任命了不存在的大臣"}
	return {"ok": true}


func apply_ai_transition(data: Dictionary) -> Dictionary:
	var applied: Array = []
	for e in data.get("effects", []):
		var target := str(e.get("target", ""))
		var field := str(e.get("field", ""))
		var value = e.get("delta", 0)
		if field == "recruit" and target == "global":
			var recruit_id := str(value)
			var pool_index := -1
			for i in pool.size():
				if str(pool[i].get("id", "")) == recruit_id:
					pool_index = i
					break
			if pool_index < 0:
				return {"ok": false, "error": "招募人才不在当前人才池中"}
			var recruited: Dictionary = pool[pool_index]
			pool.remove_at(pool_index)
			ministers.append(recruited)
			applied.append("招募在野人才：%s" % str(recruited.get("name", recruit_id)))
			continue
		if target.begins_with("province:") and field == "owner":
			var owner_prov: Dictionary = province_by_id[target.substr(9)]
			owner_prov["owner"] = str(value)
			applied.append("%s 归属改为 %s" % [owner_prov["name"], str(value)])
			continue
		if target.begins_with("position:") and field == "appointment":
			var pos_id := target.substr(9)
			for k in appointments.keys():
				if appointments[k] == str(value):
					appointments.erase(k)
			if str(value) == "":
				appointments.erase(pos_id)
			else:
				appointments[pos_id] = str(value)
			applied.append("%s 任命更新" % POSITIONS[pos_id]["name"])
			continue
		var delta := clampf(float(value), -float(AI_EFFECT_LIMITS.get(field, 1.0)), float(AI_EFFECT_LIMITS.get(field, 1.0)))
		if target == "global":
			match field:
				"treasury": treasury += delta
				"court_stability": court_stability = clampf(court_stability + delta, 0, 100)
				"rebel_power": rebel_power = clampf(rebel_power + delta, 0, 150)
				"jin_power": jin_power = clampf(jin_power + delta, 0, 120)
				_: continue
			applied.append("全局 %s %+d" % [field, int(delta)])
		elif target.begins_with("province:"):
			var p: Dictionary = province_by_id[target.substr(9)]
			match field:
				"pop": p["pop"] = clampf(p["pop"] + delta, 0, 100)
				"morale": p["morale"] = clampf(p["morale"] + delta, 0, 100)
				"garrison": p["garrison"] = clampf(p["garrison"] + delta, 2, 30)
				"fort": p["fort"] = clampi(int(p["fort"]) + int(delta), 0, 6)
				_: continue
			applied.append("%s %s %+d" % [p["name"], field, int(delta)])
		elif target.begins_with("minister:") and field == "loyalty":
			var m := minister(target.substr(9))
			m["loyalty"] = clampf(m["loyalty"] + delta, 0, 100)
			applied.append("%s 忠诚 %+d" % [m["name"], int(delta)])
	return {"ok": true, "applied": applied, "notes": applied}


func _monthly_income() -> float:
	var income := 0.0
	for p in ming_provinces():
		income += p["tax"] * (0.5 + p["pop"] / 100.0)
	var hubu := minister(appointments.get("hubu", ""))
	if not hubu.is_empty():
		income *= 1.0 + hubu["politics"] / 600.0
	if tax_cut_months > 0:
		income *= 0.7
	return roundf(income)


func _monthly_positions(report: Array) -> void:
	var shoufu := minister(appointments.get("shoufu", ""))
	if not shoufu.is_empty():
		court_stability = clampf(court_stability + shoufu["politics"] / 50.0, 0, 100)
	var bingshi := minister(appointments.get("bingshi", ""))
	if not bingshi.is_empty():
		for p in ming_provinces():
			p["morale"] = clampf(p["morale"] + bingshi["command"] / 50.0, 0, 100)
	var lijun := minister(appointments.get("lijun", ""))
	if not lijun.is_empty():
		for m in ministers:
			m["loyalty"] = clampf(m["loyalty"] + lijun["wisdom"] / 200.0, 0, 100)
	var xingbu := minister(appointments.get("xingbu", ""))
	if not xingbu.is_empty():
		court_stability = clampf(court_stability + xingbu["wisdom"] / 100.0, 0, 100)
	var gongbu := minister(appointments.get("gongbu", ""))
	if not gongbu.is_empty() and (year * 12 + month) % 3 == 0:
		var cands := ming_provinces()
		if cands.size() > 0:
			var p: Dictionary = cands[rng.randi_range(0, cands.size() - 1)]
			p["fort"] = mini(int(p["fort"]) + 1, 6)
			report.append("工部修缮%s城防至 %d 级。" % [p["name"], p["fort"]])


func _provinces_turn(report: Array) -> void:
	for p in ming_provinces():
		# 民心向 50 缓慢回归，并有末期下行压力
		p["pop"] = clampf(p["pop"] + (50.0 - p["pop"]) * 0.02 - 0.15, 0, 100)
		# 军心向 55 回归
		p["morale"] = clampf(p["morale"] + (55.0 - p["morale"]) * 0.03, 0, 100)
	# 低军心边镇哗变
	if treasury < 80:
		var risky := ming_provinces().filter(func(p): return p["morale"] < 35 and p["garrison"] > 5)
		if risky.size() > 0 and rng.randf() < 0.18:
			var p: Dictionary = risky[rng.randi_range(0, risky.size() - 1)]
			p["garrison"] = maxf(p["garrison"] * 0.9, 2.0)
			p["morale"] = clampf(p["morale"] - 3.0, 0, 100)
			var msg := "%s军士因欠饷哗变，逃亡者众。（该省兵力-10%%）" % p["name"]
			add_history(msg)
			emit_signal("toast", "【急报】" + msg)


func _rebel_turn(report: Array) -> void:
	var mp := ming_provinces()
	if mp.size() == 0:
		return
	# 流寇滋生：低民心省份越多越快
	var low_pop := 0.0
	for p in mp:
		low_pop += maxf(0.0, (45.0 - p["pop"])) / 10.0
	var growth := 0.5 + low_pop
	rebel_power = minf(rebel_power + growth, 150.0)
	report.append("流寇势力于暗中滋长（%d）。" % int(rebel_power))

	# 民变：民心极低的省份可能直接举义
	for p in mp:
		if p["pop"] < 18.0 and rng.randf() < 0.10:
			p["owner"] = "rebel"
			p["garrison"] = maxf(rebel_power * 0.25, 6.0)
			rebel_power = maxf(rebel_power - 8.0, 0)
			var msg := "%s民变骤起，举城从贼！" % p["name"]
			add_history(msg)
			emit_signal("toast", "【急报】" + msg)
			return

	# 流寇攻城：挑民心最低且接敌（或任意低民心）的省
	if rebel_power >= 85 and rng.randf() < 0.45:
		var targets := _border_ming_provinces("rebel")
		if targets.size() == 0:
			targets = mp
		var tgt: Dictionary = _lowest_pop(targets)
		var atk := rebel_power * 0.35 * rng.randf_range(0.9, 1.15)
		var def: float = tgt["garrison"] * (1.0 + tgt["fort"] * 0.12) \
			* clampf(tgt["morale"] / 60.0, 0.6, 1.3) * rng.randf_range(0.9, 1.15)
		if atk > def:
			tgt["owner"] = "rebel"
			tgt["garrison"] = rebel_power * 0.3
			tgt["pop"] = clampf(tgt["pop"] - 15, 0, 100)
			rebel_power = maxf(rebel_power - 12, 0)
			var msg := "流寇攻陷%s！守军溃散，望风而降者不可胜数。" % tgt["name"]
			add_history(msg)
			emit_signal("toast", "【急报】" + msg)
		else:
			rebel_power = maxf(rebel_power - 8, 0)
			tgt["garrison"] = maxf(tgt["garrison"] * 0.85, 2.0)
			add_history("流寇围攻%s，为守军力战所却。" % tgt["name"])


func _lowest_pop(arr: Array) -> Dictionary:
	var best: Dictionary = {}
	for p in arr:
		if best.is_empty() or p["pop"] < best["pop"]:
			best = p
	return best


func _jin_turn(report: Array) -> void:
	jin_power = minf(jin_power + 1.2, 120.0)
	report.append("关外后金厉兵秣马，势渐张大（%d）。" % int(jin_power))


## 后金入塞事件触发时的京师保卫战结算（守方用北直隶军心）
func jin_battle(defend_bonus: float) -> String:
	var jingzhi: Dictionary = province_by_id.get("jingzhi", {})
	if jingzhi.get("owner", "") != "ming" or jin_power <= 0:
		return "（后金主力未动，此战未起。）"
	var atk := jin_power * 0.42 * rng.randf_range(0.9, 1.15)
	var def: float = jingzhi["garrison"] * (1.0 + jingzhi["fort"] * 0.15) \
		* clampf(jingzhi["morale"] / 60.0, 0.6, 1.3) * rng.randf_range(0.9, 1.15) * defend_bonus
	var bingshi := minister(appointments.get("bingshi", ""))
	if not bingshi.is_empty():
		def *= 1.0 + bingshi["command"] / 400.0
	if atk > def:
		jingzhi["owner"] = "jin"
		jingzhi["garrison"] = jin_power * 0.3
		add_history("八旗铁骑踏破京师！社稷倾覆……")
		_end(false, "京师陷落，社稷倾覆。山河犹在，永驻成空。")
		return "京师陷落！宗庙震惊，天下崩坏。"
	else:
		jingzhi["garrison"] = maxf(jingzhi["garrison"] * 0.8, 2.0)
		jin_power = maxf(jin_power - 8, 0)
		jingzhi["morale"] = clampf(jingzhi["morale"] + 5, 0, 100)
		add_history("后金入犯京畿，勤王军力战却敌！")
		return "后金顿兵城下，损兵折将而退。（京畿军心+5，后金-8）"


func _border_ming_provinces(enemy_owner: String) -> Array:
	var out: Array = []
	for p in ming_provinces():
		# 辽东都司属于外部边防层，不在 province_by_id 中；京畿仍视为后金边境。
		if enemy_owner == "jin" and p.get("id", "") == "jingzhi":
			out.append(p)
			continue
		for adj_id in p["adj"]:
			var a: Dictionary = province_by_id.get(adj_id, {})
			if a.get("owner", "") == enemy_owner:
				out.append(p)
				break
	return out


# ---------- 事件 ----------
func _pick_event() -> Dictionary:
	var events = _load_json("res://data/events.json")
	if events == null:
		return {}
	var candidates: Array = []
	for ev in events:
		if ev.get("special", "") == "rebel_attack":
			continue
		if ev.get("once", false) and fired_once.has(ev["id"]):
			continue
		if year < int(ev.get("min_year", 1627)):
			continue
		if not _condition_ok(ev.get("condition", "")):
			continue
		if rng.randf() < float(ev.get("chance", 0.0)):
			candidates.append(ev)
	if candidates.size() == 0:
		return {}
	var ev: Dictionary = candidates[rng.randi_range(0, candidates.size() - 1)]
	if ev.get("once", false):
		fired_once.append(ev["id"])
	return ev


func _condition_ok(cond: String) -> bool:
	if cond == "":
		return true
	if cond == "treasury_low":
		return treasury < 100
	if cond == "morale_low":
		return avg_morale() < 45
	if cond.begins_with("minister_alive:"):
		return not minister(cond.substr(15)).is_empty()
	return true


## 事件省份定位：fixed:xxx / low_morale_border / low_pop_ming / random_ming
func resolve_event_province(ev: Dictionary) -> Dictionary:
	var sel: String = ev.get("prov_select", "")
	if sel == "":
		return {}
	if sel.begins_with("fixed:"):
		return province_by_id.get(sel.substr(6), {})
	match sel:
		"low_morale_border":
			var cands := ming_provinces().filter(func(p): return p["garrison"] >= 5)
			if cands.is_empty():
				cands = ming_provinces()
			var best: Dictionary = {}
			for p in cands:
				if best.is_empty() or p["morale"] < best["morale"]:
					best = p
			return best
		"low_pop_ming":
			return _lowest_pop(ming_provinces())
		"random_ming":
			var mp := ming_provinces()
			return mp[rng.randi_range(0, mp.size() - 1)] if mp.size() > 0 else {}
	return {}


func resolve_event_choice(ev: Dictionary, choice: Dictionary) -> String:
	if simulation_in_flight or not LLMClient.is_enabled():
		return "AI 推演未连接，事件暂不能裁决。"
	var request_id := ai_request_id + 1
	ai_request_id = request_id
	simulation_in_flight = true
	emit_signal("ai_status", "AI 正在裁决事件后果……")
	LLMClient.event_ready.connect(func(result: Dictionary):
		if request_id != ai_request_id:
			return
		if not result.get("ok", false):
			_simulation_failed(str(result.get("error", "事件推演失败")))
			return
		var data: Dictionary = result.get("data", {})
		if not data.has("effects"):
			data["effects"] = []
		if not data.has("events"):
			data["events"] = []
		if not data.has("battles"):
			data["battles"] = []
		var checked := validate_ai_result(data)
		if not checked["ok"]:
			_simulation_failed(checked["error"])
			return
		var applied := apply_ai_transition(data)
		if not applied["ok"]:
			_simulation_failed(applied["error"])
			return
		add_history("【%s】%s" % [ev.get("title", "事件"), str(data.get("narrative", "事件后果已裁决。"))])
		simulation_in_flight = false
		emit_signal("event_result", {"ok": true, "narrative": data.get("narrative", ""), "applied": applied.get("applied", [])})
		emit_signal("ai_status", "事件已由 AI 裁决并落库")
		emit_signal("state_changed"), CONNECT_ONE_SHOT)
	LLMClient.resolve_event_choice(state_snapshot(), ev, choice)
	return "事件已提交 AI 裁决，请稍候。"


func apply_effects(effects: Dictionary, prov: Dictionary = {}) -> void:
	if effects.has("treasury"):
		treasury += effects["treasury"]
	if effects.has("court_stability"):
		court_stability = clampf(court_stability + effects["court_stability"], 0, 100)
	if effects.has("rebel_power"):
		rebel_power = maxf(rebel_power + effects["rebel_power"], 0)
	if effects.has("jin_power"):
		jin_power = maxf(jin_power + effects["jin_power"], 0)
	# 省级效果（事件定位省份）
	if not prov.is_empty():
		if effects.has("prov_pop"):
			prov["pop"] = clampf(prov["pop"] + effects["prov_pop"], 0, 100)
		if effects.has("prov_morale"):
			prov["morale"] = clampf(prov["morale"] + effects["prov_morale"], 0, 100)
		if effects.has("prov_garrison_pct"):
			prov["garrison"] = maxf(prov["garrison"] * (1.0 + effects["prov_garrison_pct"]), 2.0)
	# 全国省级效果
	if effects.has("all_pop"):
		for p in ming_provinces():
			p["pop"] = clampf(p["pop"] + effects["all_pop"], 0, 100)
	if effects.has("all_morale"):
		for p in ming_provinces():
			p["morale"] = clampf(p["morale"] + effects["all_morale"], 0, 100)
	if effects.has("garrison_all"):
		for p in ming_provinces():
			p["garrison"] = maxf(p["garrison"] * (1.0 + effects["garrison_all"]), 2.0)
	if effects.has("add_minister"):
		var add_id: String = effects["add_minister"]
		for i in pool.size():
			if pool[i]["id"] == add_id:
				var nm: Dictionary = pool[i]
				pool.remove_at(i)
				ministers.append(nm)
				add_history("%s 入朝为官。" % nm["name"])
				break
	if effects.has("remove_minister"):
		var rm_id: String = effects["remove_minister"]
		for k in appointments.keys():
			if appointments[k] == rm_id:
				appointments.erase(k)
		for i in ministers.size():
			if ministers[i]["id"] == rm_id:
				add_history("%s 离开朝堂。" % ministers[i]["name"])
				ministers.remove_at(i)
				break
	if effects.has("loyalty_boost"):
		var boosts: Dictionary = effects["loyalty_boost"]
		for mid in boosts:
			var m := minister(mid)
			if not m.is_empty():
				m["loyalty"] = clampf(m["loyalty"] + boosts[mid], 0, 100)


# ---------- 终局 ----------
func _check_end() -> void:
	if game_ended:
		return
	if treasury <= -300:
		_end(false, "国库枯竭，百官俸禄断绝，天下大乱，社稷倾覆。")
		return
	if avg_pop() <= 8 and ming_provinces().size() <= 12:
		_end(false, "民心尽失，四方鼎沸，闯王入京，社稷倾覆。")
		return
	if ming_provinces().size() <= 6:
		_end(false, "山河破碎，半壁尽失，大明社稷名存实亡。")
		return
	if year > END_YEAR or (year == END_YEAR and month > END_MONTH):
		var n := ming_provinces().size()
		if avg_pop() >= 55 and court_stability >= 45 and n >= 14:
			_end(true, "崇祯十七载，你挽狂澜于既倒。民心归附，朝堂整肃，山河光复——山河永驻，日月重光！")
		elif n >= 10:
			_end(true, "崇祯十七载，大明虽伤痕累累，终得延续。史书将记下：思宗，中兴之主也。")
		else:
			_end(false, "崇祯十七载至，疆土沦丧过半，大明仅存残喘，终为后人所叹。")


func _end(vic: bool, reason: String) -> void:
	if game_ended:
		return
	game_ended = true
	victory = vic
	add_history(reason)
	emit_signal("game_over", vic, reason)


# ---------- 存档 ----------
func save_game() -> void:
	var data := {
		"version": SAVE_VERSION,
		"year": year, "month": month, "day": day, "quarter": quarter, "quarter_day": quarter_day,
		"treasury": treasury,
		"court_stability": court_stability, "rebel_power": rebel_power,
		"jin_power": jin_power, "actions_left": actions_left,
		"provinces": provinces, "ministers": ministers, "pool": pool,
		"appointments": appointments, "fired_once": fired_once,
		"tax_cut_months": tax_cut_months, "history": history,
		"pending_actions": pending_actions, "current_quarter_bulletins": current_quarter_bulletins,
		"current_quarter_dialogues": current_quarter_dialogues, "current_quarter_debates": current_quarter_debates,
		"current_quarter_decisions": current_quarter_decisions, "quarter_edicts": quarter_edicts,
		"quarter_summaries": quarter_summaries, "quarter_reports": quarter_reports,
		"political_tasks": political_tasks, "quarter_task_snapshot": quarter_task_snapshot,
		"stage": stage, "last_ai_result": last_ai_result,
		"last_ai_validation": last_ai_validation, "ai_error": ai_error,
		"game_ended": game_ended, "victory": victory,
	}
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data, "\t"))


func has_save() -> bool:
	return FileAccess.file_exists(SAVE_PATH)


func load_game() -> bool:
	if not has_save():
		return false
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if f == null:
		return false
	var data = JSON.parse_string(f.get_as_text())
	if not data is Dictionary:
		return false
	year = int(data.get("year", START_YEAR))
	month = int(data.get("month", START_MONTH))
	day = int(data.get("day", START_DAY))
	quarter = int(data.get("quarter", clampi(int(ceil(float(month) / 3.0)), 1, 4)))
	quarter_day = int(data.get("quarter_day", 1))
	treasury = data.get("treasury", 120.0)
	court_stability = data.get("court_stability", 50.0)
	rebel_power = data.get("rebel_power", 20.0)
	jin_power = data.get("jin_power", 45.0)
	actions_left = int(data.get("actions_left", MAX_ACTIONS))
	provinces = _normalize_loaded_provinces(data.get("provinces", []))
	province_by_id = {}
	for p in provinces:
		_backfill_province(p)
		province_by_id[p["id"]] = p
	ministers = data.get("ministers", [])
	pool = data.get("pool", [])
	appointments = data.get("appointments", {})
	fired_once = data.get("fired_once", [])
	tax_cut_months = int(data.get("tax_cut_months", 0))
	history = data.get("history", [])
	pending_actions = data.get("pending_actions", [])
	current_quarter_bulletins = data.get("current_quarter_bulletins", [])
	current_quarter_dialogues = data.get("current_quarter_dialogues", [])
	current_quarter_debates = data.get("current_quarter_debates", [])
	current_quarter_decisions = data.get("current_quarter_decisions", [])
	quarter_edicts = data.get("quarter_edicts", [])
	quarter_summaries = data.get("quarter_summaries", [])
	quarter_reports = data.get("quarter_reports", [])
	political_tasks = data.get("political_tasks", [])
	if political_tasks.is_empty():
		political_tasks = [_initial_political_task()]
	quarter_task_snapshot = data.get("quarter_task_snapshot", political_tasks.duplicate(true))
	stage = str(data.get("stage", STAGE_MORNING_COURT))
	last_ai_result = data.get("last_ai_result", {})
	last_ai_validation = data.get("last_ai_validation", {})
	ai_error = str(data.get("ai_error", ""))
	simulation_in_flight = false
	game_ended = bool(data.get("game_ended", false))
	victory = bool(data.get("victory", false))
	emit_signal("state_changed")
	return true


func add_history(text: String) -> void:
	history.append(text)
	emit_signal("history_added", text)


# ============ 诏书推演（L2 引擎校验 + L3 落库） ============
const EDICT_LIMITS := {
	"treasury": 80.0, "court_stability": 10.0, "rebel_power": 12.0, "jin_power": 10.0,
	"pop": 10.0, "morale": 12.0, "garrison": 5.0, "loyalty": 15.0,
}
const AI_EFFECT_LIMITS := {
	"treasury": 500.0, "court_stability": 30.0, "rebel_power": 40.0, "jin_power": 40.0,
	"pop": 30.0, "morale": 35.0, "garrison": 30.0, "loyalty": 30.0, "fort": 3.0,
}
const AI_EFFECT_FIELDS := ["treasury", "court_stability", "rebel_power", "jin_power", "pop", "morale", "garrison", "loyalty", "owner", "fort", "appointment", "recruit"]


## 局势快照（供 LLM 推演的上下文，控制体积）
func state_snapshot() -> Dictionary:
	var provs := []
	for p in provinces:
		provs.append({"id": p["id"], "name": p["name"], "owner": p["owner"], "tax": int(p["tax"]), "pop": int(p["pop"]), "morale": int(p["morale"]), "garrison": int(p["garrison"]), "fort": int(p["fort"]), "adj": p["adj"]})
	var mins := []
	for m in ministers:
		mins.append({"id": m["id"], "name": m["name"], "faction": m.get("faction", "中立"), "loyalty": int(m["loyalty"]), "command": int(m["command"]), "politics": int(m["politics"]), "wisdom": int(m["wisdom"]), "position": POSITIONS.get(position_of(m["id"]), {}).get("name", "")})
	var pool_snapshot := []
	for m in pool:
		pool_snapshot.append({"id": m.get("id", ""), "name": m.get("name", ""), "title": m.get("title", ""), "faction": m.get("faction", "中立"), "command": int(m.get("command", 0)), "politics": int(m.get("politics", 0)), "wisdom": int(m.get("wisdom", 0))})
	return {
		"schema_version": SAVE_VERSION, "date": date_text(), "year": year,
		"quarter": quarter, "is_quarter_end": is_quarter_end(), "stage": stage,
		"treasury": int(treasury), "actions_left": actions_left, "court_stability": int(court_stability),
		"rebel_power": int(rebel_power), "jin_power": int(jin_power), "avg_pop": int(avg_pop()), "avg_morale": int(avg_morale()),
		"provinces": provs, "ministers": mins, "pool": pool_snapshot, "appointments": appointments.duplicate(true),
		"political_tasks": political_tasks.duplicate(true), "quarter_task_snapshot": quarter_task_snapshot.duplicate(true),
		"quarter_edicts": quarter_edicts.duplicate(true), "current_quarter_bulletins": current_quarter_bulletins.duplicate(true),
		"current_quarter_dialogues": current_quarter_dialogues.duplicate(true), "current_quarter_debates": current_quarter_debates.duplicate(true),
		"current_quarter_decisions": current_quarter_decisions.duplicate(true), "quarter_summaries": quarter_summaries.duplicate(true),
		"pending_actions": pending_actions.duplicate(true), "history": recent_history(12),
	}


func recent_history(n: int) -> Array:
	var start: int = maxi(0, history.size() - n)
	return history.slice(start)


## 校验并应用推演效果，返回 {applied:[描述], clipped:[描述]}
func apply_edict_effects(effects) -> Dictionary:
	var applied: Array = []
	var clipped: Array = []
	if not effects is Array:
		return {"applied": applied, "clipped": clipped}
	for e in effects:
		if not e is Dictionary:
			continue
		var target: String = str(e.get("target", "global"))
		var field: String = str(e.get("field", ""))
		if not EDICT_LIMITS.has(field):
			clipped.append("（不认识的条目：%s %s）" % [target, field])
			continue
		var delta := float(e.get("delta", 0))
		if absf(delta) < 0.5:
			continue
		var limit: float = EDICT_LIMITS[field]
		var reason: String = str(e.get("reason", ""))
		var desc := ""

		if target == "global":
			match field:
				"treasury":
					var d1 := clampf(delta, -limit, limit)
					treasury += d1
					desc = "国库存银 %+d 万两" % int(d1)
				"court_stability":
					var d2 := clampf(delta, -limit, limit)
					court_stability = clampf(court_stability + d2, 0, 100)
					desc = "朝堂稳定 %+d" % int(d2)
				"rebel_power":
					var d3 := clampf(delta, -limit, limit)
					rebel_power = clampf(rebel_power + d3, 0, 150)
					desc = "流寇势力 %+d" % int(d3)
				"jin_power":
					var d4 := clampf(delta, -limit, limit)
					jin_power = clampf(jin_power + d4, 0, 120)
					desc = "后金势力 %+d" % int(d4)
				_:
					clipped.append("（全局条目 %s 不适用）" % field)
					continue
			applied.append(desc + ("：" + reason if reason != "" else ""))
		elif target.begins_with("province:"):
			var p: Dictionary = province_by_id.get(target.substr(9), {})
			if p.is_empty() or p["owner"] != "ming":
				clipped.append("（目标省份不存在或不归明：）" + target)
				continue
			match field:
				"pop":
					var d5 := clampf(delta, -limit, limit)
					p["pop"] = clampf(p["pop"] + d5, 0, 100)
					desc = "%s 民心 %+d" % [p["name"], int(d5)]
				"morale":
					var d6 := clampf(delta, -limit, limit)
					p["morale"] = clampf(p["morale"] + d6, 0, 100)
					desc = "%s 军心 %+d" % [p["name"], int(d6)]
				"garrison":
					var d7 := clampf(delta, -limit, limit)
					p["garrison"] = clampf(p["garrison"] + d7, 2.0, 30.0)
					desc = "%s 兵力 %+d 万" % [p["name"], int(d7)]
				_:
					clipped.append("（省级条目 %s 不适用）" % field)
					continue
			applied.append(desc + ("：" + reason if reason != "" else ""))
		elif target.begins_with("minister:"):
			var m := minister(target.substr(9))
			if m.is_empty():
				clipped.append("（大臣不存在：）" + target)
				continue
			if field != "loyalty":
				clipped.append("（大臣条目 %s 不适用）" % field)
				continue
			var d8 := clampf(delta, -limit, limit)
			m["loyalty"] = clampf(m["loyalty"] + d8, 0, 100)
			applied.append("%s 忠诚 %+d" % [m["name"], int(d8)] + ("：" + reason if reason != "" else ""))
		else:
			clipped.append("（无法理解的目标：）" + target)
	if applied.size() > 0 or clipped.size() > 0:
		emit_signal("state_changed")
	return {"applied": applied, "clipped": clipped}


## 无 API Key 时的诏书关键词回退（弱效果，确定性）
func apply_fallback_edict(edict: String) -> Dictionary:
	var narrative := ""
	var applied: Array = []
	var text := edict.strip_edges()
	if text == "":
		narrative = "本回合无诏。朝局按旧例运转，百官观望，一事无成。"
	elif text.contains("加税") or text.contains("加派") or text.contains("征银"):
		treasury += 40
		for p in ming_provinces():
			p["pop"] = clampf(p["pop"] - 3.0, 0, 100)
		applied.append("国库 +40 万两；各省民心 -3")
		narrative = "诏加征银四十万两。有司奉旨催科，闾里嗟怨，然度支稍苏。"
	elif text.contains("减税") or text.contains("蠲免") or text.contains("免税"):
		treasury -= 20
		for p in ming_provinces():
			p["pop"] = clampf(p["pop"] + 4.0, 0, 100)
		applied.append("国库 -20 万两；各省民心 +4")
		narrative = "诏蠲逋赋。小民相庆于道，而户部告匮之疏旋至。"
	elif text.contains("赈") or text.contains("济"):
		treasury -= 30
		var worst := _lowest_pop(ming_provinces())
		if not worst.is_empty():
			worst["pop"] = clampf(worst["pop"] + 8.0, 0, 100)
			applied.append("%s 民心 +8" % worst["name"])
			narrative = "诏发帑赈济%s饥民。有司奉行，活者甚众，然帑藏益虚。" % worst["name"]
		else:
			narrative = "诏赈天下，然疆土沦丧，无可赈之地。"
	elif text.contains("练兵") or text.contains("犒") or text.contains("发饷"):
		treasury -= 30
		for p in _border_ming_provinces("jin"):
			p["morale"] = clampf(p["morale"] + 6.0, 0, 100)
		applied.append("边镇军心 +6；国库 -30 万两")
		narrative = "诏犒边军。将士感奋，山海关外羽书稍安。"
	elif text.contains("剿") or text.contains("进讨") or text.contains("征讨"):
		rebel_power = maxf(rebel_power - 5.0, 0)
		applied.append("流寇势力 -5")
		narrative = "诏严剿流寇。官军四出，寇势稍沮，然斩获多于胁从，识者忧之。"
	elif text.contains("和") or text.contains("议抚"):
		court_stability = clampf(court_stability - 1.0, 0, 100)
		applied.append("朝堂稳定 -1")
		narrative = "诏议抚赏。言官交章攻讦「辱国」，朝堂哗然，其事遂寝。"
	else:
		narrative = "诏下，有司议行。然空言无实政，天下事未能有所振饰。"
	add_history("【诏书】" + (text if text != "" else "（无诏）"))
	if applied.size() > 0:
		add_history("【诏效】" + "；".join(PackedStringArray(applied)))
		narrative += "\n\n圣旨执行结果：" + "；".join(PackedStringArray(applied)) + "。"
		emit_signal("state_changed")
	return {"narrative": narrative, "applied": applied}
