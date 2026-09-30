using System.Text.Json;
using System.Text.Json.Nodes;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;

const double MinLon = 72, MaxLon = 143, MinLat = 13, MaxLat = 53;
var root = FindRoot();
var geoDir = Path.Combine(root, "tools", "MapGen", "geo");
var china = JsonNode.Parse(File.ReadAllText(Path.Combine(geoDir, "cn_provinces.json")))!;
var world = JsonNode.Parse(File.ReadAllText(Path.Combine(geoDir, "ne_world.geojson")))!;
var provinces = new Dictionary<string, List<List<double[]>>>();
var labels = new Dictionary<string, (double x, double y)>();
var groups = new Dictionary<string, string[]>(StringComparer.Ordinal)
{
  ["jingzhi"] = ["北京市", "天津市", "河北省"],
  ["shandong"] = ["山东省"], ["shanxi"] = ["山西省"],
  // 1627 年甘肃镇、宁夏镇均属陕西布政使司体系，不再作为独立省级区块。
  ["shaanxi"] = ["陕西省", "宁夏回族自治区", "甘肃省"],
 ["henan"] = ["河南省"], ["nanzhili"] = ["江苏省", "安徽省", "上海市"],
 ["huguang"] = ["湖北省", "湖南省"], ["zhejiang"] = ["浙江省"], ["jiangxi"] = ["江西省"],
 ["fujian"] = ["福建省"], ["guangdong"] = ["广东省", "海南省", "香港特别行政区", "澳门特别行政区"],
 ["guangxi"] = ["广西壮族自治区"], ["sichuan"] = ["四川省", "重庆市"],
 ["guizhou"] = ["贵州省"], ["yunnan"] = ["云南省"]
};
var featureByName = Features(china).Where(f => f["properties"]?["name"] is not null)
    .ToDictionary(f => f["properties"]!["name"]!.GetValue<string>(), StringComparer.Ordinal);
foreach (var (id, names) in groups)
{
    var rings = new List<List<double[]>>();
    foreach (var name in names)
        if (featureByName.TryGetValue(name, out var feature)) rings.AddRange(ProjectGeometry(feature["geometry"]));
    // 同一明代行政区可能由多个现代省份组成，先做几何并集以消除现代省界内缝。
    provinces[id] = MergeRings(rings);
    labels[id] = Centroid(provinces[id]);
}
// 1582 年并非现代国界：内蒙古、吉林、黑龙江划为鞑靼/女真势力；新疆、西藏单列为历史势力。
var external = new List<Region>();
// 辽东都司是边防军政机构，不属于十三布政使司；作为后金边防区域绘制。
AddChinaRegion("liaodong", "辽东都司", "jin", ["辽宁省"], featureByName, external);
// 青海地区在 1627 年不属于明代布政使司内地，按西海诸部外部势力绘制。
AddChinaRegion("kokonor", "西海蒙古诸部", "tatar", ["青海省"], featureByName, external);
AddChinaRegion("tatar", "鞑靼", "tatar", ["内蒙古自治区"], featureByName, external);
AddChinaRegion("manchuria", "女真", "jin", ["吉林省", "黑龙江省"], featureByName, external);
AddChinaRegion("yilibili", "亦力把里", "tatar", ["新疆维吾尔自治区"], featureByName, external);
AddChinaRegion("usitibet", "乌斯藏都司", "ming", ["西藏自治区"], featureByName, external);
var countryMap = new Dictionary<string, (string id, string name, string faction, string color)>
{
  ["Mongolia"]=("mongol","蒙古诸部","tatar","81785d"), ["Russia"]=("russia","俄国（西伯利亚）","russia","92907b"),
  ["Japan"]=("japan","日本（德川幕府）","japan","9b8068"), ["South Korea"]=("korea","朝鲜王朝","korea","8f7666"),
  ["North Korea"]=("korea","朝鲜王朝","korea","8f7666"), ["Vietnam"]=("vietnam","安南诸政权","vietnam","8c806d"),
  ["Laos"]=("laos","澜沧王国","laos","8c806d"), ["Thailand"]=("siam","暹罗阿瑜陀耶","siam","8c806d"),
  ["Myanmar"]=("burma","缅甸东吁王朝","burma","8c806d"), ["Cambodia"]=("cambodia","柬埔寨王国","cambodia","8c806d"),
  ["Philippines"]=("philippines","西属菲律宾","philippines","8c806d")
};
var countryRings = new Dictionary<string, (string name, string faction, string color, List<List<double[]>> rings)>();
foreach (var f in Features(world))
{
    var name = f["properties"]?["ADMIN"]?.GetValue<string>() ?? "";
    if (!countryMap.TryGetValue(name, out var info)) continue;
    if (!countryRings.TryGetValue(info.id, out var aggregate))
        aggregate = (info.name, info.faction, info.color, new List<List<double[]>>());
    aggregate.rings.AddRange(ProjectGeometry(f["geometry"], true, true));
    countryRings[info.id] = aggregate;
}
foreach (var (id, info) in countryRings)
    external.Add(new Region(id, info.name, info.faction, info.color, info.rings));
