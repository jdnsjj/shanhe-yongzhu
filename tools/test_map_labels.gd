extends SceneTree
## 地图标签契约测试：每个省份标签必须落在该省份的有效多边形内。
## 运行：godot --headless --path . --script tools/test_map_labels.gd

const MAP_SIZE := Vector2(1920, 1080)


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var shapes_file := FileAccess.open("res://data/province_shapes.json", FileAccess.READ)
	var labels_file := FileAccess.open("res://data/label_layout.json", FileAccess.READ)
	if shapes_file == null or labels_file == null:
		print("地图标签测试失败：缺少地图数据文件")
		quit(2)
		return
	var shapes = JSON.parse_string(shapes_file.get_as_text())
	var labels = JSON.parse_string(labels_file.get_as_text())
	if not shapes is Dictionary or not labels is Dictionary:
		print("地图标签测试失败：JSON 格式非法")
		quit(3)
		return
	var provinces: Dictionary = shapes.get("provinces", {})
	var layouts: Dictionary = labels.get("labels", {})
	var failures: Array[String] = []
	for pid in provinces:
		if not layouts.has(pid):
			failures.append("%s 缺少标签布局" % pid)
			continue
		var anchor: Array = layouts[pid].get("anchor", [])
		if anchor.size() < 2:
			failures.append("%s 标签坐标非法" % pid)
			continue
		var point := Vector2(float(anchor[0]) * MAP_SIZE.x, float(anchor[1]) * MAP_SIZE.y)
		var inside := false
		for ring in provinces[pid].get("polys", []):
			if not ring is Array or ring.size() < 3:
				continue
			var polygon := PackedVector2Array()
			for raw_point in ring:
				if raw_point is Array and raw_point.size() >= 2:
					polygon.append(Vector2(float(raw_point[0]) * MAP_SIZE.x, float(raw_point[1]) * MAP_SIZE.y))
			if polygon.size() >= 3 and Geometry2D.is_point_in_polygon(point, polygon):
				inside = true
				break
		if not inside:
			failures.append("%s 标签不在所属多边形内：%s" % [pid, anchor])
	var world_file := FileAccess.open("res://data/world_regions.json", FileAccess.READ)
	var world = JSON.parse_string(world_file.get_as_text()) if world_file else []
	var map_canvas = preload("res://scripts/map_canvas.gd").new()
	if world is Array:
		for region in world:
			if not region is Dictionary:
				continue
			var rid := str(region.get("id", ""))
			var polygons := []
			for ring in region.get("rings", []):
				if not ring is Array or ring.size() < 3:
					continue
				var polygon := PackedVector2Array()
				for raw_point in ring:
					if raw_point is Array and raw_point.size() >= 2:
						polygon.append(Vector2(float(raw_point[0]) * MAP_SIZE.x, float(raw_point[1]) * MAP_SIZE.y))
				if polygon.size() >= 3:
					polygons.append(polygon)
			if polygons.is_empty():
				failures.append("%s 缺少可绘制轮廓" % rid)
				continue
			var center: Vector2 = map_canvas._world_label_center_from_polygons(polygons)
			var inside := false
			for polygon in polygons:
				if Geometry2D.is_point_in_polygon(center, polygon):
					inside = true
					break
			if not inside:
				failures.append("%s 外部区域标签中心不在所属轮廓内：%s" % [rid, center])
	map_canvas.free()
	if failures.is_empty():
		print("地图标签契约通过：省份与外部区域标签均落在所属多边形内。")
		quit(0)
	else:
		for failure in failures:
			print("- " + failure)
		print("地图标签契约失败：%d 项" % failures.size())
		quit(1)
