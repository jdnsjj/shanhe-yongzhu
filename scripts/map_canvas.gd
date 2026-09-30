extends Control
## 舆图画布：省界、势力区域与注记由预处理后的矢量数据绘制。
## 运行时只负责相机、状态着色和低频命中检测，不依赖外部脚本。

var gs: Node
var map_font: Font
var selected := ""
var hovered := ""
var view_mode := "pop"   # pop / finance / tax / disaster / war
var render_quality := "high"
var on_select: Callable
var on_context: Callable

const MAP_SIZE := Vector2(1920, 1080)
const ZOOM_MIN := 0.7
const ZOOM_MAX := 4.0

var cam_center := MAP_SIZE / 2.0
var zoom := 1.0
var _pressing := false
var _dragging := false
var _press_screen := Vector2.ZERO
var _press_cam := Vector2.ZERO
var _last_mouse := Vector2.ZERO

var labels := {}
var label_layout := {}
var province_shapes := {}
var decor := {}
var world_regions: Array = []
var _province_polys := {}
var _province_bounds := {}
var _province_drawable := {}
var _world_polys := {}
var _world_bounds := {}
var _world_drawable := {}
var _world_label_centers := {}
var _province_names := {}
var _last_hover_check := 0
var _last_hover_position := Vector2(-10000, -10000)
var _hover_pending := false
var _label_size_cache := {}
const HOVER_INTERVAL_MS := 50

const WORLD_TINT := {
	"mongol": Color("8b8066"), "tatar": Color("81785d"), "russia": Color("92907b"),
	"jin": Color("746b78"), "korea": Color("8f7666"), "japan": Color("9b8068"),
	"vietnam": Color("8c806d"), "laos": Color("8c806d"), "siam": Color("8c806d"),
	"burma": Color("8c806d"), "cambodia": Color("8c806d"), "philippines": Color("8c806d"),
	"ryukyu": Color("8c806d"), "dutch": Color("8d7861"), "ming": Color("c6a96b")
}

const FACTION_TINT := {
	"ming": Color("c6a96b"),
	"jin": Color("7b7284"),
	"rebel": Color("aa6a4c"),
}
const VIEW_LOW := Color(0.72, 0.28, 0.20)
const VIEW_MID := Color(0.84, 0.73, 0.38)
const VIEW_HIGH := Color(0.47, 0.62, 0.34)
const INK := Color(0.16, 0.10, 0.04, 0.95)
const LABEL_INK := Color(0.12, 0.08, 0.035, 1.0)
const LABEL_HALO := Color(0.94, 0.89, 0.77, 1.0)

var _plate_sb := StyleBoxFlat.new()


func _ready() -> void:
	_plate_sb.bg_color = Color(0.93, 0.88, 0.74, 0.75)
	_plate_sb.border_color = Color(0.45, 0.36, 0.20, 0.5)
	_plate_sb.set_border_width_all(1)
	_plate_sb.set_corner_radius_all(4)
	_load_assets()
	mouse_filter = Control.MOUSE_FILTER_STOP
	clip_contents = true


