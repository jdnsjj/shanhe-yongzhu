using Godot;

namespace ShanHeYongZhu;

/// <summary>
/// 地图特效层（C#）：季节天气粒子 + 选中省飞行动画的挂载点。
/// 由 map_canvas.gd 在 _Ready 时实例化并加为子节点。
/// </summary>
public partial class MapFx : Node2D
{
	[Export] public Color SnowColor { get; set; } = new(0.95f, 0.95f, 0.97f);
	[Export] public Color RainColor { get; set; } = new(0.62f, 0.66f, 0.72f);

	public override void _Ready()
	{
		// 任务 #2 填充：按当前季节启动雪/雨粒子
	}

	public override void _Process(double delta)
	{
		// 任务 #2 填充：季节切换响应
	}
}
