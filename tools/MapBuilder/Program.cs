using System.Text.Json;

var root = FindProjectRoot();
var colorsPath = Path.Combine(root, "data", "province_colors.json");
var shapesPath = Path.Combine(root, "data", "province_shapes.json");
var jsonOptions = new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
var colors = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(colorsPath)) ?? new();
var labels = colors.TryGetValue("label", out var labelElement)
    ? JsonSerializer.Deserialize<Dictionary<string, double[]>>(labelElement.GetRawText()) ?? new()
    : new Dictionary<string, double[]>();
var shapes = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(shapesPath)) ?? new();
var provinces = shapes.TryGetValue("provinces", out var provinceElement)
    ? JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(provinceElement.GetRawText()) ?? new()
    : new Dictionary<string, JsonElement>();
var worldRegions = BuildWorldRegions(shapes);

var layout = new Dictionary<string, object>();
foreach (var (pid, anchor) in labels)
{
    var angle = pid == "gansu" ? 28.0 : 0.0;
    var size = pid == "gansu" ? 30 : 26;
    layout[pid] = new { anchor, angle, size, shape_checked = provinces.ContainsKey(pid) };
}
var output = new Dictionary<string, object>
{
    ["version"] = 2,
    ["map_size"] = new[] { 1920, 1080 },
    ["labels"] = layout,
    ["regions"] = worldRegions
};
var destination = Path.Combine(root, "data", "label_layout.json");
File.WriteAllText(destination, JsonSerializer.Serialize(output, jsonOptions));
File.WriteAllText(Path.Combine(root, "data", "world_regions.json"), JsonSerializer.Serialize(worldRegions, jsonOptions));
Console.WriteLine($"Generated {layout.Count} label layouts and {worldRegions.Count} world regions");

static List<Dictionary<string, object>> BuildWorldRegions(Dictionary<string, JsonElement> shapes)
{
    var names = new Dictionary<string, (string Name, string Faction, string Color, double Angle)>
    {
        ["Mongolia"] = ("蒙古", "mongol", "7a8060", 0),
        ["Tatar"] = ("鞑靼", "tatar", "8b8068", 0),
        ["Russia"] = ("俄罗斯", "russia", "92907b", 0),
        ["Japan"] = ("日本", "japan", "9b8068", 0),
        ["South Korea"] = ("朝鲜", "korea", "8f7666", 0),
        ["North Korea"] = ("朝鲜北境", "korea", "8f7666", 0),
        ["Vietnam"] = ("安南", "vietnam", "8c806d", 0),
        ["Laos"] = ("老挝", "laos", "8c806d", 0),
        ["Thailand"] = ("暹罗", "siam", "8c806d", 0),
        ["Myanmar"] = ("缅甸", "burma", "8c806d", 0),
        ["Cambodia"] = ("柬埔寨", "cambodia", "8c806d", 0),
        ["Philippines"] = ("吕宋", "philippines", "8c806d", 0),
        ["Ryukyu Islands"] = ("琉球", "ryukyu", "8c806d", 0),
    };
    var world = shapes.TryGetValue("decor", out var decor)
        && decor.TryGetProperty("world", out var worldElement)
        ? JsonSerializer.Deserialize<List<Dictionary<string, JsonElement>>>(worldElement.GetRawText()) ?? new()
        : new List<Dictionary<string, JsonElement>>();
    var result = new List<Dictionary<string, object>>();
    foreach (var item in world)
    {
        var id = item.TryGetValue("id", out var idValue) ? idValue.GetString() ?? "" : "";
        if (!names.TryGetValue(id, out var info)) continue;
        var rings = item.TryGetValue("rings", out var ringsValue) ? JsonSerializer.Deserialize<object>(ringsValue.GetRawText())! : Array.Empty<object>();
        result.Add(new Dictionary<string, object>
        {
            ["id"] = id.ToLowerInvariant().Replace(" ", "_"), ["name"] = info.Name,
            ["faction"] = info.Faction, ["color"] = info.Color, ["angle"] = info.Angle,
            ["rings"] = rings
        });
    }
    if (!result.Any(r => (string)r["id"] == "tatar"))
        result.Add(Region("tatar", "鞑靼", "tatar", "81785d", new[] { new[] { 0.23, 0.18 }, new[] { 0.37, 0.14 }, new[] { 0.50, 0.18 }, new[] { 0.46, 0.25 }, new[] { 0.33, 0.27 }, new[] { 0.24, 0.23 } }));
    if (!result.Any(r => (string)r["id"] == "manchuria"))
        result.Add(Region("manchuria", "后金·满洲", "jin", "746b78", new[] { new[] { 0.54, 0.10 }, new[] { 0.69, 0.10 }, new[] { 0.75, 0.18 }, new[] { 0.66, 0.28 }, new[] { 0.56, 0.24 }, new[] { 0.50, 0.16 } }));
    return result;

    static Dictionary<string, object> Region(string id, string name, string faction, string color, double[][] ring)
        => new() { ["id"] = id, ["name"] = name, ["faction"] = faction, ["color"] = color, ["angle"] = 0.0, ["rings"] = new[] { ring } };
}

static string FindProjectRoot()
{
    var candidates = new[]
    {
        new DirectoryInfo(Environment.CurrentDirectory),
        new DirectoryInfo(AppContext.BaseDirectory),
    };
    foreach (var start in candidates)
    {
        var current = start;
        while (current != null)
        {
            if (File.Exists(Path.Combine(current.FullName, "project.godot"))) return current.FullName;
            current = current.Parent;
        }
    }
    throw new DirectoryNotFoundException("project.godot not found");
}