func _load_assets() -> void:
	var shape_file := FileAccess.open("res://data/province_shapes.json", FileAccess.READ)
	if shape_file:
		var shape_data = JSON.parse_string(shape_file.get_as_text())
		if shape_data is Dictionary:
			province_shapes = shape_data.get("provinces", {})
			decor = shape_data.get("decor", {})
	for pid in province_shapes:
		var entry: Dictionary = province_shapes[pid]
		var polygons: Array = _parse_polys(entry.get("polys", []))
		_province_polys[pid] = polygons
		_province_bounds[pid] = _polygons_bounds(polygons)
		_province_drawable[pid] = []
		for polygon in polygons:
			_province_drawable[pid].append(Geometry2D.triangulate_polygon(polygon).size() >= 3)
	var world_file := FileAccess.open("res://data/world_regions.json", FileAccess.READ)
	if world_file:
		var world_data = JSON.parse_string(world_file.get_as_text())
		if world_data is Array:
			world_regions = world_data
	for region in world_regions:
		if not region is Dictionary:
			continue
		var world_polygons: Array = []
		for ring in region.get("rings", []):
			if ring is Array:
				world_polygons.append(_world_polygon(ring))
		var rid := str(region.get("id", ""))
		_world_polys[rid] = world_polygons
		_world_bounds[rid] = _polygons_bounds(world_polygons)
		_world_drawable[rid] = []
		for polygon in world_polygons:
			_world_drawable[rid].append(Geometry2D.triangulate_polygon(polygon).size() >= 3)
		_world_label_centers[rid] = _world_label_center_from_polygons(world_polygons)
	var layout_file := FileAccess.open("res://data/label_layout.json", FileAccess.READ)
	if layout_file:
		var layout_data = JSON.parse_string(layout_file.get_as_text())
		if layout_data is Dictionary:
			label_layout = layout_data.get("labels", {})
	for pid in _province_polys:
		var anchor := _province_label_anchor(pid)
		labels[pid] = [anchor.x / MAP_SIZE.x, anchor.y / MAP_SIZE.y]
		if gs != null:
			for province in gs.provinces:
				if str(province.get("id", "")) == str(pid):
					_province_names[pid] = str(province.get("map_name", province.get("name", "")))
					break
	sync_uniforms()

func _process(_delta: float) -> void:
	if not _hover_pending:
		return
	var now := Time.get_ticks_msec()
	if now - _last_hover_check < HOVER_INTERVAL_MS:
		return
	_hover_pending = false
	_last_hover_check = now
	_refresh_hover()

func _parse_polys(raw: Array) -> Array:
	var result := []
	for ring in raw:
		if not ring is Array or ring.size() < 3:
			continue
		var poly := PackedVector2Array()
		for point in ring:
			if point is Array and point.size() >= 2:
				poly.append(Vector2(float(point[0]) * MAP_SIZE.x, float(point[1]) * MAP_SIZE.y))
		if poly.size() >= 3:
			result.append(poly)
	return result


func _polygons_bounds(polygons: Array) -> Rect2:
	var bounds := Rect2()
	var initialized := false
	for polygon in polygons:
		for point in polygon:
			if not initialized:
				bounds = Rect2(point, Vector2.ZERO)
				initialized = true
			else:
				bounds = bounds.expand(point)
	return bounds


func _province_label_anchor(pid: String) -> Vector2:
	var polygons: Array = _province_polys.get(pid, [])
	if polygons.is_empty():
		return MAP_SIZE * 0.5
	var bounds: Rect2 = _province_bounds.get(pid, Rect2())
	var center := bounds.get_center()
	for polygon in polygons:
		if Geometry2D.is_point_in_polygon(center, polygon):
			return center
	var average := Vector2.ZERO
	var count := 0
	for polygon in polygons:
		for point in polygon:
			average += point
			count += 1
	if count > 0:
		average /= count
		for polygon in polygons:
			if Geometry2D.is_point_in_polygon(average, polygon):
				return average
	return center

## 矢量地图不再使用 Shader；状态改变时只触发一次重绘。
func sync_uniforms() -> void:
	queue_redraw()


func set_render_quality(value: String) -> void:
	render_quality = value if value in ["low", "medium", "high"] else "high"
	queue_redraw()


# ---------- 相机 ----------
func _cam_top() -> Vector2:
	return cam_center - size * 0.5 / zoom

func to_screen(mp: Vector2) -> Vector2:
	return (mp - _cam_top()) * zoom

func to_map(sp: Vector2) -> Vector2:
	return sp / zoom + _cam_top()

