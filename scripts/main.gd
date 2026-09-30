extends Control
## 山河永驻 —— 主界面：整幅做旧羊皮纸舆图 + 政令菜单（对标《历史模拟器：崇祯》画面）

# ---------- 画 ----------
const COL_PAPER := Color("e3d2a4")
const COL_PAPER_DARK := Color("cdb887")
const COL_INK := Color("3a2c1a")
const COL_INK_SOFT := Color("6b5638")
const COL_SEAL := Color("a5382a")
const COL_GOLD := Color("2b2318")              # 原「金」色全部转为墨色
const COL_PAPER_UI := Color(0.937, 0.902, 0.816, 0.95)   # #efe6d0 宣纸
const COL_INK_UI := Color("2b2318")
const COL_INK_GREY := Color("6b6154")
const COL_PLAQUE := COL_PAPER_UI
const COL_PLAQUE_BORDER := Color(0.16, 0.13, 0.09, 0.7)
const COL_UI_TEXT := Color(0.12, 0.09, 0.05, 1.0)
const COL_UI_PAPER := Color(0.94, 0.90, 0.82, 1.0)

const OWNER_FILL := {
	"ming": Color("d3af4e"),
	"jin": Color("7d7486"),
	"rebel": Color("bf5b40"),
}
const OWNER_NAMES := {"ming": "大明", "jin": "后金", "rebel": "流寇"}

# 省份多边形（归一化坐标，顺时针，手工近似明末舆图）
const PROV_POLYS := {
	"gansu": [[0.150,0.130],[0.240,0.108],[0.305,0.140],[0.335,0.205],[0.318,0.278],[0.268,0.292],[0.218,0.242],[0.168,0.188]],
	"shaanxi": [[0.335,0.205],[0.372,0.168],[0.415,0.188],[0.428,0.288],[0.408,0.398],[0.352,0.428],[0.325,0.358],[0.316,0.278]],
	"shanxi": [[0.372,0.168],[0.425,0.156],[0.448,0.232],[0.428,0.288],[0.372,0.288],[0.352,0.228]],
	"jingzhi": [[0.425,0.156],[0.470,0.132],[0.528,0.118],[0.558,0.152],[0.538,0.212],[0.492,0.248],[0.448,0.232]],
	"liaodong": [[0.528,0.118],[0.588,0.096],[0.626,0.128],[0.606,0.176],[0.556,0.192],[0.528,0.152]],
	"shandong": [[0.492,0.248],[0.538,0.212],[0.578,0.242],[0.586,0.288],[0.546,0.322],[0.500,0.308],[0.478,0.276]],
	"henan": [[0.428,0.288],[0.478,0.276],[0.500,0.308],[0.516,0.352],[0.486,0.396],[0.438,0.376],[0.418,0.332]],
	"sichuan": [[0.258,0.332],[0.318,0.290],[0.352,0.345],[0.346,0.422],[0.312,0.472],[0.266,0.442],[0.242,0.385]],
	"huguang": [[0.352,0.428],[0.408,0.398],[0.438,0.376],[0.486,0.396],[0.506,0.442],[0.490,0.500],[0.442,0.532],[0.390,0.516],[0.360,0.470]],
	"nanzhili": [[0.486,0.396],[0.516,0.352],[0.552,0.376],[0.580,0.420],[0.568,0.476],[0.528,0.498],[0.506,0.442]],
	"zhejiang": [[0.528,0.498],[0.568,0.476],[0.604,0.502],[0.608,0.546],[0.568,0.566],[0.536,0.536]],
	"jiangxi": [[0.490,0.500],[0.528,0.498],[0.536,0.536],[0.546,0.590],[0.514,0.626],[0.474,0.600],[0.464,0.545]],
	"fujian": [[0.568,0.566],[0.608,0.546],[0.638,0.576],[0.632,0.626],[0.596,0.646],[0.550,0.616],[0.546,0.590]],
	"guangdong": [[0.474,0.600],[0.514,0.626],[0.550,0.616],[0.596,0.646],[0.590,0.686],[0.544,0.710],[0.494,0.695],[0.458,0.655]],
	"guangxi": [[0.418,0.572],[0.464,0.545],[0.474,0.600],[0.458,0.655],[0.412,0.665],[0.382,0.620],[0.392,0.590]],
	"guizhou": [[0.372,0.498],[0.420,0.472],[0.464,0.545],[0.418,0.572],[0.372,0.558],[0.352,0.528]],
	"yunnan": [[0.300,0.528],[0.372,0.498],[0.372,0.558],[0.382,0.620],[0.345,0.662],[0.298,0.635],[0.272,0.575]],
}

# 海面波纹位置（归一化）
const WAVES := [[0.70,0.10],[0.78,0.18],[0.86,0.10],[0.72,0.28],[0.82,0.34],[0.90,0.24],[0.76,0.44],[0.68,0.38],[0.88,0.46],[0.94,0.60],[0.70,0.60],[0.80,0.72],[0.92,0.80],[0.66,0.76],[0.10,0.72],[0.06,0.86],[0.16,0.90],[0.60,0.88]]

var gs: Node
var theme_font: SystemFont

var map_canvas  # map_canvas.gd 实例
var top_chips := {}
var action_label: Label
var date_label: Label
var info_panel: Control
var info_text: RichTextLabel
var selected_province := ""
var paper_tex: ImageTexture
var overlay_layer: Control = null
var start_screen: Control = null
var toast_label: Label
var _toast_wrap: PanelContainer
var top_plaque: Control
var right_menu: Control
var status_view_buttons := {}
var task_button: Button
var left_banner: Control
var ai_status_label: Label
var local_settings := {"quality": "high", "fps": 60}
var settings_dialog: Control = null
const LOCAL_SETTINGS_PATH := "user://settings.json"

var sfx_click: AudioStreamPlayer
var sfx_bell: AudioStreamPlayer
var sfx_war: AudioStreamPlayer

# AI 生成素材（缺失时回退纯色样式）
var ui_btn_normal: StyleBoxTexture
var ui_btn_hover: StyleBoxTexture
var ui_panel_sb: StyleBoxTexture
var ui_dialog_sb: StyleBoxTexture
var icons := {}   # name -> Texture2D


func _load_ui_assets() -> void:
	ui_btn_normal = _tex_style("res://assets/icons/ui_btn.png", 16, Vector2i(480, 72))
	ui_btn_hover = _tex_style("res://assets/icons/ui_btn_hover.png", 16, Vector2i(480, 72))
	ui_panel_sb = _tex_style("res://assets/icons/ui_panel.png", 16, Vector2i(720, 107))
	ui_dialog_sb = _tex_style("res://assets/icons/ui_dialog.png", 60, Vector2i(960, 480))
	for n in ["icon_yin", "icon_min", "icon_jun", "icon_chao", "icon_kou", "icon_jin", "seal_yz"]:
		var p := "res://assets/icons/%s.png" % n
		if ResourceLoader.exists(p):
			icons[n] = load(p)


func _tex_style(path: String, margin: int, resize_to: Vector2i) -> StyleBoxTexture:
	if not ResourceLoader.exists(path) or FileAccess.get_file_as_bytes(path).is_empty():
		return null
	var t: Texture2D = load(path)
	if t == null:
		return null
	var img: Image = t.get_image()
	if img == null:
		return null
	if img.is_compressed():
		img.decompress()
	img.resize(resize_to.x, resize_to.y, Image.INTERPOLATE_LANCZOS)
	var st := ImageTexture.create_from_image(img)
	var sb := StyleBoxTexture.new()
	sb.texture = st
	for side in [SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM]:
		sb.set_texture_margin(side, margin)
	return sb


func _icon(name: String, size := 22.0) -> Control:
	if icons.has(name):
		var tr := TextureRect.new()
		tr.texture = icons[name]
		tr.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
		tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		tr.custom_minimum_size = Vector2(size, size)
		tr.size = Vector2(size, size)
		return tr
	return null


func _ready() -> void:
	gs = get_node("/root/GameState")
	_load_local_settings()
	theme_font = SystemFont.new()
	theme_font.font_names = PackedStringArray(["LXGW WenKai", "楷体", "KaiTi", "Microsoft YaHei UI", "SimHei", "sans-serif"])
	var th := Theme.new()
	th.default_font = theme_font
	th.default_font_size = 17
	_apply_base_theme(th)
	theme = th
	_apply_display_settings()
	_adapt_window()
	_make_paper_texture()
	_build_audio()
	_load_ui_assets()
	_build_ui()
	_connect_signals()
	_refresh_all()
	if not gs.get("booted"):
		gs.set("booted", true)
		_show_start_screen()


func _load_local_settings() -> void:
	if not FileAccess.file_exists(LOCAL_SETTINGS_PATH):
		return
	var file := FileAccess.open(LOCAL_SETTINGS_PATH, FileAccess.READ)
	if file == null:
		return
	var data = JSON.parse_string(file.get_as_text())
	if data is Dictionary:
		local_settings["quality"] = str(data.get("quality", "high"))
		local_settings["fps"] = int(data.get("fps", 60))


func _save_local_settings() -> void:
	var file := FileAccess.open(LOCAL_SETTINGS_PATH, FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(local_settings, "  "))


func _apply_display_settings() -> void:
	var fps := int(local_settings.get("fps", 60))
	Engine.max_fps = maxi(0, fps)
	var quality := str(local_settings.get("quality", "high"))
	var filter := CanvasItem.TEXTURE_FILTER_NEAREST if quality == "low" else CanvasItem.TEXTURE_FILTER_LINEAR
	texture_filter = filter
	if map_canvas:
		map_canvas.texture_filter = filter
		map_canvas.set_render_quality(quality)


func _quality_text(value: String) -> String:
	return {"low": "低 · 省电", "medium": "中 · 平衡", "high": "高 · 细节"}.get(value, "高 · 细节")


func _fps_text(value: int) -> String:
	return "不限" if value <= 0 else "%d FPS" % value


func _write_model_config(base_url_value: String, api_key_value: String, model_value: String) -> bool:
	var data: Dictionary = {
		"base_url": base_url_value.strip_edges(),
		"api_key": api_key_value.strip_edges(),
		"model": model_value.strip_edges(),
		"prompt_cache_ttl_seconds": 45,
		"prompt_cache_max_entries": 64,
		"enable_prompt_cache": false,
		"prompt_cache_key": ""
	}
	var file := FileAccess.open("user://config.json", FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(data, "  "))
	LLMClient.reload_config()
	return true


func _play_click() -> void:
	if sfx_click:
		sfx_click.play()


func _build_audio() -> void:
	sfx_click = _make_sfx("res://assets/audio/click.ogg", -6.0)
	sfx_bell = _make_sfx("res://assets/audio/bell.ogg", -4.0)
	sfx_war = _make_sfx("res://assets/audio/war.ogg", -5.0)


func _make_sfx(path: String, db := 0.0) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	if ResourceLoader.exists(path):
		p.stream = load(path)
	p.volume_db = db
	add_child(p)
	return p


func _adapt_window() -> void:
	var screen := DisplayServer.screen_get_size(DisplayServer.window_get_current_screen())
	if screen.x < 100:
		return
	var h := mini(720, screen.y - 120)
	var w := mini(1280, mini(screen.x - 60, h * 16 / 9))
	DisplayServer.window_set_size(Vector2i(w, h))
	DisplayServer.window_set_position(Vector2i((screen.x - w) / 2, (screen.y - h) / 2))


