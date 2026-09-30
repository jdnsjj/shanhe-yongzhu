# -*- coding: utf-8 -*-
"""把全国省份 GeoJSON 转成游戏用的省份多边形（墨卡托投影 + RDP 简化）
布局：中国缩至画布中央偏左 ~42% 宽，右侧留海与日本/朝鲜，下留中南半岛/吕宋。
投影参数写入 province_shapes.json 供 build_world.py 复用。"""
import json, math, io

SRC = "tools/china_full.json"
DST = "data/province_shapes.json"

ADCODE_MAP = {
    110000: "jingzhi", 120000: "jingzhi", 130000: "jingzhi",
    310000: "nanzhili", 320000: "nanzhili", 340000: "nanzhili",
    370000: "shandong", 140000: "shanxi", 610000: "shaanxi", 640000: "shaanxi",
    620000: "gansu", 410000: "henan", 420000: "huguang", 430000: "huguang",
    330000: "zhejiang", 360000: "jiangxi", 350000: "fujian",
    440000: "guangdong", 460000: "guangdong",
    450000: "guangxi", 520000: "guizhou", 530000: "yunnan",
    500000: "sichuan", 510000: "sichuan", 210000: "liaodong",
}
PID_NAME = {
    "jingzhi": "北直隶", "nanzhili": "南直隶", "shandong": "山东", "shanxi": "山西",
    "shaanxi": "陕西", "gansu": "甘肃", "henan": "河南", "huguang": "湖广",
    "zhejiang": "浙江", "jiangxi": "江西", "fujian": "福建", "guangdong": "广东",
    "guangxi": "广西", "guizhou": "贵州", "yunnan": "云南", "sichuan": "四川",
    "liaodong": "辽东",
}

def mercator(lon, lat):
    x = math.radians(lon)
    y = -math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))   # 取负：北在上
    return x, y