func clamp_cam() -> void:
	var half := size * 0.5 / zoom
	cam_center.x = clampf(cam_center.x, minf(half.x, MAP_SIZE.x / 2), maxf(MAP_SIZE.x - half.x, MAP_SIZE.x / 2))
	cam_center.y = clampf(cam_center.y, minf(half.y, MAP_SIZE.y / 2), maxf(MAP_SIZE.y - half.y, MAP_SIZE.y / 2))

func zoom_at(factor: float, anchor_screen: Vector2) -> void:
	var before := to_map(anchor_screen)
	zoom = clampf(zoom * factor, ZOOM_MIN, ZOOM_MAX)
	cam_center = before + size * 0.5 / zoom - anchor_screen / zoom
	clamp_cam()
	_label_size_cache.clear()
	_hover_pending = true
	queue_redraw()

func zoom_step(factor: float) -> void:
	zoom_at(factor, size / 2.0)

func reset_cam() -> void:
	zoom = 1.0
	cam_center = MAP_SIZE / 2.0
	_label_size_cache.clear()
	_hover_pending = true
	queue_redraw()

# ---------- 几何命中 ----------
func _province_at(screen_pos: Vector2) -> String:
	var mp := to_map(screen_pos)
	for pid in _province_polys:
		if not _province_bounds[pid].has_point(mp):
			continue
		for polygon in _province_polys[pid]:
			if Geometry2D.is_point_in_polygon(mp, polygon):
				return str(pid)
	return _world_at(mp)

func _world_at(mp: Vector2) -> String:
	for region in world_regions:
		if not region is Dictionary:
			continue
		var rid := str(region.get("id", ""))
		if not _world_bounds.get(rid, Rect2()).has_point(mp):
			continue
		var polygons: Array = _world_polys.get(rid, [])
		for polygon in polygons:
			if Geometry2D.is_point_in_polygon(mp, polygon):
				return rid
	return ""

func _world_color(region: Dictionary) -> Color:
	var faction := str(region.get("faction", ""))
	return WORLD_TINT.get(faction, Color("8c806d"))

func _world_polygon(ring: Array) -> PackedVector2Array:
	var polygon := PackedVector2Array()
	for point in ring:
		if point is Array and point.size() >= 2:
			var map_point := Vector2(float(point[0]) * MAP_SIZE.x, float(point[1]) * MAP_SIZE.y)
			if polygon.is_empty() or polygon[-1].distance_to(map_point) > 0.5:
				polygon.append(map_point)
	if polygon.size() > 1 and polygon[0].distance_to(polygon[-1]) <= 0.5:
		polygon.remove_at(polygon.size() - 1)
	return polygon

func _world_label_center_from_polygons(polygons: Array) -> Vector2:
	# 外部区域可能是狭长半岛或多岛集合，不能直接使用包围盒中心。
	var best := Vector2(-10000, -10000)
	var best_area := 0.0
	for polygon in polygons:
		if not polygon is PackedVector2Array or polygon.size() < 3:
			continue
		var twice_area := 0.0
		var centroid := Vector2.ZERO
		for i in polygon.size():
			var a: Vector2 = polygon[i]
			var b: Vector2 = polygon[(i + 1) % polygon.size()]
			var cross := a.x * b.y - b.x * a.y
			twice_area += cross
			centroid += (a + b) * cross
		var area: float = abs(twice_area) * 0.5
		if area <= 0.000001:
			continue
		var candidate := centroid / (3.0 * twice_area)
		if area > best_area and Geometry2D.is_point_in_polygon(candidate, polygon):
			best = candidate
			best_area = area
	if best.x > -1000:
		return best
	var bounds := _polygons_bounds(polygons)
	if bounds.size != Vector2.ZERO:
		var center := bounds.get_center()
		for polygon in polygons:
			if polygon is PackedVector2Array and Geometry2D.is_point_in_polygon(center, polygon):
				return center
		# 质心退化时取最大轮廓的顶点均值，仍比跨海包围盒中心稳定。
		var largest := PackedVector2Array()
		for polygon in polygons:
			if polygon is PackedVector2Array and polygon.size() > largest.size():
				largest = polygon
		if largest.size() >= 3:
			var average := Vector2.ZERO
			for point in largest:
				average += point
			average /= largest.size()
			if Geometry2D.is_point_in_polygon(average, largest):
				return average
	return Vector2(-10000, -10000)