# ================= 纸纹 =================
func _make_paper_texture() -> void:
	var img := Image.create(384, 384, false, Image.FORMAT_RGB8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 20260830
	for y in 384:
		for x in 384:
			var n := rng.randf_range(-0.045, 0.045)
			var blotch := sin(x * 0.021) * cos(y * 0.017) * 0.03
			var c := COL_PAPER.lightened(n + blotch)
			img.set_pixel(x, y, c)
	paper_tex = ImageTexture.create_from_image(img)


func _bg_texture() -> Texture2D:
	if ResourceLoader.exists("res://assets/tex/parchment_big.jpg"):
		return load("res://assets/tex/parchment_big.jpg")
	return paper_tex


func _paper_stylebox() -> StyleBox:
	# 统一使用不透明程序化宣纸，避免九宫格纹理缩放产生脏边。
	var flat := StyleBoxFlat.new()
	flat.bg_color = COL_PAPER_UI
	flat.border_color = Color(0.16, 0.13, 0.09, 0.25)
	flat.set_border_width_all(1)
	flat.set_content_margin_all(28)
	# 弹窗纸面加淡墨投影，增强悬浮层次
	flat.shadow_color = Color(0.10, 0.08, 0.05, 0.40)
	flat.shadow_size = 14
	flat.shadow_offset = Vector2(0, 5)
	return flat


# ================= UI 骨架 =================
func _build_ui() -> void:
	var bg := TextureRect.new()
	bg.texture = _bg_texture()
	bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	# 舆图画布（预渲染底图 + ID shader 交互）
	map_canvas = preload("res://scripts/map_canvas.gd").new()
	map_canvas.gs = gs
	map_canvas.map_font = theme_font
	map_canvas.on_select = _on_map_select
	map_canvas.on_context = _on_map_context
	map_canvas.tooltip_text = "左键查看当地信息，右键打开可执行操作"
	map_canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	map_canvas.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(map_canvas)

	_build_top_plaque()
	_build_right_menu()
	_build_bottom_buttons()
	_build_info_panel()
	_build_left_banner()

	# 快报：窄宣纸条 + 墨字，替代裸文字
	toast_label = Label.new()
	toast_label.add_theme_font_override("font", theme_font)
	toast_label.add_theme_font_size_override("font_size", 19)
	toast_label.add_theme_color_override("font_color", COL_INK_UI)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var toast_wrap := PanelContainer.new()
	toast_wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toast_wrap.add_theme_stylebox_override("panel", _plaque_style(Color(0.16, 0.13, 0.09, 0.30), Color(0.955, 0.925, 0.855, 0.94), 2, true))
	toast_wrap.set_anchors_preset(Control.PRESET_TOP_WIDE)
	toast_wrap.offset_left = 480
	toast_wrap.offset_right = -480
	toast_wrap.offset_top = 120
	toast_wrap.offset_bottom = 154
	toast_wrap.add_child(toast_label)
	toast_wrap.modulate.a = 0.0
	add_child(toast_wrap)
	_toast_wrap = toast_wrap
	_build_safe_layout()
	_apply_display_settings()


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED:
		_build_safe_layout()


func _build_safe_layout() -> void:
	if top_plaque:
		top_plaque.position = Vector2(14, 12)
	if right_menu:
		right_menu.position = Vector2(maxf(14.0, size.x - right_menu.custom_minimum_size.x - 18.0), 158)
	if task_button:
		task_button.position = Vector2((size.x - task_button.custom_minimum_size.x) * 0.5, size.y - task_button.custom_minimum_size.y - 18.0)
	if left_banner:
		left_banner.position = Vector2(14, clampf(size.y * 0.38, 180.0, size.y - 300.0))
	if info_panel:
		info_panel.position = Vector2(84, maxf(120.0, size.y - info_panel.custom_minimum_size.y - 30.0))


func _plaque_style(border := COL_PLAQUE_BORDER, bg := COL_PLAQUE, radius := 2, shadow := false) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(radius)
	sb.set_content_margin_all(8)
	if shadow:
		sb.shadow_color = Color(0.10, 0.08, 0.05, 0.30)
		sb.shadow_size = 7
		sb.shadow_offset = Vector2(0, 3)
	return sb


func _focus_style() -> StyleBoxFlat:
	# 键盘焦点用朱红细线替代默认亮框
	var sb := StyleBoxFlat.new()
	sb.draw_center = false
	sb.border_color = Color(0.65, 0.22, 0.16, 0.45)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(2)
	return sb


func _apply_base_theme(th: Theme) -> void:
	# 细墨滚动条，替换默认灰蓝条
	var track := StyleBoxFlat.new()
	track.bg_color = Color(0.23, 0.18, 0.12, 0.10)
	var grab := StyleBoxFlat.new()
	grab.bg_color = Color(0.43, 0.36, 0.25, 0.50)
	grab.set_corner_radius_all(3)
	var grab_hl := StyleBoxFlat.new()
	grab_hl.bg_color = Color(0.43, 0.36, 0.25, 0.75)
	grab_hl.set_corner_radius_all(3)
	for t in ["VScrollBar", "HScrollBar"]:
		th.set_stylebox("scroll", t, track)
		th.set_stylebox("grabber", t, grab)
		th.set_stylebox("grabber_highlight", t, grab_hl)
		th.set_stylebox("grabber_pressed", t, grab_hl)
	# 输入控件纸面化：宣纸底、墨字、朱红焦点线
	var focus := _focus_style()
	var line := StyleBoxFlat.new()
	line.bg_color = Color(0.97, 0.94, 0.87, 0.92)
	line.border_color = Color(0.16, 0.13, 0.09, 0.35)
	line.set_border_width_all(1)
	line.set_corner_radius_all(2)
	line.set_content_margin_all(8)
	var edit_sb := StyleBoxFlat.new()
	edit_sb.bg_color = Color(0.965, 0.935, 0.865, 0.92)
	edit_sb.border_color = Color(0.16, 0.13, 0.09, 0.35)
	edit_sb.set_border_width_all(1)
	edit_sb.set_corner_radius_all(2)
	edit_sb.set_content_margin_all(10)
	for t in ["LineEdit", "TextEdit"]:
		th.set_stylebox("normal", t, edit_sb if t == "TextEdit" else line)
		th.set_stylebox("focus", t, focus)
		th.set_color("font_color", t, COL_INK_UI)
		th.set_color("caret_color", t, COL_INK)
		th.set_color("placeholder_color", t, Color(0.42, 0.36, 0.28, 0.7))
		th.set_color("selection_color", t, Color(0.65, 0.22, 0.16, 0.25))
	th.set_stylebox("read_only", "TextEdit", edit_sb)
	th.set_color("default_color", "RichTextLabel", COL_INK_UI)


func _plaque_button(text: String, font_size := 17, glyph := "") -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(_play_click)
	b.add_theme_font_override("font", theme_font)
	b.add_theme_font_size_override("font_size", font_size)
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	# 程序化纸面按钮避免九宫格拉伸产生脏边和半透明底。
	b.add_theme_color_override("font_color", COL_UI_TEXT)
	b.add_theme_color_override("font_hover_color", COL_UI_TEXT)
	b.add_theme_color_override("font_pressed_color", COL_INK_GREY)
	b.add_theme_stylebox_override("normal", _plaque_style(COL_PLAQUE_BORDER, COL_UI_PAPER, 2, true))
	b.add_theme_stylebox_override("hover", _plaque_style(COL_SEAL, Color(0.98, 0.94, 0.86, 1.0), 2, true))
	b.add_theme_stylebox_override("pressed", _plaque_style(COL_SEAL, Color(0.88, 0.82, 0.72, 1.0), 2))
	b.focus_mode = Control.FOCUS_ALL
	b.add_theme_stylebox_override("focus", _focus_style())
	# 右缘小朱方章导视（唯一的红）
	if glyph != "":
		var dot := ColorRect.new()
		dot.color = COL_SEAL
		dot.set_anchors_preset(Control.PRESET_LEFT_WIDE)
		dot.offset_left = 10
		dot.offset_right = 18
		dot.offset_top = 0
		dot.offset_bottom = 0
		dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(dot)
	return b


func _seal_chip(ch: String) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = COL_SEAL
	sb.set_corner_radius_all(2)
	sb.set_content_margin_all(0)
	sb.border_color = Color("5c1f18")
	sb.set_border_width_all(1)
	p.add_theme_stylebox_override("panel", sb)
	p.custom_minimum_size = Vector2(24, 24)
	var l := Label.new()
	l.text = ch
	l.add_theme_font_override("font", theme_font)
	l.add_theme_font_size_override("font_size", 14)
	l.add_theme_color_override("font_color", Color("ecd9b0"))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	p.add_child(l)
	return p


func _build_top_plaque() -> void:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", _plaque_style(COL_PLAQUE_BORDER, COL_UI_PAPER, 3))

	p.set_anchors_preset(Control.PRESET_TOP_LEFT)
	p.position = Vector2(14, 12)
	top_plaque = p
	add_child(p)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 18)
	p.add_child(h)

	# 明 · 纸底墨字圆章
	var roundel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.97, 0.94, 0.87, 0.96)
	sb.set_corner_radius_all(19)
	sb.set_content_margin_all(4)
	sb.border_color = Color(0.16, 0.13, 0.09, 0.35)
	sb.set_border_width_all(1)
	roundel.add_theme_stylebox_override("panel", sb)
	var rl := Label.new()
	rl.text = "明"
	rl.add_theme_font_override("font", theme_font)
	rl.add_theme_font_size_override("font_size", 20)
	rl.add_theme_color_override("font_color", COL_INK_UI)
	roundel.add_child(rl)
	h.add_child(roundel)

	date_label = Label.new()
	date_label.add_theme_font_override("font", theme_font)
	date_label.add_theme_font_size_override("font_size", 22)
	date_label.add_theme_color_override("font_color", COL_INK_UI)
	h.add_child(date_label)

	var chips := [
		["treasury", "icon_yin", "库"], ["pop", "icon_min", "民"], ["morale", "icon_jun", "军"],
		["stability", "icon_chao", "朝"], ["rebel", "icon_kou", "寇"], ["jin", "icon_jin", "金"],
	]
	for c in chips:
		var pair := HBoxContainer.new()
		pair.add_theme_constant_override("separation", 5)
		var ic := _icon(c[1], 24)
		if ic:
			pair.add_child(ic)
		else:
			pair.add_child(_seal_chip(c[2]))
		var l := Label.new()
		l.add_theme_font_override("font", theme_font)
		l.add_theme_font_size_override("font_size", 17)
		l.add_theme_color_override("font_color", COL_INK_UI)
		pair.add_child(l)
		h.add_child(pair)
		top_chips[c[0]] = l

	action_label = Label.new()
	action_label.add_theme_font_override("font", theme_font)
	action_label.add_theme_font_size_override("font_size", 17)
	action_label.add_theme_color_override("font_color", Color("9fd08a"))
	h.add_child(action_label)


