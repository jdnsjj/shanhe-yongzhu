# -*- coding: utf-8 -*-
"""Remove the generated paper surround while preserving enclosed artwork."""
from collections import deque
from pathlib import Path
from statistics import median

from PIL import Image

FILES = [
    "assets/icons/ui_btn.png",
    "assets/icons/ui_btn_hover.png",
    "assets/icons/ui_panel.png",
    "assets/icons/ui_dialog.png",
    "assets/icons/icon_yin.png",
    "assets/icons/icon_min.png",
    "assets/icons/icon_jun.png",
    "assets/icons/icon_chao.png",
    "assets/icons/icon_kou.png",
    "assets/icons/icon_jin.png",
    "assets/icons/seal_yz.png",
]

# The generated backgrounds are softly textured, so use a band rather than a
# single exact color. Flood fill prevents that band from crossing dark artwork.
SOFT_DISTANCE = 68
HARD_DISTANCE = 38
PAD = 2


def color_distance(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def remove_border_background(path: Path) -> None:
    source = Image.open(path).convert("RGBA")
    w, h = source.size
    rgb = source.convert("RGB")
    pixels = rgb.load()
    border = []
    for x in range(w):
        border.extend((pixels[x, 0], pixels[x, h - 1]))
    for y in range(1, h - 1):
        border.extend((pixels[0, y], pixels[w - 1, y]))
    bg = tuple(int(median(channel)) for channel in zip(*border))

    removable = bytearray(w * h)
    queue = deque()

    def enqueue(x, y):
        index = y * w + x
        if removable[index]:
            return
        if color_distance(pixels[x, y], bg) <= SOFT_DISTANCE:
            removable[index] = 1
            queue.append((x, y))

    for x in range(w):
        enqueue(x, 0)
        enqueue(x, h - 1)
    for y in range(1, h - 1):
        enqueue(0, y)
        enqueue(w - 1, y)

    while queue:
        x, y = queue.popleft()
        if x:
            enqueue(x - 1, y)
        if x + 1 < w:
            enqueue(x + 1, y)
        if y:
            enqueue(x, y - 1)
        if y + 1 < h:
            enqueue(x, y + 1)

    alpha_values = bytearray([255]) * (w * h)
    for y in range(h):
        for x in range(w):
            index = y * w + x
            if removable[index]:
                distance = color_distance(pixels[x, y], bg)
                # Keep a small anti-aliased fringe instead of a gray halo.
                alpha_values[index] = max(0, min(255, int(
                    (distance - HARD_DISTANCE) * 255 / (SOFT_DISTANCE - HARD_DISTANCE)
                )))
    out = source.copy()
    out.putalpha(Image.frombytes("L", (w, h), bytes(alpha_values)))

    bbox = out.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError(f"{path} became fully transparent")
    left, top, right, bottom = bbox
    left = max(0, left - PAD)
    top = max(0, top - PAD)
    right = min(w, right + PAD)
    bottom = min(h, bottom + PAD)
    out = out.crop((left, top, right, bottom))
    out.save(path, "PNG", optimize=True)
    transparent = sum(1 for value in out.getchannel("A").getdata() if value == 0)
    total = out.width * out.height
    print(f"{path.name} -> {out.size}, transparent={transparent / total:.1%}")


for filename in FILES:
    remove_border_background(Path(filename))
