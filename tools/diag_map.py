# 一次性诊断脚本：分析 province_id.png 各省份颜色的像素分布与连通域
# 用法: python tools/diag_map.py
import json, struct, zlib
from collections import deque, Counter


def read_png(path):
    data = open(path, 'rb').read()
    pos = 8
    w = h = 0
    idat = b''
    ctype = 0
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'IDAT':
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    stride = w * ch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b = prev[i]
                c = prev[i - ch] if i >= ch else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, ch, bytes(out)


def components(w, h, ch, px, match):
    seen = bytearray(w * h)
    results = []
    for yy in range(h):
        base = yy * w
        for xx in range(w):
            i0 = base + xx
            if seen[i0] or not match(px, i0 * ch):
                continue
            q = deque([i0])
            seen[i0] = 1
            n = 0
            minx = miny = 10 ** 9
            maxx = maxy = -1
            while q:
                i = q.popleft()
                n += 1
                x = i % w
                y = i // w
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
                for d in (1, -1, w, -w):
                    j = i + d
                    if j < 0 or j >= w * h or seen[j]:
                        continue
                    if d == 1 and j % w == 0:
                        continue
                    if d == -1 and x == 0:
                        continue
                    if match(px, j * ch):
                        seen[j] = 1
                        q.append(j)
            results.append((n, minx, miny, maxx, maxy))
    results.sort(reverse=True)
    return results


def main():
    w, h, ch, px = read_png('assets/map/province_id.png')
    print('province_id.png: %dx%d ch=%d' % (w, h, ch))
    cnt = Counter()
    for i in range(0, len(px), ch):
        cnt[px[i:i + 3]] += 1
    print('全图最常见的 5 种颜色:')
    for key, n in cnt.most_common(5):
        print('  #%02x%02x%02x  %d px (%.1f%%)' % (key[0], key[1], key[2], n, 100.0 * n / (w * h)))

    colors = json.load(open('data/province_colors.json', encoding='utf-8'))
    cmap = colors['colors']
    print('\n各省份颜色分布（连通域数量 / 最大块占比 / 异常块）:')
    for hexc, pid in sorted(cmap.items(), key=lambda kv: kv[1]):
        key = bytes.fromhex(hexc)

        def match(p, i, k=key):
            return p[i:i + 3] == k

        comps = components(w, h, ch, px, match)
        total = sum(c[0] for c in comps)
        biggest = comps[0] if comps else (0, 0, 0, 0, 0)
        line = '%-10s #%s total=%7d blocks=%3d max=%7d(%.1f%%) bbox=(%d,%d)-(%d,%d)' % (
            pid, hexc, total, len(comps), biggest[0], 100.0 * biggest[0] / max(total, 1),
            biggest[1], biggest[2], biggest[3], biggest[4])
        extras = [c for c in comps[1:] if c[0] > 500]
        print(line)
        for n, minx, miny, maxx, maxy in extras[:4]:
            print('           杂块 px=%7d bbox=(%d,%d)-(%d,%d)' % (n, minx, miny, maxx, maxy))


if __name__ == '__main__':
    main()