func _build_right_menu() -> void:
	var box := VBoxContainer.new()
	box.position = Vector2(1920 - 214, 158)
	box.custom_minimum_size = Vector2(200, 0)
	box.add_theme_constant_override("separation", 8)
	right_menu = box
	add_child(box)
	box.add_child(_ink_label("国势视图", 18, COL_INK_SOFT))
	for definition in [["民心", "pop"], ["财政", "finance"], ["税收", "tax"], ["灾害", "disaster"], ["战乱", "war"]]:
		var mode: String = definition[1]
		var vb := _plaque_button(definition[0], 16, definition[0].left(1))
		vb.custom_minimum_size = Vector2(200, 40)
		vb.toggle_mode = true
		vb.pressed.connect(_set_map_view.bind(mode))
		status_view_buttons[mode] = vb
		box.add_child(vb)
	_set_map_view("pop")

	# 缩放控制（＋ / － / 复位）
	var zooms := HBoxContainer.new()
	zooms.add_theme_constant_override("separation", 6)
	box.add_child(zooms)
	var zin := _plaque_button("＋", 18)
	zin.custom_minimum_size = Vector2(64, 36)
	zin.pressed.connect(func(): map_canvas.zoom_step(1.3))
	zooms.add_child(zin)
	var zout := _plaque_button("－", 18)
	zout.custom_minimum_size = Vector2(64, 36)
	zout.pressed.connect(func(): map_canvas.zoom_step(1.0 / 1.3))
	zooms.add_child(zout)
	var zreset := _plaque_button("复位", 14)
	zreset.custom_minimum_size = Vector2(64, 36)
	zreset.pressed.connect(func(): map_canvas.reset_cam())
	zooms.add_child(zreset)


func _set_map_view(mode: String) -> void:
	if map_canvas == null:
		return
	map_canvas.view_mode = mode
	for key in status_view_buttons:
		var button: Button = status_view_buttons[key]
		button.button_pressed = str(key) == mode
	map_canvas.queue_redraw()


func _build_bottom_buttons() -> void:
	var task := _plaque_button("时 政 任 务 · 本季度", 20)
	task.position = Vector2(960 - 150, 1080 - 64)
	task.custom_minimum_size = Vector2(300, 46)
	task.pressed.connect(_show_quarter_tasks)
	task_button = task
	add_child(task)

	ai_status_label = Label.new()
	ai_status_label.add_theme_font_override("font", theme_font)
	ai_status_label.add_theme_font_size_override("font_size", 14)
	ai_status_label.add_theme_color_override("font_color", COL_SEAL if not LLMClient.is_enabled() else COL_INK_SOFT)
	ai_status_label.add_theme_color_override("font_shadow_color", Color(0.94, 0.91, 0.83, 0.85))
	ai_status_label.add_theme_constant_override("shadow_offset_x", 1)
	ai_status_label.add_theme_constant_override("shadow_offset_y", 1)
	ai_status_label.text = "AI 推演未连接：核心回合已锁定" if not LLMClient.is_enabled() else "AI 推演已连接"
	ai_status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ai_status_label.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	ai_status_label.offset_top = -92
	ai_status_label.offset_bottom = -66
	add_child(ai_status_label)


func _build_left_banner() -> void:
	var b := _plaque_button("条\n陈\n奏\n疏", 19)
	b.position = Vector2(14, 400)
	b.custom_minimum_size = Vector2(52, 210)
	b.pressed.connect(func(): _show_log())
	left_banner = b
	add_child(b)


func _build_info_panel() -> void:
	info_panel = PanelContainer.new()
	info_panel.add_theme_stylebox_override("panel", _plaque_style())
	info_panel.position = Vector2(84, 1080 - 260)
	info_panel.custom_minimum_size = Vector2(330, 236)
	info_panel.visible = false
	add_child(info_panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	info_panel.add_child(v)
	info_text = RichTextLabel.new()
	info_text.bbcode_enabled = true
	info_text.add_theme_font_override("normal_font", theme_font)
	info_text.add_theme_font_size_override("normal_font_size", 16)
	info_text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(info_text)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 8)
	v.add_child(h)
	var cl := _plaque_button("关闭", 16)
	cl.pressed.connect(func():
		selected_province = ""
		info_panel.visible = false
		map_canvas.queue_redraw())
	h.add_child(cl)


# ================= 纸面弹窗 =================
func _paper_layer(min_size: Vector2) -> Array:
	if overlay_layer:
		overlay_layer.queue_free()
	var layer := Control.new()
	layer.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(0.08, 0.06, 0.03, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(dim)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(center)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _paper_stylebox())
	panel.custom_minimum_size = min_size
	center.add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	panel.add_child(v)
	add_child(layer)
	overlay_layer = layer
	# 卷轴展开动画
	layer.modulate.a = 0.0
	panel.pivot_offset = panel.custom_minimum_size / 2.0
	panel.scale = Vector2(0.92, 0.92)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(layer, "modulate:a", 1.0, 0.18)
	tw.tween_property(panel, "scale", Vector2.ONE, 0.22).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	return [layer, v]


func _paper_title(v: VBoxContainer, text: String) -> void:
	var title := Label.new()
	title.text = text
	title.add_theme_font_override("font", theme_font)
	title.add_theme_font_size_override("font_size", 26)
	title.add_theme_color_override("font_color", Color(COL_INK, 1.0))
	title.add_theme_color_override("font_outline_color", Color(0.96, 0.91, 0.80, 1.0))
	title.add_theme_constant_override("outline_size", 1)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(title)
	# 题下装饰：朱红章点居中，两侧墨色细线
	var rule := HBoxContainer.new()
	rule.alignment = BoxContainer.ALIGNMENT_CENTER
	rule.add_theme_constant_override("separation", 10)
	v.add_child(rule)
	for side in [0, 1]:
		var seg := ColorRect.new()
		seg.color = Color(0.23, 0.18, 0.12, 0.35)
		seg.custom_minimum_size = Vector2(64, 1)
		seg.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		rule.add_child(seg)
		if side == 0:
			var dot := ColorRect.new()
			dot.color = COL_SEAL
			dot.custom_minimum_size = Vector2(7, 7)
			dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			rule.add_child(dot)


func _ink_button(text: String, font_size := 17) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(_play_click)
	b.add_theme_font_override("font", theme_font)
	b.add_theme_font_size_override("font_size", font_size)
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	b.add_theme_color_override("font_color", Color(COL_INK_UI, 1.0))
	b.add_theme_color_override("font_hover_color", Color(COL_INK_UI, 1.0))
	b.add_theme_color_override("font_pressed_color", Color(COL_INK_GREY, 1.0))
	b.add_theme_color_override("font_outline_color", Color(0.97, 0.93, 0.84, 1.0))
	b.add_theme_constant_override("outline_size", 1)
	b.add_theme_stylebox_override("normal", _plaque_style(COL_PLAQUE_BORDER, COL_UI_PAPER, 2, true))
	b.add_theme_stylebox_override("hover", _plaque_style(COL_SEAL, Color(0.98, 0.94, 0.86, 1.0), 2, true))
	b.add_theme_stylebox_override("pressed", _plaque_style(COL_SEAL, Color(0.88, 0.82, 0.72, 1.0), 2))
	b.focus_mode = Control.FOCUS_ALL
	b.add_theme_stylebox_override("focus", _focus_style())
	return b


func _ink_label(text: String, size := 17, color := COL_INK) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", theme_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _seal_label(text: String) -> PanelContainer:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", theme_font)
	l.add_theme_font_size_override("font_size", 15)
	l.add_theme_color_override("font_color", Color("f0e0c8"))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var wrap := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = COL_SEAL
	sb.set_corner_radius_all(3)
	sb.set_content_margin_all(3)
	wrap.add_theme_stylebox_override("panel", sb)
	wrap.add_child(l)
	return wrap


# ================= 政令 =================
func _show_policies() -> void:
	var parts := _paper_layer(Vector2(860, 0))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "布 政 施 策")
	v.add_child(_ink_label("本季度尚余行动机会：%d / 3    国库存银：%d 万两" % [gs.actions_left, int(gs.treasury)], 16, COL_INK_SOFT))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	v.add_child(grid)
	for pid in GameState.POLICIES:
		grid.add_child(_policy_card(parts[0], pid))
	var close := _ink_button("退出", 17)
	close.pressed.connect(func(): parts[0].queue_free())
	v.add_child(close)


func _policy_card(layer: Control, pid: String) -> PanelContainer:
	var pol: Dictionary = GameState.POLICIES[pid]
	var card := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = COL_PAPER_DARK
	sb.border_color = Color("8a7440")
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(3)
	sb.set_content_margin_all(10)
	card.add_theme_stylebox_override("panel", sb)
	card.custom_minimum_size = Vector2(390, 110)
	var cv := VBoxContainer.new()
	cv.add_theme_constant_override("separation", 3)
	card.add_child(cv)
	var name_l := _ink_label(pol["name"] + (("（费银%d万两）" % int(pol["cost"])) if pol["cost"] > 0 else "（不需银两）"), 18)
	cv.add_child(name_l)
	cv.add_child(_ink_label(pol["desc"], 14, COL_INK_SOFT))
	var btn := _ink_button("颁 行", 15)
	btn.pressed.connect(func():
		if pol["target"] == "prov":
			_show_policy_dialog(pid)
		else:
			var msg: String = gs.use_policy(pid)
			_show_toast(msg)
			_refresh_all())
	cv.add_child(btn)
	return card


## 单项方略对话框（省级方略可选施行省份）
func _show_policy_dialog(pid: String) -> void:
	var pol: Dictionary = GameState.POLICIES[pid]
	var parts := _paper_layer(Vector2(560, 0))
	var v: VBoxContainer = parts[1]
	_paper_title(v, pol["name"])
	v.add_child(_ink_label(pol["desc"] + (("    费银 %d 万两" % int(pol["cost"])) if pol["cost"] > 0 else ""), 16, COL_INK_SOFT))
	v.add_child(_ink_label("国库存银：%d 万两    本季度行动机会：%d/3" % [int(gs.treasury), gs.actions_left], 14, COL_INK_SOFT))

	var prov_opt: OptionButton = null
	if pol["target"] == "prov":
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		v.add_child(row)
		row.add_child(_ink_label("施行省份", 15))
		prov_opt = OptionButton.new()
		prov_opt.add_theme_font_override("font", theme_font)
		prov_opt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for p in gs.ming_provinces():
			prov_opt.add_item("%s（民%d 军%d）" % [p["name"], int(p["pop"]), int(p["morale"])])
			prov_opt.set_item_metadata(prov_opt.item_count - 1, p["id"])
		row.add_child(prov_opt)

	var go := _ink_button("颁 行", 18)
	go.pressed.connect(func():
		var prov_id: String = prov_opt.get_selected_metadata() if prov_opt else ""
		var msg: String = gs.use_policy(pid, prov_id)
		parts[0].queue_free()
		overlay_layer = null
		_show_toast(msg)
		_refresh_all())
	v.add_child(go)
	var cancel := _ink_button("罢", 15)
	cancel.pressed.connect(func():
		parts[0].queue_free()
		overlay_layer = null)
	v.add_child(cancel)