func _draw_world_regions() -> void:
	for region in world_regions:
		if not region is Dictionary:
			continue
		var rid := str(region.get("id", ""))
		var color := _world_color(region)
		if rid == hovered:
			color = color.lightened(0.16)
		if rid == selected:
			color = Color("a64b38")
		var polygons: Array = _world_polys.get(rid, [])
		var drawable: Array = _world_drawable.get(rid, [])
		for i in polygons.size():
			if drawable[i]:
				draw_colored_polygon(polygons[i], Color(color, 0.48))
				draw_polyline(polygons[i], Color(0.19, 0.14, 0.08, 0.78), 1.5, render_quality != "low")

# ---------- 绘制 ----------
func _draw() -> void:
	draw_set_transform(-_cam_top() * zoom, 0, Vector2(zoom, zoom))
	draw_rect(Rect2(Vector2.ZERO, MAP_SIZE), Color("d9cfad"))
	_draw_world_regions()
	for pid in _province_polys:
		var color := _province_color(str(pid))
		if pid == hovered:
			color = color.lightened(0.14)
		if pid == selected:
			color = Color("a64b38")
		var polygons: Array = _province_polys[pid]
		var drawable: Array = _province_drawable[pid]
		for i in polygons.size():
			if drawable[i]:
				draw_colored_polygon(polygons[i], color)
				draw_polyline(polygons[i], INK, 1.5, render_quality != "low")
	draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)
	_draw_province_labels()
	_draw_world_labels()
	_draw_decor_labels()
	_draw_dynamic_labels()

func _province_color(pid: String) -> Color:
	if gs != null:
		for p in gs.provinces:
			if str(p.get("id", "")) == pid:
				if view_mode in ["pop", "finance", "tax", "disaster", "war"]:
					var value := _province_view_value(p)
					if view_mode == "disaster" or view_mode == "war":
						return VIEW_HIGH.lerp(VIEW_LOW, value)
					return VIEW_LOW.lerp(VIEW_HIGH, value)
				return FACTION_TINT.get(str(p.get("owner", "ming")), Color("a98d57"))
	return Color("a98d57")


func _province_view_value(p: Dictionary) -> float:
	match view_mode:
		"pop":
			return clampf(float(p.get("pop", 0.0)) / 100.0, 0.0, 1.0)
		"finance":
			return clampf(float(p.get("tax", 0.0)) / 20.0, 0.0, 1.0)
		"tax":
			var effective_tax := float(p.get("tax", 0.0)) * (0.5 + float(p.get("pop", 0.0)) / 100.0)
			return clampf(effective_tax / 30.0, 0.0, 1.0)
		"disaster":
			var hardship := (55.0 - float(p.get("pop", 0.0))) * 1.7
			var disaster_unrest := (50.0 - float(p.get("morale", 0.0))) * 0.4
			return clampf((hardship + disaster_unrest) / 100.0, 0.0, 1.0)
		"war":
			if str(p.get("owner", "ming")) != "ming":
				return 1.0
			var war_unrest := (50.0 - float(p.get("morale", 0.0))) * 0.8
			return clampf((war_unrest + float(p.get("garrison", 0.0)) * 0.25) / 100.0, 0.0, 1.0)
	return 0.0

func _id_matches_point(screen_point: Vector2, pid: String) -> bool:
	var mp := to_map(screen_point)
	for polygon in _province_polys.get(pid, []):
		if Geometry2D.is_point_in_polygon(mp, polygon):
			return true
	return false


