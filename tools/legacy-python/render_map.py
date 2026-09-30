# -*- coding: utf-8 -*-
"""离线渲染古风舆图（分层版）：
产物:
  assets/map/map_base.png    3840x2160  底图：纸+排线+省份填充（接受运行时势力色 shader 重染）
  assets/map/map_lines.png   3840x2160  线层(透明)：省界/国界/海岸晕线/河流/山脉（不受染色影响）
  assets/map/map_labels.png  3840x2160  文字层(透明)：省名/海域/邻邦/据点注记
  assets/map/province_id.png            省份ID位图（每省唯一纯色）
  data/province_colors.json             颜色<->省份对照 + 省标签锚点
比例：fit_window 数学拟合（窗口=17省+日本+朝鲜+台湾+琉球+吕宋北部）。
"""
import json, math, io, hashlib, os
from shapely.geometry import shape, box
from shapely.ops import unary_union
from shapely.validation import make_valid
from PIL import Image, ImageDraw, ImageFont, ImageChops

CHINA_SRC = "tools/china_full.json"
WORLD_SRC = "tools/world50m.json"
PAPER_SRC = "assets/tex/parchment_big.jpg"
FONT_PATH = "C:/Windows/Fonts/simkai.ttf"

CANVAS_W, CANVAS_H = 1920, 1080
BASE_SCALE = 2
SS = 3
RENDER_W, RENDER_H = CANVAS_W * SS, CANVAS_H * SS

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
OWNER = {"liaodong": "jin"}

def merc(lon, lat):
    return math.radians(lon), -math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))