# ================= 大臣 =================
func _show_ministers(chat_first := false, task_id := "") -> void:
	var parts := _paper_layer(Vector2(1180, 620))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "铨 叙 · 拔 擢 文 武")
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	v.add_child(scroll)
	var box := VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_theme_constant_override("separation", 10)
	scroll.add_child(box)

	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	box.add_child(grid)
	for m in gs.ministers:
		grid.add_child(_minister_card(parts[0], m, false))

	var pool_header := _ink_label("—— 在野贤才（%d 人）——  以「布政施策·开科取士」擢用" % gs.pool.size(), 17, COL_SEAL)
	box.add_child(pool_header)
	var pool_grid := GridContainer.new()
	pool_grid.columns = 5
	pool_grid.add_theme_constant_override("h_separation", 10)
	pool_grid.add_theme_constant_override("v_separation", 10)
	box.add_child(pool_grid)
	for m in gs.pool:
		pool_grid.add_child(_minister_card(parts[0], m, true))

	var close := _ink_button("退出", 17)
	close.pressed.connect(func(): parts[0].queue_free())
	v.add_child(close)

	if chat_first and gs.ministers.size() > 0:
		_show_chat(gs.ministers[0], task_id)


func _minister_card(layer: Control, m: Dictionary, in_pool: bool) -> PanelContainer:
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(212, 250)
	var faction: String = m.get("faction", "中立")
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.11, 0.09, 0.06, 0.97)
	sb.border_color = GameState.FACTION_COLORS.get(faction, COL_PLAQUE_BORDER)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(4)
	sb.set_content_margin_all(8)
	card.add_theme_stylebox_override("panel", sb)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 3)
	card.add_child(v)

	var head := HBoxContainer.new()
	v.add_child(head)
	var seal := _seal_label(m["name"].left(1))
	head.add_child(seal)
	var nm := _ink_label(m["name"], 20, COL_GOLD)
	nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	head.add_child(nm)

	v.add_child(_ink_label("%s · %s" % [m.get("title", ""), faction], 12, GameState.FACTION_COLORS.get(faction, COL_GOLD).lightened(0.25)))
	v.add_child(_ink_label("治%d 统%d 智%d" % [int(m["politics"]), int(m["command"]), int(m["wisdom"])], 14, Color("cfc4a2")))
	v.add_child(_ink_label("忠%d  野%d" % [int(m["loyalty"]), int(m["ambition"])], 14, Color("cfc4a2")))
	var pos_name: String = GameState.POSITIONS.get(gs.position_of(m["id"]), {}).get("name", "")
	if pos_name != "":
		v.add_child(_ink_label("现任：" + pos_name, 13, Color("9fd08a")))

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	v.add_child(row)
	if not in_pool:
		var b1 := _ink_button("任命", 14)
		b1.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b1.pressed.connect(func(): _show_appoint(m))
		row.add_child(b1)
		var b2 := _ink_button("召对", 14)
		b2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b2.pressed.connect(func(): _show_chat(m))
		row.add_child(b2)
	return card


func _show_appoint(m: Dictionary) -> void:
	var parts := _paper_layer(Vector2(700, 520))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "任 命 · %s" % m["name"])
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	v.add_child(scroll)
	var box := VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_theme_constant_override("separation", 8)
	scroll.add_child(box)

	for pos in GameState.POSITIONS:
		var info: Dictionary = GameState.POSITIONS[pos]
		var row := PanelContainer.new()
		var sb := StyleBoxFlat.new()
		sb.bg_color = COL_PAPER_DARK
		sb.border_color = Color("8a7440")
		sb.set_border_width_all(1)
		sb.set_content_margin_all(8)
		row.add_theme_stylebox_override("panel", sb)
		var hv := HBoxContainer.new()
		hv.add_theme_constant_override("separation", 10)
		row.add_child(hv)
		var lv := VBoxContainer.new()
		lv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		hv.add_child(lv)
		lv.add_child(_ink_label("%s —— 现任：%s" % [info["name"], gs.minister(gs.appointments.get(pos, "")).get("name", "虚位以待")], 16))
		lv.add_child(_ink_label(info["desc"], 12, COL_INK_SOFT))
		var btn := _ink_button("授 任", 14)
		btn.pressed.connect(func():
			gs.appoint(pos, m["id"])
			_refresh_all()
			parts[0].queue_free())
		hv.add_child(btn)
		box.add_child(row)

	var close := _ink_button("罢免其职", 17)
	close.pressed.connect(func():
		for pos in gs.appointments.keys():
			if gs.appointments[pos] == m["id"]:
				gs.dismiss(pos)
		_refresh_all()
		parts[0].queue_free())
	v.add_child(close)


func _show_quarter_tasks() -> void:
	var parts := _paper_layer(Vector2(980, 680))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "本 季 度 时 政")
	v.add_child(_ink_label(gs.quarter_progress_text(), 14, COL_INK_SOFT))
	var bulletin_btn := _ink_button("查看重要奏折", 15)
	bulletin_btn.pressed.connect(_show_quarter_bulletins)
	v.add_child(bulletin_btn)
	for task in gs.active_tasks():
		var row := VBoxContainer.new()
		row.add_theme_constant_override("separation", 5)
		row.add_child(_ink_label("【%s】%s" % [str(task.get("priority", "normal")), str(task.get("title", ""))], 19, COL_SEAL))
		row.add_child(_ink_label(str(task.get("description", "")), 14, COL_INK))
		row.add_child(_ink_label("进展 %s · 障碍：%s" % [str(task.get("progress", 0)), "、".join(PackedStringArray(task.get("obstacles", [])))], 13, COL_INK_SOFT))
		var actions := HBoxContainer.new()
		var audience := _ink_button("召见大臣", 15)
		audience.pressed.connect(func(): _show_ministers(true, str(task.get("id", ""))))
		actions.add_child(audience)
		var debate := _ink_button("召开朝会", 15)
		debate.pressed.connect(func(): _show_court_debate(task))
		actions.add_child(debate)
		var solution := _ink_button("形成方案", 15)
		solution.disabled = not gs.has_task_dialogue(str(task.get("id", ""))) or str(task.get("selected_solution_id", "")) != ""
		solution.pressed.connect(func(): _derive_solution(task))
		actions.add_child(solution)
		row.add_child(actions)
		v.add_child(row)
	var close := _ink_button("关闭", 16)
	close.pressed.connect(func(): parts[0].queue_free())
	v.add_child(close)
	var submit := _ink_button("提交本季度意图 · 交由 AI 推演", 17)
	submit.disabled = gs.game_ended or gs.simulation_in_flight
	submit.pressed.connect(func():
		var result: Dictionary = gs.settle_quarter()
		if not result.get("ok", false):
			_show_toast(str(result.get("msg", "本季度暂不能提交推演")))
			return
		parts[0].queue_free()
		overlay_layer = null
		_show_toast("本季度意图已提交，等待 AI 推演结果。"))
	v.add_child(submit)
func _show_quarter_bulletins() -> void:
	var parts := _paper_layer(Vector2(900, 620))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "重 要 奏 折 · " + gs.quarter_key())
	var view := RichTextLabel.new()
	view.bbcode_enabled = true
	view.custom_minimum_size = Vector2(820, 430)
	view.add_theme_font_override("normal_font", theme_font)
	view.add_theme_font_size_override("normal_font_size", 15)
	v.add_child(view)
	var close := _ink_button("收存奏折", 16)
	close.pressed.connect(func(): parts[0].queue_free())
	v.add_child(close)
	var render := func(bulletins: Array) -> void:
		if bulletins.is_empty():
			view.text = "本季度暂无重要奏折。"
			return
		var lines := PackedStringArray()
		for bulletin in bulletins:
			if not bulletin is Dictionary:
				continue
			var priority := str(bulletin.get("priority", "normal"))
			lines.append("[b][color=#a5382a]【%s】%s[/color][/b]" % [priority, str(bulletin.get("title", "无题奏折"))])
			lines.append(str(bulletin.get("text", "")))
			var source := str(bulletin.get("source", ""))
			if source != "":
				lines.append("[color=#6b5638]来源：%s[/color]" % source)
			lines.append("")
		view.text = "\n".join(lines)
	if not gs.current_quarter_bulletins.is_empty():
		render.call(gs.current_quarter_bulletins)
		return
	view.text = "AI 正在汇总本季度重要奏折……"
	var on_ready := func(result: Dictionary):
		if result.get("ok", false):
			render.call(result.get("bulletins", []))
		else:
			view.text = "[color=#a5382a]" + str(result.get("error", "奏折生成失败")) + "[/color]"
	gs.bulletin_ready.connect(on_ready, CONNECT_ONE_SHOT)
	var res: Dictionary = gs.request_quarter_bulletins()
	if not res.get("ok", false):
		view.text = "[color=#a5382a]" + str(res.get("error", "奏折请求失败")) + "[/color]"


func _accept_solution(task: Dictionary, solution_data: Dictionary, result_view: RichTextLabel, accept: Button) -> void:
	var accepted: Dictionary = gs.accept_task_solution(str(task.get("id", "")), solution_data)
	if not accepted.get("ok", false):
		result_view.text += "\n[color=#a5382a]" + str(accepted.get("error", "方案未采纳")) + "[/color]"
		return
	accept.disabled = true
	result_view.text += "\n\n[color=#5a4a30]皇帝已采纳此方案，可进入圣旨编辑。[/color]"


func _is_edict_command(text: String) -> bool:
	for key in ["拟旨", "颁旨", "下诏", "草诏", "准了", "照准", "依卿所奏"]:
		if text.contains(key):
			return true
	return false


## 皇帝在召对/朝会中下达拟旨指令后，由 AI 依议事记录草拟圣旨，并入圣旨编辑器。
func _open_ai_edict_draft(task: Dictionary, transcript: Array, solution_title: String) -> void:
	if task.is_empty() or str(task.get("id", "")) == "":
		_show_toast("没有绑定的时政任务，不能依议拟旨。")
		return
	if not LLMClient.is_enabled():
		_show_toast("AI 推演未连接，不能拟旨。")
		return
	var task_id := str(task.get("id", ""))
	var on_draft := func(result: Dictionary):
		if not result.get("ok", false):
			_show_toast(str(result.get("error", "拟诏失败")))
			return
		var data: Dictionary = result.get("data", {})
		var edict_text := str(data.get("edict_text", "")).strip_edges()
		if edict_text == "":
			_show_toast("中书科拟诏结果为空。")
			return
		var latest: Dictionary = gs.task_by_id(task_id)
		if not latest.is_empty() and str(latest.get("status", "")) == "active" and str(latest.get("selected_solution_id", "")) == "":
			var accepted: Dictionary = gs.accept_task_solution(task_id, {
				"title": solution_title,
				"summary": str(data.get("summary", "")),
				"edict_text": edict_text,
			})
			if not accepted.get("ok", false):
				_show_toast(str(accepted.get("error", "方案未能采纳")))
				return
		_show_edict(edict_text, task_id)
	LLMClient.edict_draft_ready.connect(on_draft, CONNECT_ONE_SHOT)
	LLMClient.draft_edict_from_dialogue(gs.state_snapshot(), task, transcript)