// 1627 年台湾西南部已由荷兰东印度公司经营，不能作为大明省份绘制。
external.Add(new Region("taiwan", "台湾（荷兰东印度公司）", "dutch", "8d7861", GetRings(featureByName, "台湾省", true, true)));
var output = new Dictionary<string, object?>
{
 ["version"] = 3, ["map_size"] = new[] { 1920, 1080 }, ["projection"] = new { min_lon=MinLon, max_lon=MaxLon, min_lat=MinLat, max_lat=MaxLat },
 ["provinces"] = provinces.ToDictionary(x => x.Key, x => new { name = x.Key, polys = x.Value }),
 ["decor"] = new { neighbors = new[] { Pos("瓦剌",88,46), Pos("哈密卫",93.5,42.5), Pos("乌斯藏",89,30.5), Pos("女真",128,45) }, seas = new[] { Pos("渤海",120.5,38.5), Pos("黄海",124,35.5), Pos("东海",127,29), Pos("南海",114,16) } }
};
var opts = new JsonSerializerOptions { WriteIndented=true, Encoder=System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
File.WriteAllText(Path.Combine(root,"data","province_shapes.json"), JsonSerializer.Serialize(output, opts));
var layout = labels.ToDictionary(x => x.Key, x => new { anchor = new[] { x.Value.x, x.Value.y }, angle = x.Key == "gansu" ? 20 : 0, size = x.Key == "gansu" ? 28 : 25 });
File.WriteAllText(Path.Combine(root,"data","label_layout.json"), JsonSerializer.Serialize(new { labels=layout }, opts));
File.WriteAllText(Path.Combine(root,"data","world_regions.json"), JsonSerializer.Serialize(external, opts));
Console.WriteLine($"Generated {provinces.Count} Ming provinces and {external.Count} external regions.");

List<JsonNode> Features(JsonNode node) => node["features"]!.AsArray().Where(x => x is not null).Select(x => x!).ToList();
List<List<double[]>> GetRings(Dictionary<string,JsonNode> map, string name, bool simplify = false, bool clip = false) => map.TryGetValue(name, out var f) ? ProjectGeometry(f["geometry"], simplify, clip) : [];
void AddChinaRegion(string id,string name,string faction,string[] names,Dictionary<string,JsonNode> map,List<Region> output) => output.Add(new Region(id,name,faction,"81785d",names.SelectMany(n=>GetRings(map,n,true,true)).ToList()));

List<List<double[]>> MergeRings(List<List<double[]>> rings)
{
    var factory = GeometryFactory.Default;
    var geometries = new List<Geometry>();
    foreach (var ring in rings)
    {
        if (ring.Count < 3) continue;
        var coords = ring.Select(p => new Coordinate(p[0], p[1])).ToList();
        if (!coords[0].Equals2D(coords[^1])) coords.Add(coords[0]);
        try
        {
            var polygon = factory.CreatePolygon(coords.ToArray());
            geometries.Add(polygon.IsValid ? polygon : polygon.Buffer(0));
        }
        catch (TopologyException) { }
    }
    if (geometries.Count == 0) return [];
    var union = UnaryUnionOp.Union(geometries);
    var output = new List<List<double[]>>();
    AppendExteriorRings(union, output);
    return output;

    static void AppendExteriorRings(Geometry geometry, List<List<double[]>> output)
    {
        for (var i = 0; i < geometry.NumGeometries; i++)
        {
            var part = geometry.GetGeometryN(i);
            if (part is Polygon polygon)
            {
                var ring = polygon.ExteriorRing.Coordinates
                    .Select(c => new[] { c.X, c.Y }).ToList();
                if (ring.Count >= 4) output.Add(ring);
            }
            else if (part.NumGeometries > 1)
            {
                AppendExteriorRings(part, output);
            }
        }
    }
}

List<List<double[]>> ProjectGeometry(JsonNode? geometry, bool simplify = false, bool clip = false)
{
    var result = new List<List<double[]>>(); if (geometry is null) return result;
    var type = geometry["type"]?.GetValue<string>(); var coords = geometry["coordinates"];
    // 省区只需要外环。把 GeoJSON 孔洞也作为独立填充多边形会造成错误填色，
    // 同时会让标签质心被离岛和退化环拉偏。
    if (type == "Polygon")
    {
        var rings = coords!.AsArray();
        if (rings.Count > 0) AddProjectedRing(result, ProjectRing(rings[0]!), simplify, clip);
    }
    else if (type == "MultiPolygon")
    {
        foreach (var poly in coords!.AsArray())
        {
            var rings = poly!.AsArray();
            if (rings.Count > 0) AddProjectedRing(result, ProjectRing(rings[0]!), simplify, clip);
        }
    }
    return result.Where(r => r.Count >= 3).ToList();

    static void AddProjectedRing(List<List<double[]>> result, List<double[]> ring, bool simplify, bool clip)
    {
        if (ring.Count < 3) return;
        if (clip)
        {
            var minX = ring.Min(p => p[0]); var maxX = ring.Max(p => p[0]);
            var minY = ring.Min(p => p[1]); var maxY = ring.Max(p => p[1]);
            // Keep a small margin so coastlines crossing the playable frame are retained.
            if (maxX < -0.05 || minX > 1.05 || maxY < -0.05 || minY > 1.05) return;
        }
        if (simplify) ring = SimplifyRing(ring, 240, 0.0015);
        if (ring.Count >= 3) result.Add(ring);
    }

    static List<double[]> SimplifyRing(List<double[]> ring, int maxPoints, double tolerance)
    {
        var filtered = new List<double[]>(Math.Min(ring.Count, maxPoints));
        double[]? previous = null;
        foreach (var point in ring)
        {
            if (previous is not null)
            {
                var dx = point[0] - previous[0]; var dy = point[1] - previous[1];
                if (dx * dx + dy * dy < tolerance * tolerance) continue;
            }
            filtered.Add(point); previous = point;
        }
        if (filtered.Count <= maxPoints) return filtered;
        var stride = (int)Math.Ceiling(filtered.Count / (double)maxPoints);
        var sampled = filtered.Where((_, i) => i % stride == 0).ToList();
        return sampled.Count >= 3 ? sampled : filtered.Take(maxPoints).ToList();
    }
}
List<double[]> ProjectRing(JsonNode ring) => ring.AsArray().Select(p => { var a=p!.AsArray(); return new[]{ (a[0]!.GetValue<double>()-MinLon)/(MaxLon-MinLon), 1.0-(a[1]!.GetValue<double>()-MinLat)/(MaxLat-MinLat) }; }).ToList();
(double x,double y) Centroid(List<List<double[]>> rings)
{
    // 用有效外环的面积加权质心，避免多省合并、离岛和小退化环把标签推到省外。
    double totalArea = 0, weightedX = 0, weightedY = 0;
    foreach (var ring in rings)
    {
        if (ring.Count < 3) continue;
        double twiceArea = 0, cx = 0, cy = 0;
        for (var i = 0; i < ring.Count; i++)
        {
            var a = ring[i]; var b = ring[(i + 1) % ring.Count];
            var cross = a[0] * b[1] - b[0] * a[1];
            twiceArea += cross;
            cx += (a[0] + b[0]) * cross;
            cy += (a[1] + b[1]) * cross;
        }
        var area = Math.Abs(twiceArea) / 2.0;
        if (area < 1e-10) continue;
        weightedX += (cx / (3.0 * twiceArea)) * area;
        weightedY += (cy / (3.0 * twiceArea)) * area;
        totalArea += area;
    }
    if (totalArea > 0)
    {
        var weighted = (x: weightedX / totalArea, y: weightedY / totalArea);
        if (rings.Any(r => Contains(r, weighted.x, weighted.y))) return weighted;

        // 多个不连续外环的加权中心可能落在省区之间，退回最大主外环内部。
        var largest = rings
            .Where(r => r.Count >= 3)
            .OrderByDescending(r => Math.Abs(r.Zip(r.Skip(1).Append(r[0]), (a, b) => a[0] * b[1] - b[0] * a[1]).Sum()) / 2.0)
            .FirstOrDefault();
        if (largest is not null) return RingCentroid(largest);
    }
    var points = rings.SelectMany(x => x).ToList();
    return points.Count == 0 ? (.5, .5) : (points.Average(x => x[0]), points.Average(x => x[1]));

    static (double x, double y) RingCentroid(List<double[]> ring)
    {
        double twiceArea = 0, cx = 0, cy = 0;
        for (var i = 0; i < ring.Count; i++)
        {
            var a = ring[i]; var b = ring[(i + 1) % ring.Count];
            var cross = a[0] * b[1] - b[0] * a[1];
            twiceArea += cross;
            cx += (a[0] + b[0]) * cross;
            cy += (a[1] + b[1]) * cross;
        }
        if (Math.Abs(twiceArea) < 1e-10)
            return (ring.Average(p => p[0]), ring.Average(p => p[1]));
        return (cx / (3.0 * twiceArea), cy / (3.0 * twiceArea));
    }

    static bool Contains(List<double[]> ring, double x, double y)
    {
        var inside = false;
        for (var i = 0; i < ring.Count; i++)
        {
            var a = ring[i]; var b = ring[(i + 1) % ring.Count];
            if ((a[1] > y) == (b[1] > y)) continue;
            if (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }
}
object Pos(string text,double lon,double lat) => new { text, pos = new[]{(lon-MinLon)/(MaxLon-MinLon),1-(lat-MinLat)/(MaxLat-MinLat)} };
static string FindRoot() { var d=new DirectoryInfo(Environment.CurrentDirectory); while(d!=null){if(File.Exists(Path.Combine(d.FullName,"project.godot")))return d.FullName;d=d.Parent!;} throw new Exception("project.godot not found"); }
record Region(string id,string name,string faction,string color,List<List<double[]>> rings);
