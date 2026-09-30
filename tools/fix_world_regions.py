#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_world_regions.py — 一次性修复 world_regions.json：
把所有 ring 裁剪到归一化地图范围 [0,1]x[0,1]（Sutherland–Hodgman），
完全在图外的环剔除，退化环(<3点)剔除。修复地图上方越界色块。
"""
import json
import shutil
from pathlib import Path

SRC = Path("data/world_regions.json")
BAK = Path("data/world_regions.backup.json")

RECT = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
EPS = 1e-9


def clip_edge(poly, ax, ay, bx, by):
    """对半平面 (b-a) 左侧保留。"""
    if not poly:
        return []
    out = []
    n = len(poly)
    for i in range(n):
        cur = poly[i]
        nxt = poly[(i + 1) % n]
        cin = (bx - ax) * (cur[1] - ay) - (by - ay) * (cur[0] - ax) >= -EPS
        nin = (bx - ax) * (nxt[1] - ay) - (by - ay) * (nxt[0] - ax) >= -EPS
        if cin:
            out.append(cur)
        if cin != nin:
            # 与裁剪线求交
            dx, dy = nxt[0] - cur[0], nxt[1] - cur[1]
            ex, ey = bx - ax, by - ay
            den = dx * ey - dy * ex
            if abs(den) < EPS:
                t = 0.0
            else:
                t = ((ax - cur[0]) * ey - (ay - cur[1]) * ex) / den
            t = min(max(t, 0.0), 1.0)
            out.append((cur[0] + dx * t, cur[1] + dy * t))
    return out


def clip_ring(ring):
    poly = [(float(p[0]), float(p[1])) for p in ring]
    for i in range(4):
        ax, ay = RECT[i]
        bx, by = RECT[(i + 1) % 4]
        poly = clip_edge(poly, ax, ay, bx, by)
        if not poly:
            return []
    # 去重相邻点
    dedup = []
    for p in poly:
        if not dedup or abs(dedup[-1][0] - p[0]) > 1e-7 or abs(dedup[-1][1] - p[1]) > 1e-7:
            dedup.append(p)
    if len(dedup) > 1 and abs(dedup[0][0] - dedup[-1][0]) < 1e-7 and abs(dedup[0][1] - dedup[-1][1]) < 1e-7:
        dedup.pop()
    return dedup


def main():
    if not BAK.exists():
        shutil.copy(SRC, BAK)
        print("backup ->", BAK)
    data = json.loads(SRC.read_text(encoding="utf-8"))
    total_before = total_after = dropped = clipped = 0
    for region in data:
        new_rings = []
        for ring in region.get("rings", []):
            total_before += 1
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            inside = all(0 <= x <= 1 and 0 <= y <= 1 for x, y in ring)
            if inside:
                new_rings.append(ring)  # 原样保留
                total_after += 1
                continue
            c = clip_ring(ring)
            if len(c) >= 3:
                new_rings.append([[round(x, 6), round(y, 6)] for x, y in c])
                total_after += 1
                clipped += 1
            else:
                dropped += 1
        region["rings"] = new_rings
    SRC.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"rings: before={total_before} after={total_after} clipped={clipped} dropped={dropped}")


if __name__ == "__main__":
    main()