func _show_court_debate(task: Dictionary) -> void:
	if not LLMClient.is_enabled():
		_show_toast("AI 推演未连接，朝会讨论不能生成任务证据。")
		return
	var parts := _paper_layer(Vector2(960, 680))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "朝 会 · %s" % str(task.get("title", "")))
	v.add_child(_ink_label("选择至少两位大臣参与廷议。讨论只形成方案证据，不直接改变国势。", 14, COL_INK_SOFT))
	var ministers_box := VBoxContainer.new()
	v.add_child(ministers_box)
	var selected: Array = []
	for m in gs.ministers:
		var cb := CheckBox.new()
		cb.text = "%s · %s" % [str(m.get("name", "")), str(m.get("title", ""))]
		cb.add_theme_font_override("font", theme_font)
		cb.toggled.connect(func(on: bool):
			if on:
				selected.append(str(m.get("id", "")))
			elif selected.has(str(m.get("id", ""))):
				selected.erase(str(m.get("id", "")))
		)
		ministers_box.add_child(cb)
	var output := RichTextLabel.new()
	output.bbcode_enabled = true
	output.custom_minimum_size = Vector2(880, 300)
	output.add_theme_font_override("normal_font", theme_font)
	output.add_theme_font_size_override("normal_font_size", 15)
	v.add_child(output)
	var run := _ink_button("开始廷议", 17)
	var on_debate := func(result: Dictionary):
		if not result.get("ok", false):
			output.text = "[color=#a5382a]" + str(result.get("error", "朝会失败")) + "[/color]"
			run.disabled = false
			return
		var data: Dictionary = result.get("data", {})
		var saved: Dictionary = gs.record_court_debate(str(task.get("id", "")), selected, data.get("speakers", []), str(data.get("summary", "")), data.get("solution_candidates", []))
		output.text = str(data.get("summary", "朝会记录已保存。"))
		if not saved.get("ok", false):
			output.text += "\n" + str(saved.get("error", "朝会未能归档"))
			return
		var debate_transcript: Array = []
		for sp in data.get("speakers", []):
			if sp is Dictionary:
				debate_transcript.append({"speaker": str(sp.get("minister_id", sp.get("speaker", "臣"))), "text": str(sp.get("message", sp.get("text", "")))})
		if str(data.get("summary", "")) != "":
			debate_transcript.append({"speaker": "朝会摘要", "text": str(data.get("summary", ""))})
		var draft_btn := _ink_button("依廷议拟旨", 16)
		draft_btn.pressed.connect(func():
			draft_btn.disabled = true
			_open_ai_edict_draft(task, debate_transcript, "廷议所定之策"))
		v.add_child(draft_btn)
	LLMClient.debate_ready.connect(on_debate, CONNECT_ONE_SHOT)
	run.pressed.connect(func():
		if selected.size() < 2:
			output.text = "[color=#a5382a]至少选择两名大臣。[/color]"
			return
		run.disabled = true
		output.text = "AI 正在记录朝会……"
		var chosen: Array = []
		for mid in selected:
			chosen.append(gs.minister(str(mid)))
		LLMClient.run_court_debate(gs.state_snapshot(), task, chosen, [])
	)

	v.add_child(run)
	var close := _ink_button("退朝", 16)
	close.pressed.connect(func(): parts[0].queue_free())
	v.add_child(close)


func _derive_solution(task: Dictionary) -> void:
	if not LLMClient.is_enabled():
		_show_toast("AI 推演未连接，不能形成时政方案。")
		return
	var parts := _paper_layer(Vector2(920, 620))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "方 案 审 议 · %s" % str(task.get("title", "")))
	var result_view := RichTextLabel.new()
	result_view.bbcode_enabled = true
	result_view.custom_minimum_size = Vector2(840, 360)
	result_view.add_theme_font_override("normal_font", theme_font)
	result_view.add_theme_font_size_override("normal_font_size", 16)
	result_view.text = "AI 正在根据奏折、召对和朝会记录形成方案……"
	v.add_child(result_view)
	var on_solution := func(result: Dictionary):
		if not result.get("ok", false):
			result_view.text = "[color=#a5382a]" + str(result.get("error", "方案形成失败")) + "[/color]"
			return
		var data: Dictionary = result.get("data", {})
		var solution_value = data.get("solution", {})
		if not bool(data.get("eligible", false)) or not (solution_value is Dictionary):
			result_view.text = "[color=#a5382a]对话证据不足，暂不能形成可颁布方案。[/color]"
			return
		var solution_data: Dictionary = solution_value
		var solution_text := PackedStringArray()
		solution_text.append("[b]方案候选：[/b]" + str(solution_data.get("title", "")))
		solution_text.append(str(solution_data.get("summary", "")))
		solution_text.append("圣旨建议：" + str(solution_data.get("edict_text", "")))
		result_view.text = "\n\n".join(solution_text)
		var accept := _ink_button("采纳方案，拟定圣旨", 16)
		accept.pressed.connect(_accept_solution.bind(task, solution_data, result_view, accept))
		v.add_child(accept)
	LLMClient.solution_ready.connect(on_solution, CONNECT_ONE_SHOT)
	LLMClient.derive_task_solution(gs.state_snapshot(), task, gs.current_quarter_bulletins, gs.current_quarter_dialogues, gs.current_quarter_debates)
	var close := _ink_button("收存方案", 16)
	close.pressed.connect(func(): parts[0].queue_free())
	v.add_child(close)




# ================= 召对 =================
func _show_chat(m: Dictionary, task_id := "") -> void:
	var parts := _paper_layer(Vector2(920, 640))
	var v: VBoxContainer = parts[1]
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 18)
	v.add_child(h)

	var left := VBoxContainer.new()
	left.custom_minimum_size = Vector2(200, 0)
	left.add_theme_constant_override("separation", 6)
	h.add_child(left)
	var seal := _seal_label(m["name"].left(1))
	seal.custom_minimum_size = Vector2(60, 60)
	left.add_child(seal)
	left.add_child(_ink_label(m["name"], 24, COL_SEAL))
	left.add_child(_ink_label("%s\n%s" % [m["title"], "、".join(PackedStringArray(m.get("traits", [])))], 13, COL_INK_SOFT))
	left.add_child(_ink_label("忠诚 %d   野心 %d" % [int(m["loyalty"]), int(m["ambition"])], 13, COL_INK_SOFT))

	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right.add_theme_constant_override("separation", 8)
	h.add_child(right)
	right.add_child(_ink_label("召对 · %s" % m["name"], 19, COL_INK))
	var chat := RichTextLabel.new()
	chat.bbcode_enabled = true
	chat.add_theme_font_override("normal_font", theme_font)
	chat.add_theme_font_size_override("normal_font_size", 17)
	chat.size_flags_vertical = Control.SIZE_EXPAND_FILL
	chat.scroll_following = true
	right.add_child(chat)

	var llm_history: Array = []
	var say := func(who: String, text: String, color: String):
		chat.text += "[color=%s][b]%s[/b][/color] %s\n" % [color, who, text]
	var task_context: Dictionary = gs.task_by_id(task_id) if task_id != "" else (gs.active_tasks()[0] if not gs.active_tasks().is_empty() else {})
	var task_id_for_chat := str(task_context.get("id", ""))
	if task_id_for_chat == "":
		say.call("系统", "请先从时政任务进入召对。", "#a5382a")
	else:
		right.add_child(_ink_label("议题：%s" % str(task_context.get("title", "")), 14, COL_SEAL))
	say.call("帝", "召卿觐见。请围绕当前时政任务陈明利弊。", "#a5382a")


	var on_reply := func(result: Dictionary):
		if not result.get("ok", false):
			say.call("系统", str(result.get("error", "AI 暂无回复")), "#a5382a")
			return
		var data: Dictionary = result.get("data", {})
		var reply := str(data.get("message", data.get("advice", "")))
		say.call(m["name"], reply, "#5a4a30")
		var dialogue_task_id := task_id_for_chat
		if dialogue_task_id != "":
			gs.record_minister_dialogue(dialogue_task_id, str(m.get("id", "")), [{"role": "user", "content": llm_history[-2].get("content", "") if llm_history.size() >= 2 else ""}, {"role": "assistant", "content": reply}], str(data.get("advice", reply)))


		if llm_history.size() > 0 and llm_history[llm_history.size() - 1].get("role", "") == "assistant":
			llm_history[llm_history.size() - 1]["content"] = reply
	LLMClient.reply_ready.connect(on_reply)

	var input := LineEdit.new()
	input.placeholder = "向大臣垂询……"
	input.add_theme_font_override("font", theme_font)
	input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(input)

	var send := func():
		var q: String = input.text.strip_edges()
		if q == "":
			return
		input.text = ""
		say.call("帝", q, "#a5382a")
		llm_history.append({"role": "user", "content": q})
		var task: Dictionary = gs.task_by_id(task_id_for_chat) if task_id_for_chat != "" else (gs.active_tasks()[0] if not gs.active_tasks().is_empty() else {})
		if _is_edict_command(q):
			if llm_history.size() <= 1:
				say.call("系统", "尚无议事内容，先与卿家讨论政务，再下拟旨之谕。", "#a5382a")
				return
			var transcript: Array = llm_history.duplicate(true)
			llm_history.append({"role": "assistant", "content": "臣领旨，诏书已拟就，恭请陛下御览。"})
			say.call("系统", "拟旨之谕已下，中书科正依议事草诏……", "#6b5638")
			_open_ai_edict_draft(task, transcript, "召对所定之策")
			return
		LLMClient.chat_with_minister(m, task, llm_history.duplicate(true), gs.state_snapshot(), q)
		llm_history.append({"role": "assistant", "content": "…"})
	input.text_submitted.connect(func(_t): send.call())

	var row := HBoxContainer.new()
	right.add_child(row)
	var send_btn := _ink_button("垂询", 16)
	send_btn.pressed.connect(send)
	row.add_child(send_btn)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(spacer)
	var close_btn := _ink_button("退下", 16)
	close_btn.pressed.connect(func():
		LLMClient.reply_ready.disconnect(on_reply)
		parts[0].queue_free())
	row.add_child(close_btn)


# ================= 奏报 / 事件 =================
func _show_log() -> void:
	var parts := _paper_layer(Vector2(860, 620))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "条 陈 奏 疏")
	var rt := RichTextLabel.new()
	rt.bbcode_enabled = true
	rt.add_theme_font_override("normal_font", theme_font)
	rt.add_theme_font_size_override("normal_font_size", 16)
	rt.size_flags_vertical = Control.SIZE_EXPAND_FILL
	rt.scroll_following = true
	var parts_text := PackedStringArray()
	for i in gs.history.size():
		parts_text.append("[color=#4a3a24]" + str(gs.history[i]) + "[/color]")
	rt.text = "\n".join(parts_text)
	v.add_child(rt)
	var close := _ink_button("退出", 16)
	close.pressed.connect(func(): parts[0].queue_free())
	v.add_child(close)


