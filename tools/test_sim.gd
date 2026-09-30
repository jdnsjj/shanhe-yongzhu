extends SceneTree
## 季度 AI 契约测试：无 API Key 时禁止推进任何季度核心状态。
## 运行：godot --headless --path . --script tools/test_sim.gd

var gs: Node


func _initialize() -> void:
	gs = load("res://scripts/game_state.gd").new()
	root.add_child(gs)
	_run.call_deferred()


func _run() -> void:
	await process_frame
	print("开局诊断：%s，任务%d，圣旨%d" % [gs.date_text(), gs.political_tasks.size(), gs.quarter_edicts.size()])
	if gs.political_tasks.is_empty() or gs.political_tasks[0].get("status", "") != "active":
		print("契约失败：开局没有活动时政任务")
		quit(2)
	var before_date: String = gs.date_text()
	var before_quarter: int = gs.quarter
	var before_treasury: float = gs.treasury
	var before_tasks: Array = gs.political_tasks.duplicate(true)
	var before_reports: int = gs.quarter_reports.size()
	var before_actions: int = gs.actions_left
	var before_pending: Array = gs.pending_actions.duplicate(true)
	if not gs.is_quarter_end():
		print("契约失败：离散季度模式必须随时允许提交季度推演")
		quit(3)
	var res: Dictionary = gs.settle_quarter()
	if res.get("ok", true):
		print("契约失败：无 API Key 时不应启动季度推演")
		quit(4)
	if gs.date_text() != before_date or gs.quarter != before_quarter or gs.treasury != before_treasury:
		print("契约失败：无 Key 阻断后日期或国库发生变化")
		quit(5)
	if gs.political_tasks != before_tasks or gs.quarter_reports.size() != before_reports:
		print("契约失败：无 Key 阻断后任务或季度报告发生变化")
		quit(6)
	if gs.actions_left != before_actions or gs.pending_actions != before_pending:
		print("契约失败：无 Key 阻断后行动点或行动队列发生变化")
		quit(7)
	var invalid_recruit := {"schema_version": 1, "effects": [{"target": "global", "field": "recruit", "delta": "missing"}], "events": [], "battles": [], "validation": {"ok": true}}
	if gs.validate_ai_result(invalid_recruit).get("ok", true):
		print("契约失败：不存在的人才 ID 不应通过季度校验")
		quit(8)
	print("AI契约通过：无 API Key 时季度财政、民心军心、势力、战斗、事件、任务与结局均未推进。")
	quit(0)