func _label_fits(center: Vector2, text_size: Vector2, pid: String, angle: float) -> bool:
	var half := text_size * 0.5 + Vector2(3, 3)
	var corners := [Vector2(-half.x, -half.y), Vector2(half.x, -half.y), Vector2(half.x, half.y), Vector2(-half.x, half.y)]
	for corner in corners:
		if not _id_matches_point(center + corner.rotated(angle), pid):
			return false
	return true


func _draw_label(center: Vector2, text: String, font_size: int, angle: float) -> void:
	var width := map_font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
	var baseline := Vector2(-width * 0.5, font_size * 0.36)
	draw_set_transform(center, angle, Vector2.ONE)
	draw_string(map_font, baseline + Vector2(1, 1), text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, LABEL_HALO)
	draw_string(map_font, baseline, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, LABEL_INK)
	draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)


func _draw_gansu_label(center: Vector2, font_size: int, angle: float) -> void:
	var first_width := map_font.get_string_size("甘", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
	var second_width := map_font.get_string_size("肃", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
	var first_pos := Vector2(-(first_width + second_width) * 0.5, font_size * 0.36)
	var second_origin := center + Vector2((first_width + second_width) * 0.18, 2.0).rotated(angle)
	draw_set_transform(center, angle, Vector2.ONE)
	draw_string(map_font, first_pos + Vector2(1, 1), "甘", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, LABEL_HALO)
	draw_string(map_font, first_pos, "甘", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, LABEL_INK)
	draw_set_transform(second_origin, angle + deg_to_rad(10.0), Vector2.ONE)
	draw_string(map_font, Vector2(1, font_size * 0.36 + 1), "肃", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, LABEL_HALO)
	draw_string(map_font, Vector2.ZERO + Vector2(0, font_size * 0.36), "肃", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, LABEL_INK)
	draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)


func _draw_province_labels() -> void:
	if map_font == null or gs == null:
		return
	for pid in labels:
		var name := str(_province_names.get(pid, ""))
		if name == "":
			for p in gs.provinces:
				if str(p.get("id", "")) == str(pid):
					name = str(p.get("map_name", p.get("name", "")))
					break
		if name == "":
			continue
		var layout: Dictionary = label_layout.get(pid, {})
		var lb: Array = layout.get("anchor", labels.get(pid, [0.5, 0.5]))
		var center := to_screen(Vector2(float(lb[0]) * MAP_SIZE.x, float(lb[1]) * MAP_SIZE.y))
		var default_angle := 28.0 if pid == "gansu" else 0.0
		var angle := deg_to_rad(float(layout.get("angle", default_angle)))
		var default_size := 30 if pid == "gansu" else 26
		var requested_size := int(layout.get("size", default_size))
		var cache_key := "%s:%0.2f" % [pid, zoom]
		var font_size := int(_label_size_cache.get(cache_key, 0))
		if font_size <= 0:
			font_size = requested_size
			while font_size >= 15:
				var text_size := map_font.get_string_size(name, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
				if _label_fits(center, text_size, pid, angle):
					break
				font_size -= 2
			# Never hide a province name just because the glyph box crosses a coast.
			font_size = maxi(font_size, 15)
			_label_size_cache[cache_key] = font_size
		if pid == "gansu":
			_draw_gansu_label(center, font_size, angle)
		else:
			_draw_label(center, name, font_size, angle)


func _decor_point(value) -> Vector2:
	if value is Array and value.size() >= 2:
		return to_screen(Vector2(float(value[0]) * MAP_SIZE.x, float(value[1]) * MAP_SIZE.y))
	return Vector2(-10000, -10000)


func _world_label_center(region: Dictionary) -> Vector2:
	var map_center: Vector2 = _world_label_centers.get(str(region.get("id", "")), Vector2(-10000, -10000))
	if map_center.x < -1000:
		return map_center
	return to_screen(map_center)

func _draw_world_labels() -> void:
	if map_font == null:
		return
	for region in world_regions:
		if not region is Dictionary:
			continue
		var center := _world_label_center(region)
		if center.x < -1000:
			continue
		var rid := str(region.get("id", ""))
		var name := str(region.get("name", ""))
		var font_size := 24
		if rid in ["mongolia", "tatar", "manchuria"]:
			font_size = 29
		var angle := deg_to_rad(float(region.get("angle", 0.0)))
		_draw_label(center, name, font_size, angle)


func _draw_decor_labels() -> void:
	if map_font == null or not decor is Dictionary:
		return
	for item in decor.get("neighbors", []):
		if item is Dictionary:
			_draw_label(_decor_point(item.get("pos", [])), str(item.get("text", "")), 20, 0.0)
	for item in decor.get("seas", []):
		if item is Dictionary:
			_draw_label(_decor_point(item.get("pos", [])), str(item.get("text", "")), 22, float(item.get("tilt", 0.0)))
	for item in decor.get("ports", []):
		if item is Dictionary:
			var point := _decor_point(item.get("pos", []))
			draw_circle(point, 4.0, Color(0.24, 0.16, 0.08, 0.8))
			_draw_label(point + Vector2(0, 20), str(item.get("text", "")), 15, 0.0)


func _draw_dynamic_labels() -> void:
	if map_font == null or gs == null:
		return
	# 放大且悬停/选中该省时，才在省名下方显示小号墨字（无底衬，浅色描影）
	if zoom < 1.4:
		return
	for p in gs.provinces:
		if p["id"] != hovered and p["id"] != selected:
			continue
		if not labels.has(p["id"]):
			continue
		var lb: Array = labels[p["id"]]
		var lp := to_screen(Vector2(lb[0] * MAP_SIZE.x, lb[1] * MAP_SIZE.y))
		if lp.x < -100 or lp.x > size.x + 100 or lp.y < -40 or lp.y > size.y + 40:
			continue
		var sub := "%d万 军%d 民%d" % [int(p["garrison"]), int(p["morale"]), int(p["pop"])]
		var stw: float = map_font.get_string_size(sub, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x
		var tp := lp + Vector2(-stw / 2, 44)
		draw_string(map_font, tp + Vector2(1, 1), sub, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.94, 0.89, 0.75, 0.85))
		draw_string(map_font, tp, sub, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.22, 0.15, 0.07, 0.95))

# ---------- 输入 ----------
func _refresh_hover() -> void:
	var pid := _province_at(_last_mouse)
	if pid == hovered:
		return
	hovered = pid
	sync_uniforms()
	queue_redraw()

func _gui_input(event: InputEvent) -> void:
	if gs == null:
		return
	if event is InputEventMouseMotion:
		if not _pressing and event.position.distance_squared_to(_last_hover_position) < 4.0:
			return
		_last_mouse = event.position
		_last_hover_position = event.position
		if _pressing:
			var delta: Vector2 = event.position - _press_screen
			if not _dragging and delta.length() > 8.0:
				_dragging = true
			if _dragging:
				cam_center = _press_cam - delta / zoom
				clamp_cam()
				queue_redraw()
		else:
			_hover_pending = true
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
			zoom_at(1.15, event.position)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			zoom_at(1.0 / 1.15, event.position)
		elif event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_pressing = true
				_dragging = false
				_press_screen = event.position
				_press_cam = cam_center
			else:
				_pressing = false
				if not _dragging:
					var pid := _province_at(event.position)
					if pid != "" and on_select.is_valid():
						selected = pid
						sync_uniforms()
						on_select.call(pid)
				_dragging = false
		elif event.button_index == MOUSE_BUTTON_RIGHT and not event.pressed:
			if not _dragging:
				var pid := _province_at(event.position)
				if pid != "" and on_context.is_valid():
					selected = pid
					sync_uniforms()
					on_context.call(pid)
			_dragging = false