func _show_event(ev: Dictionary) -> void:
	if ev.get("special", "") == "rebel_attack":
		return
	var parts := _paper_layer(Vector2(760, 0))
	var v: VBoxContainer = parts[1]
	var head := HBoxContainer.new()
	head.alignment = BoxContainer.ALIGNMENT_CENTER
	head.add_theme_constant_override("separation", 12)
	v.add_child(head)
	head.add_child(_seal_label("旨"))
	var title := _ink_label("【%s】" % ev.get("title", ""), 26, COL_SEAL)
	head.add_child(title)
	v.add_child(_ink_label(ev.get("text", ""), 17))
	var choices_box := VBoxContainer.new()
	choices_box.add_theme_constant_override("separation", 8)
	v.add_child(choices_box)
	for choice in ev.get("choices", []):
		var btn := _ink_button(choice["label"], 17)
		btn.pressed.connect(func():
			if gs.simulation_in_flight:
				return
			for c in choices_box.get_children():
				c.visible = false
			var waiting := _ink_label("AI 正在裁决事件后果……", 16, COL_INK_SOFT)
			choices_box.add_child(waiting)
			var on_result := func(result: Dictionary):
				waiting.queue_free()
				if not result.get("ok", false):
					choices_box.add_child(_ink_label("AI 裁决失败：" + str(result.get("error", "未知错误")), 16, COL_SEAL))
					return
				choices_box.add_child(_ink_label(str(result.get("narrative", "事件后果已裁决。")), 16, COL_INK_SOFT))
				var close := _ink_button("知道了", 16)
				close.pressed.connect(func(): parts[0].queue_free())
				choices_box.add_child(close)
			gs.event_result.connect(on_result, CONNECT_ONE_SHOT)
			gs.resolve_event_choice(ev, choice)
		)
		choices_box.add_child(btn)


func _show_game_over(victory: bool, reason: String) -> void:
	var parts := _paper_layer(Vector2(880, 0))
	var v: VBoxContainer = parts[1]
	var title := _ink_label("山河永驻" if victory else "社稷倾覆", 54, Color("9a7c1e") if victory else COL_SEAL)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(title)
	var body := _ink_label(reason, 19)
	body.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(body)
	var btn := _ink_button("重整山河（重新开局）", 20)
	btn.pressed.connect(func():
		gs.new_game()
		gs.save_game()
		parts[0].queue_free()
		overlay_layer = null
		selected_province = ""
		info_panel.visible = false
		_refresh_all())
	v.add_child(btn)


func _title_glyph(ch: String) -> Label:
	# 竖排题字单字
	var glyph := Label.new()
	glyph.text = ch
	glyph.add_theme_font_override("font", theme_font)
	glyph.add_theme_font_size_override("font_size", 58)
	glyph.add_theme_color_override("font_color", COL_INK_UI)
	glyph.add_theme_color_override("font_outline_color", Color(0.97, 0.93, 0.84, 1.0))
	glyph.add_theme_constant_override("outline_size", 2)
	glyph.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return glyph


func _start_seal() -> Control:
	# 「明之疆土」2×2 仿印章（右列起竖读）
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 2)
	grid.add_theme_constant_override("v_separation", 2)
	for ch in ["疆", "明", "土", "之"]:
		var c := Label.new()
		c.text = ch
		c.add_theme_font_override("font", theme_font)
		c.add_theme_font_size_override("font_size", 15)
		c.add_theme_color_override("font_color", Color("f0e0c8"))
		c.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		c.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		c.custom_minimum_size = Vector2(20, 20)
		grid.add_child(c)
	var wrap := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = COL_SEAL
	sb.set_corner_radius_all(3)
	sb.set_content_margin_all(5)
	sb.border_color = Color("5c1f18")
	sb.set_border_width_all(1)
	wrap.add_theme_stylebox_override("panel", sb)
	wrap.add_child(grid)
	return wrap


func _show_start_screen() -> void:
	if start_screen:
		return
	var layer := Control.new()
	layer.name = "StartScreen"
	layer.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.mouse_filter = Control.MOUSE_FILTER_STOP
	layer.z_index = 100
	start_screen = layer
	add_child(layer)

	var paper := TextureRect.new()
	paper.texture = _bg_texture()
	paper.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	paper.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	paper.set_anchors_preset(Control.PRESET_FULL_RECT)
	paper.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(paper)
	var wash := ColorRect.new()
	wash.color = Color(0.94, 0.90, 0.82, 0.70)
	wash.set_anchors_preset(Control.PRESET_FULL_RECT)
	wash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(wash)
	# 四角淡墨晕影，聚焦中心
	var vig := TextureRect.new()
	var grad := Gradient.new()
	grad.set_color(0, Color(0.10, 0.08, 0.05, 0.0))
	grad.set_color(1, Color(0.10, 0.08, 0.05, 0.36))
	grad.add_point(0.62, Color(0.10, 0.08, 0.05, 0.0))
	var vig_tex := GradientTexture2D.new()
	vig_tex.gradient = grad
	vig_tex.fill = GradientTexture2D.FILL_RADIAL
	vig_tex.fill_from = Vector2(0.5, 0.46)
	vig_tex.fill_to = Vector2(0.5, 1.08)
	vig_tex.width = 512
	vig_tex.height = 512
	vig.texture = vig_tex
	vig.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	vig.set_anchors_preset(Control.PRESET_FULL_RECT)
	vig.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(vig)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(center)
	# 装裱画框：深墨绫边包住宣纸画芯
	var frame := PanelContainer.new()
	frame.custom_minimum_size = Vector2(470, 0)
	frame.add_theme_stylebox_override("panel", _plaque_style(Color(0.10, 0.08, 0.05, 0.65), Color(0.17, 0.13, 0.09, 0.92), 3, true))
	frame.mouse_filter = Control.MOUSE_FILTER_STOP
	center.add_child(frame)
	var mat := PanelContainer.new()
	var mat_sb := _plaque_style(Color(0.16, 0.13, 0.09, 0.50), Color(0.952, 0.922, 0.855, 0.98), 1)
	mat_sb.set_content_margin_all(30)
	mat_sb.set_content_margin(SIDE_BOTTOM, 26)
	mat.add_theme_stylebox_override("panel", mat_sb)
	frame.add_child(mat)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	mat.add_child(v)

	# 竖排题字「山河永驻」：右列先读，列末钤「明之疆土」印
	var title_row := HBoxContainer.new()
	title_row.alignment = BoxContainer.ALIGNMENT_CENTER
	title_row.add_theme_constant_override("separation", 22)
	v.add_child(title_row)
	var col_l := VBoxContainer.new()
	var col_r := VBoxContainer.new()
	for c in [col_l, col_r]:
		c.add_theme_constant_override("separation", 4)
		title_row.add_child(c)
	for ch in ["山", "河"]:
		col_r.add_child(_title_glyph(ch))
	for ch in ["永", "驻"]:
		col_l.add_child(_title_glyph(ch))
	var seal := _start_seal()
	seal.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col_l.add_child(seal)

	var rule := HSeparator.new()
	rule.add_theme_color_override("separator", Color(0.23, 0.18, 0.12, 0.45))
	v.add_child(rule)
	var subtitle := _ink_label("天启帝崩，信王继统 · 崇祯元年", 17, COL_INK_SOFT)
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(subtitle)
	var cadence := _ink_label("一个回合，一个季度", 15, COL_SEAL)
	cadence.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(cadence)
	v.add_spacer(false)

	var new_game := _ink_button("开 始 新 局", 21)
	new_game.custom_minimum_size = Vector2(340, 50)
	new_game.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	new_game.pressed.connect(func(): _enter_game(true))
	v.add_child(new_game)
	new_game.grab_focus()
	if gs.has_save():
		var continue_game := _ink_button("继 续 前 局", 19)
		continue_game.custom_minimum_size = Vector2(340, 46)
		continue_game.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		continue_game.pressed.connect(func(): _enter_game(false))
		v.add_child(continue_game)
	var settings := _ink_button("设 置", 18)
	settings.custom_minimum_size = Vector2(340, 42)
	settings.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	settings.pressed.connect(_show_settings_dialog)
	v.add_child(settings)
	var quit := _ink_button("退 出 游 戏", 17)
	quit.custom_minimum_size = Vector2(340, 42)
	quit.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	quit.pressed.connect(func(): get_tree().quit())
	v.add_child(quit)

	# 入场：纸面淡入，画框微缩展开
	layer.modulate.a = 0.0
	frame.scale = Vector2(0.96, 0.96)
	frame.pivot_offset = Vector2(235, 280)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(layer, "modulate:a", 1.0, 0.45)
	tw.tween_property(frame, "scale", Vector2.ONE, 0.45).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


func _enter_game(new_game: bool) -> void:
	if not start_screen:
		return
	if new_game:
		gs.new_game()
		gs.save_game()
	else:
		if not gs.load_game():
			return
	start_screen.queue_free()
	start_screen = null
	_refresh_all()


func _settings_row(title: String, control: Control, hint: String = "") -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	row.custom_minimum_size = Vector2(0, 42)
	var label := _ink_label(title, 17, COL_INK_UI)
	label.custom_minimum_size = Vector2(130, 0)
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(label)
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(control)
	if hint != "":
		var note := _ink_label(hint, 13, COL_INK_GREY)
		note.custom_minimum_size = Vector2(130, 0)
		note.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		row.add_child(note)
	return row


func _show_settings_dialog() -> void:
	if settings_dialog:
		return
	var parts := _paper_layer(Vector2(780, 0))
	var layer: Control = parts[0]
	layer.z_index = 220
	settings_dialog = layer
	var v: VBoxContainer = parts[1]
	_paper_title(v, "设 置")
	v.add_child(_ink_label("显示设置会立即生效；模型配置保存到用户目录。", 14, COL_INK_SOFT))

	var quality := OptionButton.new()
	quality.custom_minimum_size = Vector2(210, 38)
	for value in ["low", "medium", "high"]:
		quality.add_item(_quality_text(value))
		quality.set_item_metadata(quality.item_count - 1, value)
	var quality_value := str(local_settings.get("quality", "high"))
	for i in quality.item_count:
		if str(quality.get_item_metadata(i)) == quality_value:
			quality.select(i)
			break
	quality.item_selected.connect(func(index: int):
		local_settings["quality"] = str(quality.get_item_metadata(index))
		_save_local_settings()
		_apply_display_settings())
	v.add_child(_settings_row("画质", quality, "地图纹理与绘制滤镜"))

	var fps := OptionButton.new()
	fps.custom_minimum_size = Vector2(210, 38)
	var fps_values := [30, 60, 120, 144, 0]
	for value in fps_values:
		fps.add_item(_fps_text(value))
		fps.set_item_metadata(fps.item_count - 1, value)
	var fps_value := int(local_settings.get("fps", 60))
	for i in fps.item_count:
		if int(fps.get_item_metadata(i)) == fps_value:
			fps.select(i)
			break
	fps.item_selected.connect(func(index: int):
		local_settings["fps"] = int(fps.get_item_metadata(index))
		_save_local_settings()
		_apply_display_settings())
	v.add_child(_settings_row("帧率上限", fps, "0 表示不限制"))

	var sep := HSeparator.new()
	sep.add_theme_color_override("separator", Color(0.23, 0.18, 0.12, 0.35))
	v.add_child(sep)
	v.add_child(_ink_label("AI 推演模型", 19, COL_SEAL))

	var base_url := LineEdit.new()
	base_url.text = str(LLMClient.base_url)
	base_url.placeholder_text = "例如 https://open.bigmodel.cn/api/paas/v4"
	base_url.custom_minimum_size = Vector2(0, 38)
	v.add_child(_settings_row("接口地址", base_url))

	var model := LineEdit.new()
	model.text = str(LLMClient.model)
	model.placeholder_text = "例如 glm-4-flash"
	model.custom_minimum_size = Vector2(0, 38)
	v.add_child(_settings_row("模型名称", model))

	var key := LineEdit.new()
	key.text = str(LLMClient.api_key)
	key.secret = true
	key.placeholder_text = "输入 API Key；留空将停用 AI"
	key.custom_minimum_size = Vector2(0, 38)
	v.add_child(_settings_row("API Key", key))

	var status := _ink_label("", 14, COL_INK_SOFT)
	status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(status)
	var buttons := HBoxContainer.new()
	buttons.alignment = BoxContainer.ALIGNMENT_CENTER
	buttons.add_theme_constant_override("separation", 12)
	v.add_child(buttons)
	var save := _ink_button("保存配置", 17)
	save.custom_minimum_size = Vector2(180, 42)
	save.pressed.connect(func():
		if _write_model_config(base_url.text, key.text, model.text):
			status.text = "配置已保存，AI 状态已更新。"
			status.add_theme_color_override("font_color", Color("3f7044"))
			if ai_status_label:
				ai_status_label.text = "AI 推演未连接：核心回合已锁定" if not LLMClient.is_enabled() else "AI 推演已连接"
		else:
			status.text = "配置保存失败，请检查用户目录权限。"
			status.add_theme_color_override("font_color", COL_SEAL))
	buttons.add_child(save)
	var close := _ink_button("返回", 17)
	close.custom_minimum_size = Vector2(180, 42)
	close.pressed.connect(func():
		layer.queue_free()
		settings_dialog = null
		if overlay_layer == layer:
			overlay_layer = null)
	buttons.add_child(close)