def rdp(points, eps):
    if len(points) < 3:
        return points
    def perp(p, a, b):
        ax, ay = a; bx, by = b; px, py = p
        dx, dy = bx - ax, by - ay
        if dx == dy == 0:
            return math.hypot(px - ax, py - ay)
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    dmax, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        d = perp(points[i], points[0], points[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        left = rdp(points[:idx + 1], eps)
        right = rdp(points[idx:], eps)
        return left[:-1] + right
    return [points[0], points[-1]]

def dedupe(points, eps=1e-7):
    """去除连续重复/退化点，避免三角化失败"""
    if not points:
        return points
    out = [points[0]]
    for p in points[1:]:
        if abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) <= eps and abs(out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out

def ring_area_centroid(pts):
    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(a) < 1e-12:
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        return 0.0, (sum(xs) / len(xs), sum(ys) / len(ys))
    return a / 2.0, (cx / (3 * a), cy / (3 * a))

def main():
    data = json.load(io.open(SRC, encoding="utf-8"))
    EPS = 0.0025
    merged = {}
    taiwan = []

    for feat in data["features"]:
        adcode = feat["properties"].get("adcode")
        geom = feat.get("geometry")
        if not geom:
            continue
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        target = ADCODE_MAP.get(adcode)
        rings_out = []
        for poly in polys:
            outer = poly[0]
            if len(outer) > 1 and outer[0] == outer[-1]:
                outer = outer[:-1]
            proj = [mercator(px, py) for px, py in outer]
            simp = rdp(proj, EPS)
            simp = dedupe(simp)
            if len(simp) >= 4:
                rings_out.append(simp)
        if adcode == 710000:
            taiwan = rings_out
        elif target:
            merged.setdefault(target, []).extend(rings_out)

    allp = [pt for rings in merged.values() for r in rings for pt in r]
    for r in taiwan:
        allp.extend(r)
    xs = [p[0] for p in allp]; ys = [p[1] for p in allp]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    # 中国占画布 ~42% 宽，居中偏左；右侧留给大海与日本，下方留给中南半岛/吕宋
    MX0, MX1, MY0, MY1 = 0.24, 0.66, 0.08, 0.86
    s = min((MX1 - MX0) / (x1 - x0), (MY1 - MY0) / (y1 - y0))
    ox = (MX0 + MX1) / 2 - (x0 + x1) / 2 * s
    oy = (MY0 + MY1) / 2 - (y0 + y1) / 2 * s

    def norm(pt):
        return [round((pt[0] * s + ox), 4), round((pt[1] * s + oy), 4)]

    out = {"projection": {"s": s, "ox": ox, "oy": oy}, "provinces": {}, "decor": {}}
    total_pts = 0
    for pid, rings in merged.items():
        best_a, best_c, prings = 0, None, []
        for r in rings:
            pr = [norm(pt) for pt in r]
            prings.append(pr)
            total_pts += len(pr)
            a, c = ring_area_centroid([(p[0], p[1]) for p in pr])
            if abs(a) > abs(best_a):
                best_a, best_c = a, c
        out["provinces"][pid] = {
            "name": PID_NAME.get(pid, pid),
            "polys": prings,
            "label": [round(best_c[0], 4), round(best_c[1], 4)],
        }

    def proj_lonlat(points):
        return [[round(v, 4) for v in norm(mercator(lo, la))] for lo, la in points]

    out["decor"]["rivers"] = {
        "黄河": proj_lonlat([(103,36.5),(104.5,37.5),(106,39),(107.5,40.5),(109.5,40.8),(111,39.8),(110.5,38),(111.5,36.5),(113.5,35),(115.5,35.5),(117,36.3),(118.8,37.6)]),
        "长江": proj_lonlat([(97,33),(99,30),(102,29),(104.5,29.5),(106.5,29.5),(109,30.5),(110.5,30),(112,30.3),(114,30.5),(115.8,29.8),(117.2,30.8),(118.8,31.8),(120.5,31.8),(121.9,31.4)]),
    }
    out["decor"]["mountains"] = proj_lonlat([(113.8,37.6),(114.2,36.8),(107,33.8),(108.5,33.9),(110,33.7),(99.5,38.6),(110,31.2),(107.5,32.3),(117.6,27.4),(116.8,25.4),(112,25.2),(114.5,25),(110,41.2)])
    out["decor"]["neighbors"] = [
        {"pos": proj_lonlat([(100,44)])[0], "text": "蒙 古"},
        {"pos": proj_lonlat([(126.5,46)])[0], "text": "后 金 · 满 洲"},
        {"pos": proj_lonlat([(128.5,38.5)])[0], "text": "朝 鲜"},
        {"pos": proj_lonlat([(140.5,37.5)])[0], "text": "日 本"},
        {"pos": proj_lonlat([(78,37)])[0], "text": "西 域"},
        {"pos": proj_lonlat([(88,30.5)])[0], "text": "乌斯藏"},
        {"pos": proj_lonlat([(105.5,20.5)])[0], "text": "安 南"},
    ]
    out["decor"]["seas"] = [
        {"pos": proj_lonlat([(124,27)])[0], "text": "东 海", "tilt": -0.25},
        {"pos": proj_lonlat([(115,16.5)])[0], "text": "南 海", "tilt": -0.2},
        {"pos": proj_lonlat([(136.5,42)])[0], "text": "日 本 海", "tilt": -0.25},
    ]
    out["decor"]["ports"] = [
        {"pos": proj_lonlat([(113.55,22.2)])[0], "text": "澳门 · 葡"},
        {"pos": proj_lonlat([(120.1,23.0)])[0], "text": "大员 · 荷兰热兰遮"},
        {"pos": proj_lonlat([(120.98,14.62)])[0], "text": "马尼拉 · 西"},
    ]
    if taiwan:
        out["decor"]["taiwan"] = [[norm(pt) for pt in r] for r in taiwan]

    with io.open(DST, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print("provinces:", len(out["provinces"]), "points:", total_pts, "taiwan rings:", len(taiwan))

if __name__ == "__main__":
    main()
