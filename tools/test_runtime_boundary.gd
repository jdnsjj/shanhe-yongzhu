extends SceneTree
## 运行时边界契约测试：游戏代码不得依赖或启动 Python。
## Python 仅允许存在于 tools/ 开发辅助目录。
## 运行：godot --headless --path . --script tools/test_runtime_boundary.gd

const RUNTIME_FILES := [
	"res://project.godot",
]
const RUNTIME_DIRS := [
	"res://scripts",
	"res://scenes",
]
const FORBIDDEN_PATTERNS := [
	"python",
	".py",
	".pyc",
	"os.execute",
	"os.create_process",
	"subprocess",
]


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var files: Array[String] = []
	for path in RUNTIME_FILES:
		files.append(path)
	for directory in RUNTIME_DIRS:
		_collect_files(directory, files)

	var violations: Array[String] = []
	for path in files:
		var file := FileAccess.open(path, FileAccess.READ)
		if file == null:
			violations.append("无法读取运行时文件：%s" % path)
			continue
		var content := file.get_as_text().to_lower()
		for pattern in FORBIDDEN_PATTERNS:
			if content.contains(pattern):
				violations.append("%s 包含禁止的运行时引用：%s" % [path, pattern])
	if violations.is_empty():
		print("运行时边界契约通过：Godot 游戏代码未发现 Python 依赖或外部进程调用。")
		quit(0)
		return
	for violation in violations:
		print("- " + violation)
	print("运行时边界契约失败：%d 项" % violations.size())
	quit(1)


func _collect_files(directory: String, result: Array[String]) -> void:
	var dir := DirAccess.open(directory)
	if dir == null:
		result.append(directory)
		return
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if entry != "." and entry != "..":
			var path := directory.path_join(entry)
			if dir.current_is_dir():
				_collect_files(path, result)
			else:
				result.append(path)
		entry = dir.get_next()
	dir.list_dir_end()