func _ask_continue() -> void:
	var parts := _paper_layer(Vector2(460, 0))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "发现上局存档")
	v.add_child(_ink_label("要继续前局，还是另启新局？", 17, COL_INK_SOFT))
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 16)
	v.add_child(row)
	var cont := _ink_button("继续前局", 18)
	cont.pressed.connect(func():
		gs.load_game()
		_refresh_all()
		parts[0].queue_free()
		overlay_layer = null)
	row.add_child(cont)
	var newg := _ink_button("另启新局", 18)
	newg.pressed.connect(func():
		gs.new_game()
		_refresh_all()
		parts[0].queue_free()
		overlay_layer = null)
	row.add_child(newg)


# ================= 军务 =================
func _on_map_select(pid: String) -> void:
	selected_province = pid
	map_canvas.selected = pid
	if not gs.province_by_id.has(pid):
		_update_world_info_panel(pid)
		map_canvas.queue_redraw()
		return
	_update_info_panel(pid)
	map_canvas.queue_redraw()


func _on_map_context(pid: String) -> void:
	selected_province = pid
	map_canvas.selected = pid
	if not gs.province_by_id.has(pid):
		_update_world_info_panel(pid)
		_show_toast("外部区域暂不提供直接操作")
		map_canvas.queue_redraw()
		return
	_show_context_operations(pid)
	map_canvas.queue_redraw()


func _show_context_operations(pid: String) -> void:
	var province: Dictionary = gs.province_by_id.get(pid, {})
	if province.is_empty():
		return
	var parts := _paper_layer(Vector2(600, 0))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "当地操作 · " + str(province.get("name", pid)))
	v.add_child(_ink_label("当前归属：%s    民心：%d    军心：%d" % [OWNER_NAMES.get(str(province.get("owner", "")), "未知"), int(province.get("pop", 0)), int(province.get("morale", 0))], 16, COL_INK_SOFT))
	v.add_child(_ink_label("操作将记为政务意图，由 AI 在后续推演中裁定结果。", 14, COL_INK_SOFT))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	v.add_child(grid)
	if str(province.get("owner", "")) == "ming":
		_add_context_action(grid, parts[0], "调兵布防", func(): _close_context_and_call(parts[0], _on_move_dialog))
		_add_context_action(grid, parts[0], "开仓赈灾", func(): _queue_context_policy(parts[0], "zhenji", pid))
		_add_context_action(grid, parts[0], "整饬军务", func(): _queue_context_policy(parts[0], "lianbing", pid))
		_add_context_action(grid, parts[0], "修缮城防", func(): _queue_context_policy(parts[0], "xiulv", pid))
		_add_context_action(grid, parts[0], "招抚流民", func(): _queue_context_policy(parts[0], "zhaofu", pid))
	else:
		_add_context_action(grid, parts[0], "出兵征讨", func(): _close_context_and_call(parts[0], _on_dispatch))
	var close := _ink_button("关闭", 16)
	close.pressed.connect(func():
		parts[0].queue_free()
		overlay_layer = null)
	v.add_child(close)


func _add_context_action(parent: GridContainer, layer: Control, title: String, action: Callable) -> void:
	var button := _ink_button(title, 16)
	button.custom_minimum_size = Vector2(270, 42)
	button.pressed.connect(action)
	parent.add_child(button)


func _close_context_and_call(layer: Control, action: Callable) -> void:
	layer.queue_free()
	overlay_layer = null
	action.call()


func _queue_context_policy(layer: Control, policy_id: String, province_id: String) -> void:
	var msg: String = gs.use_policy(policy_id, province_id)
	layer.queue_free()
	overlay_layer = null
	_show_toast(msg)
	_refresh_all()


func _update_world_info_panel(pid: String) -> void:
	if not map_canvas.world_regions is Array:
		info_panel.visible = false
		return
	for region in map_canvas.world_regions:
		if region is Dictionary and str(region.get("id", "")) == pid:
			var lines := PackedStringArray()
			lines.append("[b][color=#8d3c2f]%s[/color][/b]  （外部势力）" % str(region.get("name", "")))
			lines.append("势力：%s" % str(region.get("faction", "")))
			lines.append("该区域暂不纳入大明内政行动。")
			info_text.text = "\n".join(lines)
			info_panel.visible = true
			_build_safe_layout()
			return
	info_panel.visible = false


func _update_info_panel(pid: String) -> void:
	var p: Dictionary = gs.province_by_id.get(pid, {})
	if p.is_empty():
		info_panel.visible = false
		return
	var lines := PackedStringArray()
	lines.append("[b][color=#e8cf8e]%s[/color][/b]  （%s）" % [p["name"], OWNER_NAMES[p["owner"]]])
	if str(p.get("historical_scope", "")) != "":
		lines.append("[color=#b8a67e]明末建制：%s[/color]" % str(p["historical_scope"]))
	lines.append("驻军：%d 万    城防：%d 级" % [int(p["garrison"]), int(p["fort"])])
	lines.append("民心：%d    军心：%d" % [int(p["pop"]), int(p["morale"])])
	lines.append("税银：%d 万两/月（实收 %d）" % [int(p["tax"]), int(p["tax"] * (0.5 + p["pop"] / 100.0))])
	var adj_names := PackedStringArray()
	for a in p["adj"]:
		adj_names.append(gs.province_by_id[a]["name"])
	lines.append("[color=#b8a67e]相邻：%s[/color]" % "、".join(adj_names))
	info_text.text = "\n".join(lines)
	info_panel.visible = true
	_build_safe_layout()


func _on_dispatch() -> void:
	if selected_province == "" or not gs.province_by_id.has(selected_province):
		_show_toast("外部势力暂不可直接出兵")
		return
	if selected_province == "":
		_show_toast("请先在舆图上点选出征目标")
		return
	var tgt: Dictionary = gs.province_by_id.get(selected_province, {})
	if tgt.is_empty() or tgt["owner"] == "ming":
		_show_toast("目标须为敌占城池")
		return
	var best := {}
	var best_g := 0.0
	for a in tgt["adj"]:
		var p: Dictionary = gs.province_by_id[a]
		if gs.can_dispatch_from(p, tgt) and p["garrison"] > best_g:
			best = p
			best_g = p["garrison"]
	if best.is_empty():
		_show_toast("没有可出征的相邻我方城池（驻军需≥5万）")
		return
	_show_dispatch_dialog(best, tgt)


func _show_dispatch_dialog(src: Dictionary, tgt: Dictionary) -> void:
	var parts := _paper_layer(Vector2(520, 0))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "出 兵 讨 伐")
	v.add_child(_ink_label("自 %s 出征 %s（%s）\n我方驻军：%d 万    敌军：%d 万    城防 %d 级" % [
		src["name"], tgt["name"], OWNER_NAMES[tgt["owner"]],
		int(src["garrison"]), int(tgt["garrison"]), int(tgt["fort"])], 16))
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 8)
	v.add_child(h)
	h.add_child(_ink_label("兵力(万)", 15))
	var spin := SpinBox.new()
	spin.min_value = 3
	spin.max_value = maxf(3, src["garrison"] - 2)
	spin.value = minf(8, spin.max_value)
	spin.add_theme_font_override("font", theme_font)
	spin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(spin)
	var h2 := HBoxContainer.new()
	h2.add_theme_constant_override("separation", 8)
	v.add_child(h2)
	h2.add_child(_ink_label("主将", 15))
	var opt := OptionButton.new()
	opt.add_theme_font_override("font", theme_font)
	opt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	opt.add_item("（不设主将）")
	opt.set_item_metadata(0, "")
	var gi := 1
	for m in gs.ministers:
		if m["command"] >= 50:
			opt.add_item("%s（统%d）" % [m["name"], int(m["command"])])
			opt.set_item_metadata(gi, m["id"])
			gi += 1
	h2.add_child(opt)
	var go := _ink_button("发 兵", 18)
	go.pressed.connect(func():
		var gen_id: String = opt.get_selected_metadata() if opt.selected >= 0 else ""
		var res: Dictionary = gs.dispatch(src["id"], tgt["id"], int(spin.value), gen_id)
		parts[0].queue_free()
		overlay_layer = null
		_show_toast(res["msg"])
		_refresh_all())
	v.add_child(go)
	var cancel := _ink_button("取消", 15)
	cancel.pressed.connect(func():
		parts[0].queue_free()
		overlay_layer = null)
	v.add_child(cancel)


func _on_move_dialog() -> void:
	if selected_province == "":
		_show_toast("请先点选调出城池")
		return
	var src: Dictionary = gs.province_by_id.get(selected_province, {})
	if src.is_empty() or src["owner"] != "ming":
		_show_toast("只能在我方城池间调兵")
		return
	var parts := _paper_layer(Vector2(520, 0))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "调 兵 布 防")
	v.add_child(_ink_label("自 %s（驻军 %d 万）移驻：" % [src["name"], int(src["garrison"])], 16))
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 8)
	v.add_child(h)
	var opt := OptionButton.new()
	opt.add_theme_font_override("font", theme_font)
	opt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var midx := 0
	for p in gs.ming_provinces():
		if p["id"] != selected_province and src["adj"].has(p["id"]):
			opt.add_item(p["name"])
			opt.set_item_metadata(midx, p["id"])
			midx += 1
	h.add_child(opt)
	var spin := SpinBox.new()
	spin.min_value = 1
	spin.max_value = maxf(1, src["garrison"] - 2)
	spin.value = 5
	spin.add_theme_font_override("font", theme_font)
	h.add_child(spin)
	var go := _ink_button("调 防", 17)
	go.pressed.connect(func():
		var tgt_id: String = opt.get_selected_metadata() if opt.selected >= 0 else ""
		if tgt_id == "":
			_show_toast("该城无相邻我方城池")
			return
		var res: Dictionary = gs.move_troops(selected_province, tgt_id, int(spin.value))
		parts[0].queue_free()
		overlay_layer = null
		_show_toast(res["msg"])
		_refresh_all())
	v.add_child(go)
	var cancel := _ink_button("取消", 15)
	cancel.pressed.connect(func():
		parts[0].queue_free()
		overlay_layer = null)
	v.add_child(cancel)


