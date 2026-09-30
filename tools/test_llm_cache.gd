extends SceneTree
## LLM 请求层契约测试，不访问网络。

func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	await process_frame
	var client: Node = root.get_node("LLMClient")
	var a := {"z": {"b": 2, "a": 1}, "a": [3, 2, 1]}
	var b := {"a": [3, 2, 1], "z": {"a": 1, "b": 2}}
	if client._stable_json(a) != client._stable_json(b):
		print("契约失败：稳定 JSON 受字典插入顺序影响")
		quit(2)
	client._cache_put("contract", {"ok": true, "data": {"value": 1}}, 10.0)
	var cached = client._cache_get("contract")
	if not cached is Dictionary or not cached.get("ok", false):
		print("契约失败：本地缓存未命中")
		quit(3)
	if int(client.get_request_stats().get("cache_hits", 0)) < 1:
		print("契约失败：缓存统计未更新")
		quit(4)
	print("LLM缓存契约通过：稳定序列化、本地命中和统计均正常。")
	quit(0)
