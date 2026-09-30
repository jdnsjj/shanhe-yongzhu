extends SceneTree
## 诏书系统无头测试

func _initialize() -> void:
	var gs = load("res://scripts/game_state.gd").new()
	root.add_child(gs)
	await process_frame
	# 1) 关键词回退
	var r1: Dictionary = gs.apply_fallback_edict("诏加派辽饷五十万两以充军实")
	print("回退叙事: ", r1["narrative"].left(40), "… applied=", r1["applied"])
	print("国库: ", int(gs.treasury))
	# 2) L2 校验：合法效果 + 越界效果 + 非法目标混合
	var r2: Dictionary = gs.apply_edict_effects([
		{"target": "global", "field": "treasury", "delta": 50, "reason": "抄没逆党"},
		{"target": "global", "field": "treasury", "delta": 500, "reason": "越界应被裁剪"},
		{"target": "province:shaanxi", "field": "pop", "delta": 6, "reason": "赈济"},
		{"target": "province:liaodong", "field": "pop", "delta": 6, "reason": "敌省应被驳回"},
		{"target": "minister:yuanchonghuan", "field": "loyalty", "delta": 10, "reason": "抚慰"},
		{"target": "global", "field": "magic", "delta": 99, "reason": "未知字段"},
	])
	print("applied:")
	for a in r2["applied"]:
		print("  + ", a)
	print("clipped:")
	for c in r2["clipped"]:
		print("  - ", c)
	print("国库: ", int(gs.treasury), " 陕西民心: ", int(gs.province_by_id["shaanxi"]["pop"]))
	quit(0)
