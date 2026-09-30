# -*- coding: utf-8 -*-
"""从 world-atlas 50m TopoJSON 提取明朝周边轮廓（高精度），写入 province_shapes.json decor.world
投影参数直接读取 province_shapes.json 的 projection 字段。"""
import json, io, math

SRC_WORLD = "tools/world50m.json"
SRC_SHAPES = "data/province_shapes.json"

WANT = {
    "Japan": {"label": "日 本"},
    "South Korea": {"label": "朝鲜"},
    "North Korea": {"label": None},
    "Vietnam": {"label": "安 南"},
    "Laos": {"label": None},
    "Thailand": {"label": None},
    "Myanmar": {"label": None},
    "Cambodia": {"label": None},
    "Philippines": {"label": "吕 宋"},
    "Mongolia": {"label": None},
    "Russia": {"label": None},
    "Ryukyu Islands": {"label": None},
}
TRIBUTARY = {"Japan": False, "South Korea": True, "North Korea": False, "Vietnam": True}

def topo_arcs(topo):
    tr = topo["transform"]
    sx, sy = tr["scale"]; tx, ty = tr["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs

def ring_from_indices(arcs, idxs):
    pts = []
    for idx in idxs:
        rev = idx < 0
        a = arcs[~idx] if rev else arcs[idx]
        seg = a[::-1] if rev else list(a)
        if pts and pts[-1] == seg[0]:
            pts.extend(seg[1:])
        else:
            pts.extend(seg)
    return pts

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
        l = rdp(points[:idx + 1], eps); r = rdp(points[idx:], eps)
        return l[:-1] + r
    return [points[0], points[-1]]

def dedupe(points, eps=1e-7):
    if not points:
        return points
    out = [points[0]]
    for p in points[1:]:
        if abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) <= eps and abs(out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out

def main():
    topo = json.load(io.open(SRC_WORLD, encoding="utf-8"))
    shapes = json.load(io.open(SRC_SHAPES, encoding="utf-8"))
    pj = shapes["projection"]
    s, ox, oy = pj["s"], pj["ox"], pj["oy"]

    def to_norm(lon, lat):
        x = math.radians(lon)
        y = -math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
        return [round(x * s + ox, 4), round(y * s + oy, 4)]

    arcs = topo_arcs(topo)
    EPS = 0.0008
    out = []
    for g in topo["objects"]["countries"]["geometries"]:
        name = g.get("properties", {}).get("name", "")
        if name not in WANT:
            continue
        info = WANT[name]
        geoms = []
        t = g["type"]
        if t == "Polygon":
            geoms = [g["arcs"]]
        elif t == "MultiPolygon":
            geoms = [poly[0:1] for poly in g["arcs"]]  # 每个多边形取外环
        rings_out = []
        for poly_arcs in geoms:
            for arcs_idxs in poly_arcs:
                pts = ring_from_indices(arcs, arcs_idxs)
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts = pts[:-1]
                proj = [to_norm(lo, la) for lo, la in pts]
                simp = rdp(proj, EPS)
                simp = dedupe(simp)
                if len(simp) >= 4:
                    rings_out.append(simp)
        if rings_out:
            out.append({
                "id": name,
                "label": info["label"],
                "tributary": TRIBUTARY.get(name, False),
                "rings": rings_out,
            })

    shapes["decor"]["world"] = out
    with io.open(SRC_SHAPES, "w", encoding="utf-8") as f:
        json.dump(shapes, f, ensure_ascii=False)
    npts = sum(len(r) for c in out for r in c["rings"])
    print("countries:", [c["id"] for c in out], "total pts:", npts)

if __name__ == "__main__":
    main()