def topo_arcs(topo):
    tr = topo["transform"]; sx, sy = tr["scale"]; tx, ty = tr["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0; pts = []
        for dx, dy in arc:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs

def ring_from(arcs, idxs):
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

def topo_country_geom(topo, arcs, name):
    for g in topo["objects"]["countries"]["geometries"]:
        if g.get("properties", {}).get("name", "") == name:
            polys = []
            if g["type"] == "Polygon":
                polys = [ring_from(arcs, g["arcs"][0])]
            elif g["type"] == "MultiPolygon":
                for poly in g["arcs"]:
                    polys.append(ring_from(arcs, poly[0]))
            return [make_valid(shape({"type": "Polygon", "coordinates": [p + [p[0]]]})) for p in polys]
    return []

def dedupe(points, eps=1e-9):
    if not points:
        return points
    out = [points[0]]
    for p in points[1:]:
        if abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    return out

def china_feature_geom(china, adcode):
    for feat in china["features"]:
        if feat["properties"].get("adcode") == adcode and feat.get("geometry"):
            return [make_valid(shape(feat["geometry"]))]
    return []

def main():
    china = json.load(io.open(CHINA_SRC, encoding="utf-8"))
    topo = json.load(io.open(WORLD_SRC, encoding="utf-8"))
    arcs = topo_arcs(topo)

    prov_geoms = {}
    for feat in china["features"]:
        ad = feat["properties"].get("adcode")
        geom = feat.get("geometry")
        if ad not in ADCODE_MAP or not geom:
            continue
        g = make_valid(shape(geom))
        prov_geoms.setdefault(ADCODE_MAP[ad], []).append(g)
    provinces = {}
    clip_box = box(74, 15, 136, 54)
    for pid, gs in prov_geoms.items():
        u = unary_union(gs)
        u = make_valid(u).intersection(clip_box)
        if u.geom_type not in ("Polygon", "MultiPolygon"):
            parts = [g for g in getattr(u, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
            u = unary_union(parts) if parts else u
        u = u.simplify(0.02, preserve_topology=True)
        if u.is_empty:
            continue
        provinces[pid] = u

    # 塞外与现代中国其余省份（羁縻之地，浅色补全版图，不参与玩法）
    outer_china = []
    for feat in china["features"]:
        ad = feat["properties"].get("adcode")
        if ad in ADCODE_MAP or ad == 710000 or not feat.get("geometry"):
            continue
        g = make_valid(shape(feat["geometry"]))
        g = make_valid(g).intersection(box(60, 8, 150, 60))
        if not g.is_empty:
            outer_china.append(g.simplify(0.02, preserve_topology=True))

    world = {}
    world_all = {}
    for g in topo["objects"]["countries"]["geometries"]:
        nm = g.get("properties", {}).get("name", "")
        geoms = []
        if g["type"] == "Polygon":
            geoms = [ring_from(arcs, g["arcs"][0])]
        elif g["type"] == "MultiPolygon":
            for poly in g["arcs"]:
                geoms.append(ring_from(arcs, poly[0]))
        polys = []
        for p in geoms:
            poly = make_valid(shape({"type": "Polygon", "coordinates": [p + [p[0]]]}))
            poly = poly.intersection(box(55, 5, 152, 62))
            if poly.is_empty:
                continue
            parts = [gg for gg in (poly.geoms if hasattr(poly, "geoms") else [poly])
                     if gg.geom_type in ("Polygon", "MultiPolygon")]
            if parts:
                polys.append(make_valid(unary_union(parts)).simplify(0.02, preserve_topology=True))
        if not polys:
            continue
        u = make_valid(unary_union(polys))
        world_all[nm] = u
        if nm in ("Japan", "South Korea", "North Korea", "Vietnam", "Laos", "Thailand",
                  "Myanmar", "Cambodia", "Philippines", "Mongolia", "Russia"):
            world[nm] = u

    # ---- fit_window 数学拟合 ----
    required = list(provinces.values())
    for nm in ["Japan", "South Korea", "North Korea"]:
        required.extend(world[nm].geoms if world[nm].geom_type == "MultiPolygon" else [world[nm]])
    required.extend(china_feature_geom(china, 710000))
    luzon_north = [g.intersection(box(118, 12, 129, 22)) for g in
                   (world["Philippines"].geoms if "Philippines" in world else [])]
    required.extend([g for g in luzon_north if not g.is_empty])

    minx = min(g.bounds[0] for g in required); maxx = max(g.bounds[2] for g in required)
    miny = min(g.bounds[1] for g in required); maxy = max(g.bounds[3] for g in required)
    mx0, my0 = merc(minx, maxy)
    mx1, my1 = merc(maxx, miny)
    s = min((CANVAS_W - 40) / (mx1 - mx0), (CANVAS_H - 40) / (my1 - my0))
    ox = CANVAS_W / 2 - (mx0 + mx1) / 2 * s
    oy = CANVAS_H / 2 - (my0 + my1) / 2 * s
    china_px_w = (merc(125.7, 40)[0] - merc(93.5, 40)[0]) * s
    print("S=%.2f，中国占画布宽 %.1f%%" % (s, china_px_w / CANVAS_W * 100))

    def P(lon, lat):
        mx, my = merc(lon, lat)
        return ((mx * s + ox) * SS, (my * s + oy) * SS)

    def G2PX(g, scale):
        out = []
        geoms = g.geoms if g.geom_type in ("MultiPolygon", "GeometryCollection") else [g]
        for p in geoms:
            if p.geom_type != "Polygon":
                continue
            pts = []
            for lon, lat in p.exterior.coords:
                mx, my = merc(lon, lat)
                pts.append(((mx * s + ox) * scale, (my * s + oy) * scale))
            out.append(dedupe(pts, 0.01))
        return out

    # ---------- ID 位图 ----------
    id_img = Image.new("RGB", (CANVAS_W * BASE_SCALE, CANVAS_H * BASE_SCALE), (0, 0, 0))
    id_draw = ImageDraw.Draw(id_img)
    colors = {}
    ci = 0
    for pid in sorted(provinces):
        while True:
            ci += 1
            r, g_, b = (ci * 97) % 256, (ci * 181) % 256, (ci * 233) % 256
            if r + g_ + b > 90 and (r, g_, b) not in colors.values():
                break
        colors[pid] = (r, g_, b)
        for poly in G2PX(provinces[pid], BASE_SCALE):
            id_draw.polygon(poly, fill=colors[pid])

    # ---------- 底图 ----------
    paper = Image.open(PAPER_SRC).convert("RGB").resize((RENDER_W, RENDER_H), Image.LANCZOS)
    base = paper.convert("RGBA")
    noise = Image.effect_noise((RENDER_W, RENDER_H), 16).convert("RGBA")
    noise.putalpha(28)
    base = Image.alpha_composite(base, noise)

    fill_layer = Image.new("RGBA", (RENDER_W, RENDER_H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fill_layer)
    # 全世界陆地 + 塞外羁縻之地（补全画框，不留空洞）
    for nm, g in world_all.items():
        for poly in G2PX(g, SS):
            fd.polygon(poly, fill=(213, 197, 152, 135))
    for g in outer_china:
        for poly in G2PX(g, SS):
            fd.polygon(poly, fill=(216, 200, 156, 150))
    for nm, g in world.items():
        alpha = 165 if nm not in ("Mongolia", "Russia") else 120
        for poly in G2PX(g, SS):
            fd.polygon(poly, fill=(213, 197, 152, alpha))
    # 十七省（同势力 ±明度差，降饱和土黄）
    for pid, g in sorted(provinces.items()):
        h = int(hashlib.md5(pid.encode()).hexdigest()[:4], 16)
        jitter = (h % 9) - 4
        base_c = (120, 114, 128) if OWNER.get(pid) == "jin" else (198, 169, 107)
        c = tuple(max(0, min(255, v + int(v * jitter / 100))) for v in base_c)
        for poly in G2PX(g, SS):
            fd.polygon(poly, fill=c + (228,))
    # 台湾
    tw = china_feature_geom(china, 710000)
    if tw:
        twg = make_valid(unary_union(tw)).simplify(0.02, preserve_topology=True)
        for poly in G2PX(twg, SS):
            fd.polygon(poly, fill=(214, 180, 96, 225))
    # 排线只留在陆地上
    land_mask = Image.new("L", (RENDER_W, RENDER_H), 0)
    lmd = ImageDraw.Draw(land_mask)
    for pid, g in provinces.items():
        for poly in G2PX(g, SS):
            lmd.polygon(poly, fill=255)
    for nm, g in world_all.items():
        for poly in G2PX(g, SS):
            lmd.polygon(poly, fill=255)
    for g in outer_china:
        for poly in G2PX(g, SS):
            lmd.polygon(poly, fill=255)
    if tw:
        for poly in G2PX(twg, SS):
            lmd.polygon(poly, fill=255)
    hatch = Image.new("RGBA", (RENDER_W, RENDER_H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hatch)
    for i in range(-RENDER_H, RENDER_W, 26):
        hd.line([(i, 0), (i + RENDER_H, RENDER_H)], fill=(90, 70, 45, 22), width=SS)
    base.paste(hatch, (0, 0), Image.composite(hatch.split()[3], Image.new("L", (RENDER_W, RENDER_H), 0), land_mask))
    base = Image.alpha_composite(base, fill_layer)

    # 海岸晕线（底图层）
    all_land = unary_union(list(provinces.values()) + [g for g in world_all.values()] +
                           outer_china + (china_feature_geom(china, 710000) if tw else []))
    for d, a in [(0.10, 26), (0.22, 16)]:
        buffered = all_land.buffer(d)
        rings = buffered.geoms if buffered.geom_type == "MultiPolygon" else [buffered]
        for part in rings:
            coords = []
            for lon, lat in part.exterior.coords:
                mx, my = merc(lon, lat)
                coords.append(((mx * s + ox) * SS, (my * s + oy) * SS))
            ImageDraw.Draw(base).line(coords, fill=(96, 74, 44, a), width=SS * 3, joint="curve")

    # 暗角
    vig = Image.radial_gradient("L").resize((RENDER_W, RENDER_H)).point(lambda v: 255 - int(v * 0.32))
    base = ImageChops.multiply(base, Image.merge("RGBA", [vig, vig, vig, Image.new("L", (RENDER_W, RENDER_H), 255)]))

    # ---------- 线层 ----------
    lines = Image.new("RGBA", (RENDER_W, RENDER_H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lines)
    for nm, g in world_all.items():
        oc = (168, 132, 62, 190) if nm in ("South Korea", "Vietnam") else (100, 80, 50, 120)
        for poly in G2PX(g, SS):
            ld.polygon(poly, outline=oc, width=max(2, SS - 1))
    # 海岸线（中等墨线）
    coast_parts = all_land.geoms if all_land.geom_type == "MultiPolygon" else [all_land]
    for cp in coast_parts:
        coords = []
        for lon, lat in cp.exterior.coords:
            mx, my = merc(lon, lat)
            coords.append(((mx * s + ox) * SS, (my * s + oy) * SS))
        ld.line(coords, fill=(74, 56, 34, 210), width=SS * 2, joint="curve")
    # 省界（细棕线）
    for pid, g in provinces.items():
        for poly in G2PX(g, SS):
            ld.polygon(poly, outline=(128, 100, 60, 170), width=int(SS * 1.2) + 1)
    # 国界（只在势力交界处，shapely 求共享边界）
    owners = {pid: OWNER.get(pid, "ming") for pid in provinces}
    pids = sorted(provinces)
    nat_lines = []
    for i in range(len(pids)):
        for j in range(i + 1, len(pids)):
            a, b = pids[i], pids[j]
            if owners[a] == owners[b]:
                continue
            A, B = provinces[a], provinces[b]
            if A.distance(B) > 0.05:
                continue
            shared = A.boundary.intersection(B.buffer(0.004))
            if shared.is_empty:
                continue
            segs = shared.geoms if hasattr(shared, "geoms") else [shared]
            for g2 in segs:
                if g2.geom_type in ("LineString", "LinearRing"):
                    nat_lines.append(list(g2.coords))
                elif g2.geom_type == "MultiLineString":
                    for g3 in g2.geoms:
                        nat_lines.append(list(g3.coords))
    for coords in nat_lines:
        px = [((mx * s + ox) * SS, (my * s + oy) * SS) for lon, lat in coords
              for mx, my in [merc(lon, lat)]]
        ld.line(px, fill=(52, 36, 22, 235), width=SS * 3, joint="curve")
    if tw:
        for poly in G2PX(make_valid(unary_union(tw)).simplify(0.02, preserve_topology=True), SS):
            ld.polygon(poly, outline=(150, 116, 58, 200), width=int(SS * 1.4))
    rivers = {
        "黄河": [(103,36.5),(104.5,37.5),(106,39),(107.5,40.5),(109.5,40.8),(111,39.8),(110.5,38),(111.5,36.5),(113.5,35),(115.5,35.5),(117,36.3),(118.8,37.6)],
        "长江": [(97,33),(99,30),(102,29),(104.5,29.5),(106.5,29.5),(109,30.5),(110.5,30),(112,30.3),(114,30.5),(115.8,29.8),(117.2,30.8),(118.8,31.8),(120.5,31.8),(121.9,31.4)],
    }
    for k, pts in rivers.items():
        ld.line([P(lo, la) for lo, la in pts], fill=(88, 116, 138, 150), width=SS * 2, joint="curve")
    for lon, lat in [(113.8,37.6),(114.2,36.8),(107,33.8),(108.5,33.9),(110,33.7),(99.5,38.6),(110,31.2),(107.5,32.3),(117.6,27.4),(116.8,25.4),(112,25.2),(114.5,25),(110,41.2)]:
        x, y = P(lon, lat)
        ld.line([(x-7*SS, y+4*SS), (x, y-6*SS), (x+7*SS, y+4*SS)], fill=(86, 62, 34, 150), width=SS, joint="curve")

    # ---------- 文字层 ----------
    labels = Image.new("RGBA", (RENDER_W, RENDER_H), (0, 0, 0, 0))
    td = ImageDraw.Draw(labels)
    f_name = lambda size: ImageFont.truetype(FONT_PATH, size)

    def text_c(xy, s_, size, fill=(43, 32, 18, 235), anchor="mm", halo=(238, 226, 196, 210), hw=0):
        td.text(xy, s_, font=f_name(size), fill=fill, anchor=anchor, stroke_width=hw, stroke_fill=halo)

    def text_rot(xy, s_, size, deg, fill):
        f = f_name(size)
        tmp = Image.new("RGBA", (int(size * len(s_) * 1.2) + 20, size * 2), (0, 0, 0, 0))
        d2 = ImageDraw.Draw(tmp)
        d2.text((10, size // 2), s_, font=f, fill=fill, anchor="lm")
        tmp = tmp.rotate(deg, expand=True, resample=Image.BICUBIC)
        labels.alpha_composite(tmp, (int(xy[0] - tmp.width / 2), int(xy[1] - tmp.height / 2)))

    label_anchor = {}
    for pid, g in provinces.items():
        pt = g.representative_point()
        mx, my = merc(pt.x, pt.y)          # 几何是经纬度，必须先投影
        lx, ly = mx * s + ox, my * s + oy
        label_anchor[pid] = [round(lx / CANVAS_W, 4), round(ly / CANVAS_H, 4)]
        # 自适应：字号先按面积估，再量文字宽，超出省界宽度就缩
        area_px = g.area * s * s
        fs = int(min(150, max(108, 96 + math.sqrt(max(area_px, 400)) * 0.13)))
        minx, miny, maxx, maxy = g.bounds
        prov_w = (merc(maxx, 0)[0] - merc(minx, 0)[0]) * s   # 省份经度宽（画布像素）
        name = PID_NAME[pid]
        for _ in range(12):
            if fs <= 64 or f_name(int(fs * SS)).getlength(name) <= prov_w * SS * 0.86:
                break
            fs = int(fs * 0.88)
        fs = max(fs, 64)
        text_c((lx * SS, ly * SS), name, fs, fill=(28, 20, 11, 252), hw=int(SS * 1.2))

    def world_label(name, s_, size, fill=(64, 48, 26, 150)):
        if name in world:
            pt = world[name].representative_point()
            text_c(P(pt.x, pt.y), s_, size, fill=fill)
    world_label("Mongolia", "蒙 古", 34)
    world_label("Japan", "日 本", 40, (70, 52, 28, 170))
    text_c(P(128.3, 39.2), "朝 鲜", 34, fill=(120, 92, 40, 200))
    text_c(P(106.0, 20.8), "安 南", 32, fill=(120, 92, 40, 180))
    text_c(P(121.5, 16.5), "吕 宋", 32, fill=(90, 72, 44, 170))
    text_c(P(125.0, 47.5), "后金 · 满洲", 34, fill=(64, 48, 26, 150))
    text_c(P(88, 31), "乌斯藏", 32, fill=(70, 54, 32, 140))
    text_c(P(80, 38.5), "西 域", 32, fill=(70, 54, 32, 140))
    text_rot(P(124.5, 26.5), "东 海", 40, -18, (70, 56, 34, 120))
    text_rot(P(115.5, 15.5), "南 海", 40, -14, (70, 56, 34, 120))
    text_rot(P(137.5, 41.5), "日本海", 36, -20, (70, 56, 34, 110))
    for lon, lat, name in [(113.55, 22.2, "澳门·葡"), (120.1, 23.0, "大员·荷兰"), (120.98, 14.62, "马尼拉·西")]:
        x, y = P(lon, lat)
        td.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(60, 40, 20, 220), width=SS)
        text_c((x, y + 34), name, 26, fill=(96, 62, 26, 215))

    # ---------- 输出 ----------
    os.makedirs("assets/map", exist_ok=True)
    final = base.convert("RGB").resize((CANVAS_W * BASE_SCALE, CANVAS_H * BASE_SCALE), Image.LANCZOS)
    final.save("assets/map/map_base.png", optimize=True)
    lines.resize((CANVAS_W * BASE_SCALE, CANVAS_H * BASE_SCALE), Image.LANCZOS).save("assets/map/map_lines.png", optimize=True)
    labels.resize((CANVAS_W * BASE_SCALE, CANVAS_H * BASE_SCALE), Image.LANCZOS).save("assets/map/map_labels.png", optimize=True)
    id_img.save("assets/map/province_id.png", optimize=True)

    out = {"map_size": [CANVAS_W, CANVAS_H], "id_scale": BASE_SCALE, "colors": {}, "label": {}}
    for pid, c in colors.items():
        out["colors"]["%02x%02x%02x" % c] = pid
        out["label"][pid] = label_anchor[pid]
    with io.open("data/province_colors.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("saved: map_base / map_lines / map_labels / province_id / province_colors.json")

if __name__ == "__main__":
    main()
