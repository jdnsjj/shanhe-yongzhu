extends SceneTree
## 明末战略区块数据契约：逻辑 ID 稳定、名称完整，并标注历史口径。
## 运行：godot --headless --path . --script tools/test_historical_regions.gd

const EXPECTED_IDS := [
	"jingzhi", "shanxi", "shaanxi", "shandong", "henan",
	"nanzhili", "huguang", "sichuan", "guizhou", "yunnan", "guangxi", "guangdong",
	"jiangxi", "zhejiang", "fujian",
]

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var file := FileAccess.open("res://data/provinces.json", FileAccess.READ)
	if file == null:
		print("历史区块测试失败：缺少 provinces.json")
		quit(2)
		return
	var data = JSON.parse_string(file.get_as_text())
	if not data is Array:
		print("历史区块测试失败：JSON 格式非法")
		quit(3)
		return
	var by_id := {}
	for province in data:
		if province is Dictionary:
			by_id[str(province.get("id", ""))] = province
	var failures: Array[String] = []
	for pid in EXPECTED_IDS:
		if not by_id.has(pid):
			failures.append("缺少稳定区块 ID：%s" % pid)
			continue
		var province: Dictionary = by_id[pid]
		if str(province.get("name", "")).strip_edges() == "":
			failures.append("%s 缺少游戏名称" % pid)
		if str(province.get("map_name", province.get("name", ""))).strip_edges() == "":
			failures.append("%s 缺少地图名称" % pid)
		if str(province.get("historical_scope", "")).strip_edges() == "":
			failures.append("%s 缺少历史口径说明" % pid)
	for pid in by_id:
		var province: Dictionary = by_id[pid]
		for adjacent in province.get("adj", []):
			if not by_id.has(str(adjacent)):
				continue
			if not by_id[str(adjacent)].get("adj", []).has(pid):
				failures.append("邻接关系不对称：%s -> %s" % [pid, adjacent])
	if by_id.size() != EXPECTED_IDS.size():
		failures.append("区块数量异常：期望 %d，实际 %d" % [EXPECTED_IDS.size(), by_id.size()])
	if by_id.has("gansu") or by_id.has("liaodong"):
		failures.append("甘肃/辽东不应作为普通布政使司区块存在")
	var world_file := FileAccess.open("res://data/world_regions.json", FileAccess.READ)
	var world = JSON.parse_string(world_file.get_as_text()) if world_file else []
	var has_kokonor := false
	var has_liaodong := false
	var world_by_id := {}
	if world is Array:
		for region in world:
			if not region is Dictionary:
				continue
			world_by_id[str(region.get("id", ""))] = region
			has_kokonor = has_kokonor or str(region.get("id", "")) == "kokonor"
			has_liaodong = has_liaodong or str(region.get("id", "")) == "liaodong"
	if not has_kokonor:
		failures.append("缺少西海诸部外部区域")
	if not has_liaodong:
		failures.append("缺少辽东都司外部边防区域")
	if world_by_id.has("kokonor") and str(world_by_id["kokonor"].get("name", "")) != "西海蒙古诸部":
		failures.append("西海区域名称不符合 1627 年历史口径")
	if world_by_id.has("liaodong") and str(world_by_id["liaodong"].get("faction", "")) != "jin":
		failures.append("辽东都司应处于后金边防势力层")
	if not world_by_id.has("korea") or str(world_by_id.get("korea", {}).get("name", "")) != "朝鲜王朝":
		failures.append("朝鲜应以单一朝鲜王朝区域表示")
	if world_by_id.has("korea_north"):
		failures.append("不应保留现代语境的 korea_north 区域")
	if not world_by_id.has("taiwan"):
		failures.append("缺少台湾外部区域")
	else:
		if str(world_by_id["taiwan"].get("faction", "")) != "dutch":
			failures.append("台湾 1627 年应标为荷兰东印度公司外部势力")
		if str(world_by_id["taiwan"].get("name", "")) != "台湾（荷兰东印度公司）":
			failures.append("台湾区域名称未反映 1627 年控制情况")
	for region_id in ["mongol", "tatar", "manchuria", "japan", "vietnam", "siam", "burma", "cambodia", "philippines"]:
		if not world_by_id.has(region_id):
			failures.append("缺少外部历史区域：%s" % region_id)
	if failures.is_empty():
		print("历史区块契约通过：15 个明代行政区 ID、地图名称和历史口径均完整。")
		quit(0)
	else:
		for failure in failures:
			print("- " + failure)
		print("历史区块契约失败：%d 项" % failures.size())
		quit(1)