## ============ 诏书推演 ============
func _show_edict(prefill := "", bind_task_id := "") -> void:
	var parts := _paper_layer(Vector2(840, 0))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "撰 写 诏 书")
	var ready_text := "AI 已连接。本季度提交后统一交由 AI 推演。" if LLMClient.is_enabled() \
		else "未配置推演引擎。无 API Key 时不能提交会推进季度的意图。"
	v.add_child(_ink_label(ready_text, 13, COL_INK_SOFT))

	var edit := TextEdit.new()
	edit.custom_minimum_size = Vector2(780, 220)
	edit.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	edit.add_theme_font_override("font", theme_font)
	edit.placeholder_text = "亲书诏书……（例：诏加派辽饷以充军实，命蓟镇严防边口，勿使建虏入塞；蠲免陕西逋赋以安流民……）"
	if prefill.strip_edges() != "":
		edit.text = prefill
	v.add_child(edit)

	var status := _ink_label("", 15, COL_SEAL)
	v.add_child(status)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	v.add_child(row)
	var send := _ink_button("颁旨并归档", 18)
	row.add_child(send)
	var keep := _ink_button("留中不发（仅退出）", 15)
	keep.pressed.connect(func():
		parts[0].queue_free()
		overlay_layer = null)
	row.add_child(keep)

	var result_view := RichTextLabel.new()
	result_view.bbcode_enabled = true
	result_view.add_theme_font_override("normal_font", theme_font)
	result_view.add_theme_font_size_override("normal_font_size", 17)
	result_view.custom_minimum_size = Vector2(780, 300)
	result_view.visible = false
	v.add_child(result_view)
	var close_row := HBoxContainer.new()
	close_row.visible = false
	v.add_child(close_row)

	send.pressed.connect(func():
		var text: String = edit.text.strip_edges()
		if text == "":
			status.text = "圣旨正文不可为空"
			return
		send.disabled = true
		keep.visible = false
		edit.editable = false
		var task_ids: Array = []
		var active_task: Dictionary = gs.task_by_id(bind_task_id) if bind_task_id != "" else (gs.active_tasks()[0] if not gs.active_tasks().is_empty() else {})
		# 季度已改为离散提交；绑定具体时政任务时仍按任务圣旨归档。
		var settlement_day: bool = bind_task_id == "" and gs.active_tasks().is_empty()
		if not settlement_day and not active_task.is_empty() and str(active_task.get("selected_solution_id", "")) != "":
			task_ids = [str(active_task.get("id", ""))]
		var issued: Dictionary
		if settlement_day:
			issued = gs.issue_edict(text, [], "", [], "", true)
		else:
			issued = gs.issue_edict(text, task_ids, str(active_task.get("selected_solution_id", "")))
		if not issued.get("ok", false):
			status.text = str(issued.get("error", "圣旨未能归档"))
			send.disabled = false
			keep.visible = true
			edit.editable = true
			return
		if settlement_day:
			status.text = "季度结算圣旨已归档，正在提交季度 AI 推演……"
			var settled: Dictionary = gs.settle_quarter()
			if not settled.get("ok", false):
				status.text = str(settled.get("msg", "季度推演未开始"))
				send.disabled = false
				keep.visible = true
				edit.editable = true
		else:
			status.text = "圣旨已归档，提交本季度后将与其他意图一起交由 AI 推演。"
			send.disabled = false
	)



func _render_edict_result(parts: Array, v: VBoxContainer, view: RichTextLabel, close_row: HBoxContainer,
		narrative: String, applied: Array, clipped: Array, edict_text: String) -> void:
	for c in v.get_children():
		if c is TextEdit:
			c.visible = false
		elif c is Label and c.text.begins_with("推演中"):
			c.text = ""
	var text := "[b][color=#a5382a]圣旨执行结果[/color][/b]\n"
	if edict_text != "":
		text += "[color=#6b5638]诏曰：%s[/color]\n\n" % edict_text
	text += narrative + "\n"
	if applied.size() > 0:
		text += "\n[b]【施行】[/b]\n"
		for a in applied:
			text += "· " + str(a) + "\n"
	if clipped.size() > 0:
		text += "\n[color=#8a8068]【有司驳回了逾越之请】[/color]\n"
		for c2 in clipped:
			text += "· " + str(c2) + "\n"
	view.text = text
	view.visible = true
	close_row.visible = true
	if close_row.get_child_count() == 0:
		var ok := _ink_button("知道了 · 返回早朝", 18)
		ok.pressed.connect(func():
			parts[0].queue_free()
			overlay_layer = null
			_show_quarter_tasks())
		close_row.add_child(ok)

	_refresh_all()


# ================= 刷新 =================
func _connect_signals() -> void:
	gs.state_changed.connect(_refresh_all)
	gs.event_raised.connect(_show_event)
	gs.game_over.connect(_show_game_over)
	gs.toast.connect(_show_toast)
	gs.ai_status.connect(_on_ai_status)
	gs.ai_failed.connect(_on_ai_failed)
	gs.quarter_report.connect(_show_quarter_report)


func _refresh_all() -> void:
	if date_label == null:
		return
	if ai_status_label:
		ai_status_label.text = "AI 推演未连接：核心回合已锁定" if not LLMClient.is_enabled() else (gs.ai_error if gs.ai_error != "" else ("AI 推演中……" if gs.simulation_in_flight else "AI 推演已连接"))
		ai_status_label.add_theme_color_override("font_color", COL_SEAL if not LLMClient.is_enabled() or gs.ai_error != "" else COL_INK_SOFT)
	if task_button:
		task_button.disabled = gs.simulation_in_flight
	top_chips["treasury"].text = "库 %d" % int(gs.treasury)
	top_chips["treasury"].add_theme_color_override("font_color", Color("e07b63") if gs.treasury < 0 else COL_GOLD)
	top_chips["pop"].text = "民 %d" % int(gs.avg_pop())
	top_chips["morale"].text = "军 %d" % int(gs.avg_morale())
	top_chips["stability"].text = "朝 %d" % int(gs.court_stability)
	top_chips["rebel"].text = "寇 %d" % int(gs.rebel_power)
	top_chips["rebel"].add_theme_color_override("font_color", Color("e07b63") if gs.rebel_power > 60 else COL_GOLD)
	top_chips["jin"].text = "金 %d" % int(gs.jin_power)
	top_chips["jin"].add_theme_color_override("font_color", Color("e07b63") if gs.jin_power > 70 else COL_GOLD)
	if status_view_buttons.has("pop"):
		status_view_buttons["pop"].text = "民心  %d" % int(gs.avg_pop())
		status_view_buttons["finance"].text = "财政  %d万两" % int(gs.treasury)
		status_view_buttons["tax"].text = "税收  %d/月" % int(_total_tax_income())
		status_view_buttons["disaster"].text = "灾害  %d处" % _disaster_count()
		status_view_buttons["war"].text = "战乱  %d" % _war_index()
	action_label.text = gs.quarter_progress_text()
	if map_canvas and map_canvas.material:
		map_canvas.sync_uniforms()
	map_canvas.queue_redraw()


func _total_tax_income() -> float:
	var income := 0.0
	for province in gs.ming_provinces():
		income += float(province.get("tax", 0.0)) * (0.5 + float(province.get("pop", 0.0)) / 100.0)
	return income


func _disaster_count() -> int:
	var count := 0
	for province in gs.ming_provinces():
		var hardship := (55.0 - float(province.get("pop", 0.0))) * 1.7 + (50.0 - float(province.get("morale", 0.0))) * 0.4
		if hardship >= 28.0:
			count += 1
	for entry in gs.recent_history(12):
		var text := str(entry)
		if text.contains("灾") or text.contains("旱") or text.contains("饥") or text.contains("疫") or text.contains("水患"):
			count += 1
	return count


func _war_index() -> int:
	var occupied := 0
	for province in gs.provinces:
		if str(province.get("owner", "ming")) != "ming":
			occupied += 1
	return clampi(int((float(gs.rebel_power) + float(gs.jin_power)) * 0.5 + occupied * 8.0), 0, 100)


func _on_ai_status(text: String) -> void:
	if ai_status_label:
		ai_status_label.text = text
	_refresh_all()


func _show_quarter_report(report: Dictionary) -> void:
	var parts := _paper_layer(Vector2(980, 700))
	var v: VBoxContainer = parts[1]
	_paper_title(v, "季度结算 · " + str(report.get("quarter", "")))
	var lines := PackedStringArray()
	lines.append(str(report.get("narrative", "季度推演完成。")))
	lines.append("\n任务判定：")
	for update in report.get("task_updates", []):
		lines.append("· %s：%s。%s" % [str(update.get("task_id", "")), str(update.get("status", "")), str(update.get("resolution", update.get("continuation", "")))])
	var treasury: Dictionary = report.get("treasury", {})
	if not treasury.is_empty():
		lines.append("\n财政：岁入 %s，岁出 %s，净变动 %s。" % [treasury.get("income", "?"), treasury.get("expense", "?"), treasury.get("delta", "?")])
	var events: Array = report.get("events", [])
	if not events.is_empty():
		lines.append("\n本季度事件：")
		for event in events:
			if event is Dictionary:
				lines.append("· %s：%s" % [str(event.get("title", event.get("id", "事件"))), str(event.get("narrative", event.get("consequences", "")))])
	var battles: Array = report.get("battles", [])
	if not battles.is_empty():
		lines.append("\n本季度战事：")
		for battle in battles:
			if battle is Dictionary:
				var source := str(battle.get("source", ""))
				var target := str(battle.get("target", ""))
				lines.append("· %s -> %s：%s。%s" % [source, target, str(battle.get("outcome", "")), str(battle.get("narrative", battle.get("losses", "")))])
	lines.append("\n本季度正式圣旨：%d 道。" % report.get("edicts", []).size())
	var view := RichTextLabel.new()
	view.bbcode_enabled = true
	view.text = "\n".join(lines)
	view.custom_minimum_size = Vector2(900, 500)
	view.add_theme_font_override("normal_font", theme_font)
	view.add_theme_font_size_override("normal_font_size", 16)
	v.add_child(view)
	var close := _ink_button("收卷 · 进入新季度", 17)
	close.pressed.connect(func(): parts[0].queue_free())
	v.add_child(close)


func _on_ai_failed(text: String) -> void:
	if ai_status_label:
		ai_status_label.text = "AI 推演失败：" + text
	_refresh_all()


var _toast_tween: Tween
func _show_toast(text: String) -> void:
	if sfx_war != null and (text.begins_with("【急报】") or text.contains("出征") or text.contains("大破") or text.contains("攻城")):
		sfx_war.play()
	toast_label.text = text
	if _toast_wrap:
		_toast_wrap.modulate.a = 1.0
	if _toast_tween:
		_toast_tween.kill()
	_toast_tween = create_tween()
	_toast_tween.tween_interval(2.4)
	if _toast_wrap:
		_toast_tween.tween_property(_toast_wrap, "modulate:a", 0.0, 0.8)
