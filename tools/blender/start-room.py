"""
Shanhe Yongzhu - start screen diorama.
Builds a dark wood study desk with a framed map, prop objects and warm lighting,
then renders a 16:9 hero image plus a blank-parchment plate for the React canvas overlay.
"""
import bpy, math, json, os
from mathutils import Vector

OUT = os.environ.get("SHANHE_OUT", "C:/Users/User/AppData/Local/dsh-blender-rt/shanhe-assets")
GEO_JSON = os.path.join(OUT, "china_full.json")
GEO_LON0, GEO_LAT0 = 104.0, 35.5
GEO_SCALE = 0.0552  # metres per degree, fits China into the paper sheet
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat_basic(name, color, rough=0.55, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def mat_wood(name, c1, c2, grain=7.0, rough=0.45, bump=0.12):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    n, l = nt.nodes, nt.links
    b = n["Principled BSDF"]
    tc = n.new("ShaderNodeTexCoord")
    mp = n.new("ShaderNodeMapping")
    l.new(tc.outputs["Object"], mp.inputs["Vector"])
    mp.inputs["Scale"].default_value = (1.0, grain, grain)
    nz = n.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 5.0
    nz.inputs["Detail"].default_value = 9.0
    nz.inputs["Roughness"].default_value = 0.62
    l.new(mp.outputs["Vector"], nz.inputs["Vector"])
    rp = n.new("ShaderNodeValToRGB")
    rp.color_ramp.elements[0].position = 0.34
    rp.color_ramp.elements[0].color = (c1[0], c1[1], c1[2], 1.0)
    rp.color_ramp.elements[1].position = 0.68
    rp.color_ramp.elements[1].color = (c2[0], c2[1], c2[2], 1.0)
    l.new(nz.outputs["Fac"], rp.inputs["Fac"])
    l.new(rp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    bp = n.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = bump
    l.new(nz.outputs["Fac"], bp.inputs["Height"])
    l.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


def mat_paper(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    n, l = nt.nodes, nt.links
    b = n["Principled BSDF"]
    nz = n.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 14.0
    nz.inputs["Detail"].default_value = 10.0
    rp = n.new("ShaderNodeValToRGB")
    rp.color_ramp.elements[0].position = 0.30
    rp.color_ramp.elements[0].color = (0.150, 0.128, 0.090, 1.0)
    rp.color_ramp.elements[1].position = 0.72
    rp.color_ramp.elements[1].color = (0.265, 0.228, 0.160, 1.0)
    rp.color_ramp.elements.new(0.5)
    rp.color_ramp.elements[2].color = (0.205, 0.176, 0.124, 1.0)
    l.new(nz.outputs["Fac"], rp.inputs["Fac"])
    l.new(rp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.82
    bp = n.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.06
    l.new(nz.outputs["Fac"], bp.inputs["Height"])
    l.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


def box(name, loc, size, mat, rot=(0, 0, 0), bev=0.012, uv=0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    o.data.materials.append(mat)
    if uv:
        uv_square(o)
    if bev:
        md = o.modifiers.new("Bevel", "BEVEL")
        md.width = bev
        md.segments = 2
        md.limit_method = "ANGLE"
    return o


def cyl(name, loc, radius, depth, mat, rot=(0, 0, 0), verts=28):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    return o


def disc(name, loc, scale, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=1.0, depth=0.006, location=loc, rotation=rot, vertices=40)
    o = bpy.context.object
    o.name = name
    o.scale = (scale[0], scale[1], 1.0)
    o.data.materials.append(mat)
    return o


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def uv_square(ob):
    """Box-projected UVs so procedural (noise/wood) materials keep an even scale
    on non-uniformly scaled cubes instead of stretching along the longest axis."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    sc = ob.scale
    for i, p in enumerate(me.polygons):
        nrm = p.normal
        ax = max(range(3), key=lambda k: abs(nrm[k]) * abs(sc[k]))
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            u, w = ((v.y, v.z), (v.x, v.z), (v.x, v.y))[ax]
            uv[li].uv = (u * sc[(ax + 1) % 3 if ax != 1 else 2], w * sc[2 if ax != 2 else 1])


FONT_PATH = os.environ.get("SHANHE_FONT", "C:/Windows/Fonts/simhei.ttf")
_FONT = None


def get_font():
    global _FONT
    if _FONT is None and os.path.exists(FONT_PATH):
        try:
            _FONT = bpy.data.fonts.load(FONT_PATH)
        except Exception as e:
            print("font load failed", e)
    return _FONT


def relief(name, text, loc, size, mat, rot=(0, 0, 0), extrude=0.006, align="CENTER"):
    """A thin extruded text object used as raised/inked detail on the map."""
    cu = bpy.data.curves.new(name, type="FONT")
    cu.body = text
    f = get_font()
    if f:
        cu.font = f
    cu.size = size
    cu.align_x = align
    cu.space_character = 1.12
    cu.extrude = extrude
    cu.bevel_depth = 0.0
    ob = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    ob.data.materials.append(mat)
    return ob


WOOD_DARK = mat_wood("wood_dark", (0.028, 0.016, 0.010), (0.070, 0.040, 0.023), grain=9.0, rough=0.58)
WOOD_DESK = mat_wood("wood_desk", (0.048, 0.026, 0.015), (0.112, 0.060, 0.033), grain=5.5, rough=0.44)
WOOD_LIGHT = mat_wood("wood_light", (0.062, 0.034, 0.019), (0.140, 0.078, 0.044), grain=4.0, rough=0.55)
WOOD_FRAME = mat_wood("wood_frame", (0.020, 0.012, 0.008), (0.058, 0.033, 0.020), grain=8.0, rough=0.40)
SILK = mat_basic("screen_silk", (0.150, 0.132, 0.100), rough=0.80)
CELADON = mat_basic("celadon", (0.135, 0.230, 0.205), rough=0.18)
BORDER_GOLD = mat_basic("border_gold", (0.32, 0.235, 0.095), rough=0.50)
COAST_INK = mat_basic("coast_ink", (0.075, 0.062, 0.048), rough=0.85)
STAIN = mat_basic("stain", (0.118, 0.100, 0.070), rough=0.85)
BAMBOO = mat_wood("bamboo_stalk", (0.055, 0.036, 0.020), (0.130, 0.088, 0.048), grain=16.0, rough=0.52, bump=0.05)
PAPER = mat_paper("parchment")
BRASS = mat_basic("brass", (0.34, 0.23, 0.095), rough=0.36, metal=1.0)
INKSTONE = mat_basic("inkstone", (0.014, 0.015, 0.017), rough=0.30)
LACQUER = mat_basic("lacquer_red", (0.115, 0.020, 0.017), rough=0.30)
JADE = mat_basic("jade", (0.105, 0.175, 0.165), rough=0.24)
CLOTH = mat_basic("cloth", (0.150, 0.140, 0.110), rough=0.90)
CLOTH_FB = mat_basic("cloth_fb", (0.098, 0.122, 0.118), rough=0.86)
INK = mat_basic("ink_black", (0.012, 0.012, 0.013), rough=0.18)
SEAL_CLAY = mat_basic("seal_clay", (0.230, 0.075, 0.058), rough=0.72)
BRUSH_HAIR = mat_basic("brush_hair", (0.028, 0.026, 0.024), rough=0.60)
MAP_RED = mat_basic("map_red", (0.130, 0.028, 0.024), rough=0.82)
MAP_TEAL = mat_basic("map_teal", (0.045, 0.072, 0.068), rough=0.82)
MAP_GOLD = mat_basic("map_gold", (0.135, 0.100, 0.042), rough=0.80)

# ---- room shell ----
box("floor", (0, 0, -0.05), (26, 20, 0.1), WOOD_DARK, bev=0, uv=1)
# floorboards: thin gaps between planks, laid front-to-back
for b in range(9):
    zx = -6.4 + b * 1.6
    box("floorboard_%d" % b, (zx, 0.0, 0.004), (1.55, 20.0, 0.012), WOOD_DARK, bev=0, uv=1)
# carpet under the desk
box("rug", (-1.10, 1.20, 0.014), (5.4, 4.2, 0.010), CLOTH_FB, bev=0, uv=1)
box("rug_border", (-1.10, 1.20, 0.020), (5.0, 3.8, 0.006), CLOTH, bev=0, uv=1)
box("rug_border2", (-1.10, 1.20, 0.025), (4.86, 3.66, 0.006), CLOTH_FB, bev=0, uv=1)
box("wall_back", (0, 4.6, 2.3), (26, 0.25, 4.6), WOOD_DARK, bev=0)
box("wall_left", (-7.4, 0, 2.3), (0.25, 20, 4.6), WOOD_DARK, bev=0)
box("beam_top", (0, 4.35, 4.25), (26, 0.6, 0.4), WOOD_DARK, bev=0.02)

# ---- screens behind the desk: silk ground + hanging bamboo blind ----
# A blind is horizontal slats threaded on two cords, rolled at the top; the painting
# (ink bamboos) lives on the silk panel behind it.
for i in range(3):
    cx = (i - 1) * 1.82
    box("screen_frame_%d" % i, (cx, 4.40, 2.15), (1.74, 0.07, 2.46), WOOD_FRAME, bev=0.015, uv=1)
    box("screen_%d" % i, (cx, 4.30, 2.15), (1.58, 0.05, 2.30), SILK, bev=0.010, uv=1)
    # painted stalks on the silk: two thin, restrained stems per panel
    for k in range(2):
        sx = cx - 0.30 + k * 0.60
        hh = 1.10 + k * 0.45
        rot_z = 0.03 * (k - 0.5) + 0.015 * i
        box("stalk_%d_%d" % (i, k), (sx, 4.262, 1.30 + hh / 2), (0.016, 0.008, hh), BAMBOO, rot=(0, rot_z, 0), bev=0.002)
        for n in range(2):
            ny = 1.75 + n * 0.42 + 0.04 * i
            ln = 0.15 + (n % 2) * 0.07
            box("leaf_%d_%d_%d" % (i, k, n), (sx + (0.07 + 0.02 * n) * (1 if n % 2 else -1), 4.258, ny),
                (ln, 0.007, 0.016), BAMBOO, rot=(0, rot_z, (0.50 if n % 2 else -0.55) + 0.10 * (k - 1)), bev=0)
    # the blind itself: slats + cords + rolled head
    n_slats = 15
    for s in range(n_slats):
        z = 3.28 - s * 0.077
        sag = 0.0035 * s  # the blind curves slightly away from the silk
        box("slat_%d_%d" % (i, s), (cx, 4.325 - sag, z), (1.44, 0.010, 0.046), BAMBOO, bev=0.0015)
    for cd in (-0.60, 0.60):
        box("blind_cord_%d_%s" % (i, "a" if cd < 0 else "b"), (cx + cd, 4.322, 2.70), (0.010, 0.010, 1.30), CLOTH, bev=0)
    cyl("blind_roll_%d" % i, (cx, 4.325, 3.34), 0.042, 1.50, BAMBOO, rot=(0, math.pi / 2, 0), verts=18)
    for e in (-0.76, 0.76):
        box("blind_stile_%d_%s" % (i, "a" if e < 0 else "b"), (cx + e, 4.325, 2.68), (0.05, 0.03, 1.34), WOOD_FRAME, bev=0.006)

# ---- left window bay: papered lattice window with a bamboo blind ----
box("window", (-7.24, 1.6, 2.5), (0.05, 3.3, 2.0), CLOTH, bev=0)
box("window_frame", (-7.18, 1.6, 2.5), (0.10, 3.5, 2.2), WOOD_FRAME, bev=0.02, uv=1)
for mb in (1.6, 2.5, 3.4):
    box("win_mullion_%.1f" % mb, (-7.10, 1.6, mb), (0.06, 3.3, 0.05), WOOD_FRAME, bev=0.005)
for mw in (0.35, 1.05, 1.75, 2.45):
    box("win_muntin_%.2f" % mw, (-7.10, mw, 2.5), (0.05, 0.05, 2.0), WOOD_FRAME, bev=0.005)
for s in range(11):
    box("win_slat_%d" % s, (-7.05, 1.6, 1.72 + s * 0.075), (0.008, 3.10, 0.042), BAMBOO, bev=0.0015)
cyl("win_roll", (-7.05, 1.6, 1.80), 0.045, 3.20, BAMBOO, rot=(math.pi / 2, 0, 0), verts=18)

# ---- desk ----
box("desk_top", (0, 0.7, 0.79), (5.2, 2.6, 0.15), WOOD_DESK, bev=0.02)
box("desk_apron", (0, 0.7, 0.66), (4.9, 2.3, 0.14), WOOD_DESK, bev=0.015)
box("desk_drawer_band", (0, -0.48, 0.50), (4.9, 0.10, 0.30), WOOD_DESK, bev=0.01)
for i in range(4):
    x = -1.68 + i * 1.12
    box("drawer_%d" % i, (x, -0.53, 0.50), (1.0, 0.06, 0.24), WOOD_FRAME, bev=0.012)
    box("pull_%d" % i, (x, -0.585, 0.56), (0.30, 0.018, 0.020), BRASS, bev=0.004)
    for px in (-0.11, 0.11):
        cyl("pull_post_%d_%d" % (i, px), (x + px, -0.575, 0.545), 0.008, 0.05, BRASS, rot=(math.pi / 2, 0, 0), verts=10)
for sx in (-2.35, 2.35):
    for sy in (-0.35, 1.75):
        # straight leg + horse-hoof foot: a Ming classic, reads instantly as "Chinese desk"
        box("leg_%.1f_%.1f" % (sx, sy), (sx, sy, 0.36), (0.17, 0.17, 0.60), WOOD_DESK, bev=0.010, uv=1)
        box("hoof_%.1f_%.1f" % (sx, sy), (sx, sy + 0.022, 0.062), (0.155, 0.155, 0.055), WOOD_DESK, bev=0.010)
        box("hoof_fl_%.1f_%.1f" % (sx, sy), (sx, sy + 0.088, 0.030), (0.13, 0.045, 0.030), WOOD_DESK, rot=(0.30, 0, 0), bev=0.008)
box("desk_stretcher", (0, 0.7, 0.20), (4.6, 0.14, 0.12), WOOD_DESK, bev=0.01, uv=1)
# apron braces and drawer-band returns, extra joinery read
box("apron_brace_a", (-2.05, -0.44, 0.63), (0.10, 0.16, 0.10), WOOD_DESK, bev=0.006)
box("apron_brace_b", (2.05, -0.44, 0.63), (0.10, 0.16, 0.10), WOOD_DESK, bev=0.006)

# ---- framed map on the desk ----
MAP_CX, MAP_CY = 0.0, 0.72
MAP_W, MAP_D = 3.9, 1.95
box("map_bed", (MAP_CX, MAP_CY, 0.868), (MAP_W + 0.20, MAP_D + 0.20, 0.03), WOOD_FRAME, bev=0.008)

pl = bpy.data.meshes.new("map_plane")
pl.from_pydata([(-MAP_W / 2, -MAP_D / 2, 0), (MAP_W / 2, -MAP_D / 2, 0), (MAP_W / 2, MAP_D / 2, 0), (-MAP_W / 2, MAP_D / 2, 0)], [], [(0, 1, 2, 3)])
pl.update()
map_obj = bpy.data.objects.new("map_paper", pl)
scene.collection.objects.link(map_obj)
map_obj.location = (MAP_CX, MAP_CY, 0.888)
map_obj.data.materials.append(PAPER)

# cartouche: small vertical title slip in the bottom-right corner
box("cartouche_band", (MAP_CX + 1.66, MAP_CY - 0.68, 0.8932), (0.26, 0.56, 0.002), LACQUER, bev=0)
ART_CART = [bpy.data.objects["cartouche_band"]]
if get_font() is not None:
    for k, ch in enumerate("大明舆图"):
        ART_CART.append(relief("cartouche_t%d" % k, ch, (MAP_CX + 1.66, MAP_CY - 0.475 + k * 0.118, 0.8942), 0.068, MAP_GOLD, extrude=0.0014))
    ART_CART.append(relief("cartouche_sub", "崇祯元年", (MAP_CX + 1.66, MAP_CY - 0.875, 0.8942), 0.030, MAP_GOLD, extrude=0.0010))

for nm, lo, sz in (
    ("frame_n", (MAP_CX, MAP_CY + MAP_D / 2 + 0.06, 0.905), (MAP_W + 0.30, 0.13, 0.075)),
    ("frame_s", (MAP_CX, MAP_CY - MAP_D / 2 - 0.06, 0.905), (MAP_W + 0.30, 0.13, 0.075)),
    ("frame_w", (MAP_CX - MAP_W / 2 - 0.06, MAP_CY, 0.905), (0.13, MAP_D + 0.10, 0.075)),
    ("frame_e", (MAP_CX + MAP_W / 2 + 0.06, MAP_CY, 0.905), (0.13, MAP_D + 0.10, 0.075)),
):
    box(nm, lo, sz, WOOD_FRAME, bev=0.012)

# ---- map artwork (hidden for the blank plate) ----
ART = []
ART.extend(ART_CART)
ART.extend(ART_CART)

# coastline: real China provincial polygons, projected onto the paper
try:
    with open(GEO_JSON, "r", encoding="utf-8") as fh:
        _geo = json.load(fh)
except Exception as e:
    print("geojson unreadable", e)
    _geo = None

GEO_OK = False
if _geo and _geo.get("features"):
    polys = []
    for feat in _geo["features"]:
        gm = feat.get("geometry", {}).get("coordinates", [])
        for grp in gm:
            rings = grp if feat.get("geometry", {}).get("type") == "MultiPolygon" else [grp]
            for ring in rings:
                if len(ring) >= 4:
                    polys.append(ring)
    if polys:
        # thin the rings so the sheet stays readable at this scale
        thin = []
        for ring in polys:
            pts, acc = [], 0.0
            last = None
            for lon, lat in ring:
                p = ((lon - GEO_LON0) * GEO_SCALE, (lat - GEO_LAT0) * GEO_SCALE)
                if last is None:
                    pts.append(p)
                    last = p
                    continue
                acc += math.hypot(p[0] - last[0], p[1] - last[1])
                if acc >= 0.011:
                    pts.append(p)
                    last = p
                    acc = 0.0
            if len(pts) >= 3:
                thin.append(pts)
        if thin:
            # 1) sea wash: slightly larger, desaturated silhouette behind the land
            sea_ms, sea_vs, sea_faces, vi = [], [], [], 0
            for pts in thin:
                cxp = sum(p[0] for p in pts) / len(pts)
                cyp = sum(p[1] for p in pts) / len(pts)
                grow = [(cxp + (p[0] - cxp) * 1.055, cyp + (p[1] - cyp) * 1.055) for p in pts]
                sea_vs.extend([(x, y, 0.0) for (x, y) in grow])
                sea_faces.append(list(range(vi, vi + len(grow))))
                vi += len(grow)
            sea = bpy.data.meshes.new("map_sea")
            sea.from_pydata(sea_vs, [], sea_faces)
            sea.update()
            sea_ob = bpy.data.objects.new("map_sea", sea)
            scene.collection.objects.link(sea_ob)
            sea_ob.location = (MAP_CX, MAP_CY, 0.8912)
            sea_ob.data.materials.append(MAP_TEAL)
            ART.append(sea_ob)

            # 2) land: filled polygons
            vs, faces, vi = [], [], 0
            for pts in thin:
                vs.extend([(p[0], p[1], 0.0) for p in pts])
                faces.append(list(range(vi, vi + len(pts))))
                vi += len(pts)
            lm = bpy.data.meshes.new("map_land")
            lm.from_pydata(vs, [], faces)
            lm.update()
            land_ob = bpy.data.objects.new("map_land", lm)
            scene.collection.objects.link(land_ob)
            land_ob.location = (MAP_CX, MAP_CY, 0.8924)
            land_ob.data.materials.append(PAPER)
            ART.append(land_ob)

            # 3) border stroke: stand the rings up as thin vertical ribbons
            vs, faces, vi = [], [], 0
            for pts in thin:
                n = len(pts)
                vs.extend([(p[0], p[1], 0.0) for p in pts])
                vs.extend([(p[0], p[1], 0.0022) for p in pts])
                for k in range(n):
                    a, b = k, (k + 1) % n
                    faces.append([vi + a, vi + b, vi + n + b, vi + n + a])
                vi += 2 * n
            bm = bpy.data.meshes.new("map_border")
            bm.from_pydata(vs, [], faces)
            bm.update()
            b_ob = bpy.data.objects.new("map_border", bm)
            scene.collection.objects.link(b_ob)
            b_ob.location = (MAP_CX, MAP_CY, 0.8925)
            b_ob.data.materials.append(MAP_RED)
            ART.append(b_ob)
            GEO_OK = True

if not GEO_OK:
    print("geojson path unavailable, falling back to abstract regions")
    regions = [
        ((0.10, 0.74), (0.62, 0.40, 0.45), MAP_RED),
        ((-0.42, 0.92), (0.40, 0.24, -0.30), MAP_RED),
    ]
    for i, (pt, sc, mm) in enumerate(regions):
        o = disc("map_region_%d" % i, (MAP_CX + pt[0], MAP_CY + pt[1], 0.8925), (sc[0], sc[1]), mm, rot=(0, 0, sc[2]))
        ART.append(o)

# graticule: faint ruled lines, as on a woodblock-printed map
for g in range(7):
    gy = MAP_CY - 0.75 + g * 0.25
    box("map_grid_%d" % g, (MAP_CX, gy, 0.8920), (MAP_W - 0.22, 0.004, 0.001), MAP_GOLD, bev=0)
    ART.append(bpy.data.objects["map_grid_%d" % g])
for g in range(11):
    gx = MAP_CX - 1.80 + g * 0.36
    box("map_gridx_%d" % g, (gx, MAP_CY, 0.8920), (0.004, MAP_D - 0.22, 0.001), MAP_GOLD, bev=0)
    ART.append(bpy.data.objects["map_gridx_%d" % g])

# place names + a sea label, set in real CJK type
LABELS = [
    ("京师", 116.41, 39.90, 0.088),
    ("山东", 117.00, 36.65, 0.070),
    ("山西", 112.30, 37.60, 0.070),
    ("河南", 113.60, 34.00, 0.070),
    ("陕西", 108.90, 35.30, 0.070),
    ("四川", 104.00, 30.60, 0.070),
    ("湖广", 112.00, 29.50, 0.070),
    ("江南", 119.00, 31.50, 0.070),
    ("浙江", 120.60, 29.20, 0.062),
    ("福建", 118.30, 26.00, 0.062),
    ("广东", 113.60, 23.40, 0.062),
    ("广西", 108.80, 23.60, 0.062),
    ("云南", 101.80, 25.00, 0.062),
    ("贵州", 106.70, 26.80, 0.058),
    ("甘肃", 100.50, 39.00, 0.062),
    ("辽东", 123.00, 41.50, 0.062),
    ("奴儿干", 128.00, 46.50, 0.056),
    ("哈密", 93.50, 42.80, 0.054),
    ("乌思藏", 88.00, 31.00, 0.056),
    ("漠北", 106.00, 46.00, 0.056),
    ("草原", 112.00, 43.50, 0.054),
    ("苗疆", 109.00, 27.50, 0.052),
    ("交趾", 105.80, 21.50, 0.050),
    ("琉球", 127.80, 26.30, 0.046),
    ("朝鲜", 127.00, 38.50, 0.050),
    ("西域", 85.00, 39.50, 0.050),
]
if get_font() is not None:
    for txt, lon, lat, sz in LABELS:
        x = (lon - GEO_LON0) * GEO_SCALE
        y = (lat - GEO_LAT0) * GEO_SCALE
        o = relief("lbl_%s" % txt, txt, (MAP_CX + x, MAP_CY + y, 0.8936), sz, INK, extrude=0.0016)
        ART.append(o)
    ART.append(relief("lbl_sea", "东海", (MAP_CX + 1.62, MAP_CY - 0.30, 0.8936), 0.062, MAP_TEAL, extrude=0.0014))
    ART.append(relief("lbl_sea2", "南海", (MAP_CX + 0.70, MAP_CY - 0.86, 0.8936), 0.056, MAP_TEAL, extrude=0.0014))
    ART.append(relief("lbl_river", "黄河", (MAP_CX + 0.10, MAP_CY + 0.44, 0.8936), 0.048, MAP_TEAL, extrude=0.0012))
    ART.append(relief("lbl_river2", "大江", (MAP_CX + 0.44, MAP_CY - 0.06, 0.8936), 0.048, MAP_TEAL, extrude=0.0012))
else:
    print("no CJK font, skipping map labels")

# ---- desk micro-details ----
# Desktop layout: left = writing tools, centre = clear map work area,
# right = books and document storage. Keep the map perimeter unobstructed.
# Small, readable marks of hand-built joinery and daily use; kept below the
# existing hero silhouettes so the light balance and composition stay intact.
for i in range(4):
    x = -1.68 + i * 1.12
    disc("drawer_escutcheon_%d" % i, (x, -0.598, 0.47), (0.028, 0.028), BRASS, rot=(math.pi / 2, 0, 0))
    cyl("drawer_keyhole_%d" % i, (x, -0.604, 0.438), 0.011, 0.010, BRASS, rot=(math.pi / 2, 0, 0), verts=12)

# brass pins at the four corners of the map's raised wooden bed
for mi, mx in enumerate((-1.96, 1.96)):
    for mj, my in enumerate((MAP_CY - 1.02, MAP_CY + 1.02)):
        disc("map_bed_pin_%d_%d" % (mi, mj), (mx, my, 0.931), (0.032, 0.032), BRASS)

# a shallow celadon brush washer, with a dark water pool and a raised rim
# tucked beside the inkstone (a close-up reward without competing with the map)
disc("brush_washer", (-3.02, 0.62, 0.900), (0.20, 0.15), CELADON)
disc("brush_washer_pool", (-3.02, 0.62, 0.906), (0.145, 0.105), INKSTONE)
bpy.ops.mesh.primitive_torus_add(major_radius=0.155, minor_radius=0.014, major_segments=28, minor_segments=10, location=(-3.02, 0.62, 0.914))
washer_rim = bpy.context.object
washer_rim.name = "brush_washer_rim"
washer_rim.data.materials.append(CELADON)

# tied silk cords on the hanging scroll rack; the knots give the repeated rolls
# a small handmade asymmetry instead of reading as bare cylinders.
for ri, rz in enumerate((0.68, 1.02, 1.36)):
    cyl("rack_scroll_tie_%d" % ri, (3.35, 1.25, rz), 0.058, 0.022, SEAL_CLAY,
        rot=(math.pi / 2, 0, 0), verts=16)
    disc("rack_scroll_tassel_%d" % ri, (3.35, 1.25, rz - 0.045), (0.022, 0.030), SEAL_CLAY)

# stacked book page cuts: three fine lines catch the warm key light and sell the
# page block without changing the book silhouette.
for pi, py in enumerate((1.59, 1.63, 1.67)):
    box("book_page_cut_%d" % pi, (2.35, py, 1.087), (0.48, 0.006, 0.0015), STAIN, rot=(0, 0, 0.02), bev=0)

# stacked volumes: hard covers, cloth wrap, and a cut page block
box("book_a", (2.35, 1.62, 0.925), (0.70, 0.50, 0.055), LACQUER, rot=(0, 0, 0.06), bev=0.006, uv=1)
box("book_a_pages", (2.35, 1.62, 0.957), (0.655, 0.455, 0.035), PAPER, rot=(0, 0, 0.06), bev=0.002)
box("book_b", (2.35, 1.60, 0.993), (0.68, 0.48, 0.052), CLOTH_FB, rot=(0, 0, -0.04), bev=0.006, uv=1)
box("book_b_pages", (2.35, 1.60, 1.022), (0.635, 0.435, 0.032), PAPER, rot=(0, 0, -0.04), bev=0.002)
box("book_c", (2.34, 1.63, 1.056), (0.64, 0.45, 0.048), LACQUER, rot=(0, 0, 0.02), bev=0.006, uv=1)
box("book_c_pages", (2.34, 1.63, 1.083), (0.60, 0.41, 0.030), PAPER, rot=(0, 0, 0.02), bev=0.002)
# title slip pasted on the top volume
box("book_slip", (2.20, 1.79, 1.081), (0.10, 0.26, 0.002), PAPER, rot=(0, 0, 0.02), bev=0)
if get_font() is not None:
    relief("book_title", "万历会计录", (2.195, 1.682, 1.0835), 0.042, INK, rot=(math.pi / 2, 0, math.pi / 2 + 0.02), extrude=0.0012)

box("wood_box", (2.82, 0.28, 1.02), (0.78, 0.62, 0.34), WOOD_FRAME, rot=(0, 0, -0.09), bev=0.014, uv=1)
box("wood_box_lid", (2.82, 0.28, 1.20), (0.82, 0.66, 0.05), WOOD_FRAME, rot=(0, 0, -0.09), bev=0.012, uv=1)
box("wood_box_clasp", (2.47, 0.28, 1.06), (0.06, 0.14, 0.10), BRASS, rot=(0, 0, -0.09), bev=0)
box("wood_box_corner_a", (3.19, 0.03, 1.08), (0.10, 0.10, 0.06), BRASS, rot=(0, 0, -0.09), bev=0)
box("wood_box_corner_b", (2.45, 0.53, 1.08), (0.10, 0.10, 0.06), BRASS, rot=(0, 0, -0.09), bev=0)

# brush rest + brushes laid across it, tips tapered
box("brush_rest", (-2.65, 1.35, 0.93), (0.52, 0.16, 0.09), WOOD_FRAME, bev=0.01, uv=1)
for i in range(4):
    bx = -2.80 + i * 0.10
    by = 1.35 + (i % 2) * 0.03
    rot_z = 0.12 * (i - 1.5)
    cyl("brush_%d" % i, (bx, by, 1.12), 0.020, 0.40, WOOD_LIGHT, rot=(0.10, rot_z, 0), verts=14)
    cyl("brush_ferrule_%d" % i, (bx - math.sin(rot_z) * 0.20, by + math.cos(rot_z) * 0.20 + 0.018, 1.115), 0.021, 0.030, BRASS, rot=(0.10, rot_z, 0), verts=14)
    cyl("brush_tuft_%d" % i, (bx - math.sin(rot_z) * 0.245, by + math.cos(rot_z) * 0.245 + 0.036, 1.112), 0.016, 0.075, BRUSH_HAIR, rot=(0.12, rot_z, 0), verts=12)

# inkstone with a wet pool, plus a resting ink stick
box("inkstone", (-2.35, 0.12, 0.895), (0.60, 0.44, 0.065), INKSTONE, rot=(0, 0, 0.12), bev=0.014, uv=1)
box("ink_pool", (-2.35, 0.12, 0.933), (0.38, 0.26, 0.008), mat_basic("ink_pool", (0.010, 0.012, 0.014), rough=0.14), rot=(0, 0, 0.12), bev=0)
box("ink_stick", (-2.15, -0.07, 0.935), (0.20, 0.055, 0.028), INK, rot=(0, 0, 0.30), bev=0.004)

# seals: carved shou-shan stone and a jade one, with the vermilion pad
cyl("seal_red", (2.18, -0.30, 0.925), 0.075, 0.16, LACQUER, rot=(0.06, 0, 0), verts=24)
box("seal_red_cap", (2.18, -0.30, 1.005), (0.15, 0.13, 0.03), LACQUER, rot=(0.06, 0, 0.20), bev=0.005)
cyl("seal_jade", (2.43, -0.42, 0.910), 0.060, 0.13, JADE, rot=(-0.05, 0.10, 0), verts=24)
cyl("seal_pad", (2.30, -0.02, 0.895), 0.13, 0.05, SEAL_CLAY, verts=24)
cyl("seal_pad_rim", (2.30, -0.02, 0.902), 0.135, 0.02, BRASS, verts=28)

# paperweight and a rolled edict
box("weight_stone", (-0.62, -0.28, 0.905), (0.34, 0.14, 0.06), INKSTONE, rot=(0, 0, -0.05), bev=0.012)
cyl("edict_roll", (-0.98, -0.44, 0.905), 0.045, 0.72, PAPER, rot=(0, -0.22, math.pi / 2), verts=20)
cyl("edict_tie", (-0.98, -0.44, 0.905), 0.048, 0.03, LACQUER, rot=(0, -0.22, math.pi / 2), verts=20)

# ---- right scroll rack: capped top and base, scrolls on each shelf ----
box("rack_upright_a", (3.35, 1.95, 1.00), (0.13, 0.13, 1.30), WOOD_FRAME, bev=0.012, uv=1)
box("rack_upright_b", (3.35, 0.55, 1.00), (0.13, 0.13, 1.30), WOOD_FRAME, bev=0.012, uv=1)
box("rack_cap", (3.35, 1.25, 1.70), (0.74, 1.64, 0.06), WOOD_FRAME, bev=0.014, uv=1)
box("rack_base", (3.35, 1.25, 0.40), (0.74, 1.64, 0.06), WOOD_FRAME, bev=0.014, uv=1)
for i in range(3):
    z = 0.62 + i * 0.34
    box("rack_shelf_%d" % i, (3.35, 1.25, z), (0.58, 1.50, 0.05), WOOD_FRAME, bev=0.01, uv=1)
    # two scrolls per shelf: paper body, wooden end caps, and a tied band
    for k in range(2):
        yy = 0.92 + k * 0.68
        cyl("scroll_%d_%d" % (i, k), (3.35, yy, z + 0.075), 0.052, 1.34, PAPER, rot=(math.pi / 2, 0, 0), verts=18)
        for sy in (-0.685, 0.685):
            cyl("scroll_cap_%d_%d_%d" % (i, k, sy), (3.35, yy + sy, z + 0.075), 0.030, 0.035, WOOD_FRAME, rot=(math.pi / 2, 0, 0), verts=14)
        cyl("scroll_band_%d_%d" % (i, k), (3.35, yy, z + 0.075), 0.056, 0.030, LACQUER, rot=(math.pi / 2, 0, 0), verts=18)

# an unrolled scroll laid open across the middle shelf
box("open_scroll_sheet", (3.35, 1.25, 1.035), (0.52, 1.36, 0.004), PAPER, bev=0)
box("open_scroll_edge_a", (3.35, 0.60, 1.038), (0.52, 0.03, 0.010), CLOTH_FB, bev=0)
box("open_scroll_edge_b", (3.35, 1.90, 1.038), (0.52, 0.03, 0.010), CLOTH_FB, bev=0)
cyl("open_scroll_rod_a", (3.35, 0.58, 1.045), 0.024, 0.60, WOOD_FRAME, rot=(math.pi / 2, 0, 0), verts=14)
cyl("open_scroll_rod_b", (3.35, 1.92, 1.045), 0.024, 0.60, WOOD_FRAME, rot=(math.pi / 2, 0, 0), verts=14)
if get_font() is not None:
    for oi, col in enumerate((0.88, 1.10, 1.32, 1.54, 1.76)):
        for ci, ch in enumerate("山河永驻图"):
            relief("open_scroll_ch_%d_%d" % (oi, ci), ch, (3.35, col, 1.040 + 0.0), 0.055, INK,
                   rot=(math.pi / 2, 0, 0), extrude=0.0010)

# ---- plum vase standing on the floor by the rack ----
cyl("vase_neck", (4.10, 1.05, 1.02), 0.048, 0.10, CELADON, verts=28)
cyl("vase_shoulder", (4.10, 1.05, 0.94), 0.115, 0.07, CELADON, verts=28)
cyl("vase_belly", (4.10, 1.05, 0.80), 0.135, 0.22, CELADON, verts=32)
cyl("vase_foot", (4.10, 1.05, 0.685), 0.085, 0.05, CELADON, verts=28)
# plum branch: angled twigs with small blossom discs
for bi, (bx, by, bz, tilt) in enumerate((
    (4.10, 1.05, 1.30, 0.10), (4.05, 1.09, 1.44, -0.34),
    (4.16, 1.01, 1.52, 0.42), (4.02, 1.13, 1.60, -0.18),
)):
    cyl("plum_twig_%d" % bi, (bx, by, bz), 0.008, 0.20, BAMBOO, rot=(tilt, 0.3 * bi, 0.5 * bi), verts=8)
for pk in range(9):
    pa = pk * 1.31
    disc("plum_blossom_%d" % pk,
         (4.10 + math.cos(pa) * 0.115, 1.05 + math.sin(pa) * 0.10, 1.28 + (pk % 4) * 0.09),
         (0.017, 0.017), LACQUER if pk % 3 else PAPER, rot=(math.pi / 2, 0, pa))

# ---- left armchair: an official's hat armchair (guanmao yi) ----
# crest rail over the back, curved arm rails, and the S-shaped splat
box("chair_seat", (-3.30, 2.55, 0.45), (0.95, 0.90, 0.10), WOOD_FRAME, bev=0.02, uv=1)
box("chair_cushion", (-3.30, 2.55, 0.545), (0.86, 0.82, 0.10), CLOTH_FB, bev=0.02)
box("chair_apron", (-3.30, 2.12, 0.44), (0.90, 0.07, 0.14), WOOD_FRAME, bev=0.008)
box("chair_back_post_a", (-3.70, 2.98, 0.86), (0.09, 0.09, 0.92), WOOD_FRAME, bev=0.010, uv=1)
box("chair_back_post_b", (-2.90, 2.98, 0.86), (0.09, 0.09, 0.92), WOOD_FRAME, bev=0.010, uv=1)
box("chair_crest", (-3.30, 2.98, 1.34), (1.02, 0.11, 0.11), WOOD_FRAME, bev=0.014, uv=1)
box("chair_crest_end_a", (-3.76, 2.98, 1.30), (0.09, 0.11, 0.09), WOOD_FRAME, rot=(0, 0, 0.35), bev=0.010)
box("chair_crest_end_b", (-2.84, 2.98, 1.30), (0.09, 0.11, 0.09), WOOD_FRAME, rot=(0, 0, -0.35), bev=0.010)
box("chair_splat", (-3.30, 3.00, 0.92), (0.30, 0.05, 0.74), WOOD_DARK, bev=0.010, uv=1)
box("chair_splat_curl", (-3.30, 2.92, 0.60), (0.26, 0.06, 0.16), WOOD_DARK, rot=(0.25, 0, 0), bev=0.010)
for ax, inward in ((-3.72, 1), (-2.88, -1)):
    box("chair_post_%.2f" % ax, (ax, 2.62, 0.70), (0.08, 0.08, 0.55), WOOD_FRAME, bev=0.008, uv=1)
    box("chair_arm_%.2f" % ax, (ax, 2.60, 0.96), (0.09, 0.82, 0.09), WOOD_FRAME, bev=0.012, uv=1)
    box("chair_arm_curl_%.2f" % ax, (ax, 2.20, 0.90), (0.09, 0.16, 0.09), WOOD_FRAME, rot=(0, 0, 0.30 * inward), bev=0.010)
    box("chair_gpost_%.2f" % ax, (ax, 2.20, 0.68), (0.07, 0.07, 0.36), WOOD_FRAME, bev=0.008, uv=1)
for sx in (-3.66, -2.94):
    for sy in (2.18, 2.92):
        box("chair_leg_%.2f_%.2f" % (sx, sy), (sx, sy, 0.23), (0.09, 0.09, 0.46), WOOD_FRAME, bev=0.008, uv=1)
box("chair_stretcher_a", (-3.30, 2.18, 0.14), (0.78, 0.07, 0.07), WOOD_FRAME, bev=0.006)
box("chair_stretcher_b", (-3.30, 2.92, 0.14), (0.78, 0.07, 0.07), WOOD_FRAME, bev=0.006)
for sx in (-3.66, -2.94):
    box("chair_side_stretch_%.2f" % sx, (sx, 2.55, 0.16), (0.07, 0.78, 0.06), WOOD_FRAME, bev=0.006)

# ---- side table with a censer ----
box("side_table", (-4.85, 2.30, 0.62), (0.80, 0.80, 0.07), WOOD_FRAME, bev=0.014, uv=1)
box("side_table_apron", (-4.85, 2.30, 0.56), (0.74, 0.74, 0.10), WOOD_FRAME, bev=0.010)
box("side_table_leg", (-4.85, 2.30, 0.30), (0.16, 0.16, 0.60), WOOD_DARK, bev=0.008, uv=1)
box("side_table_foot", (-4.85, 2.30, 0.035), (0.30, 0.30, 0.07), WOOD_DARK, bev=0.010)
# three-legged bronze censer on the table
cyl("censer_body", (-4.85, 2.30, 0.76), 0.115, 0.20, BRASS, verts=28)
cyl("censer_rim", (-4.85, 2.30, 0.862), 0.125, 0.022, BRASS, verts=28)
for k in range(3):
    a = k * 2.0944
    cyl("censer_leg_%d" % k, (-4.85 + math.cos(a) * 0.075, 2.30 + math.sin(a) * 0.075, 0.665), 0.016, 0.10, BRASS, verts=10)
cyl("censer_lid", (-4.85, 2.30, 0.885), 0.105, 0.045, BRASS, verts=28)
cyl("censer_knob", (-4.85, 2.30, 0.925), 0.022, 0.04, BRASS, verts=14)
# a thin trail of incense smoke, kept faint
cyl("smoke_0", (-4.85, 2.30, 1.02), 0.020, 0.14, CLOTH, verts=10)
cyl("smoke_1", (-4.87, 2.31, 1.14), 0.032, 0.14, CLOTH, verts=10)
cyl("smoke_2", (-4.83, 2.29, 1.26), 0.046, 0.14, CLOTH, verts=10)

# ---- detail props (v2) ----
bpy.ops.mesh.primitive_torus_add(major_radius=0.085, minor_radius=0.016, location=(0.62, -0.42, 0.922), rotation=(math.pi / 2, 0, 0))
bowl_rim = bpy.context.object
bowl_rim.name = "tea_bowl_rim"
bowl_rim.data.materials.append(CELADON)
cyl("tea_bowl", (0.62, -0.42, 0.888), 0.080, 0.055, CELADON, verts=32)
disc("tea_saucer", (0.62, -0.42, 0.871), (0.115, 0.115), WOOD_FRAME)
box("ink_stick_2", (-2.16, 0.24, 0.949), (0.15, 0.045, 0.016), INK, rot=(0, 0, 0.5), bev=0.004)
# water dropper beside the inkstone, and a carved inscription on the inkstick
cyl("dropper_body", (-1.98, -0.16, 0.905), 0.032, 0.07, CELADON, verts=20)
cyl("dropper_spout", (-1.93, -0.16, 0.918), 0.010, 0.06, CELADON, rot=(0, 0, math.pi / 2 - 0.5), verts=10)
if get_font() is not None:
    relief("inkstick_char", "墨", (-2.16, 0.24, 0.958), 0.030, INK, rot=(0, 0, 0.5), extrude=0.0008)
box("brass_tray", (1.42, -0.18, 0.870), (0.62, 0.50, 0.012), BRASS, bev=0.006)
# carved characters on the seal's top face, and a fresh vermilion impression on the pad
if get_font() is not None:
    relief("seal_char_a", "永", (1.30, -0.30, 1.021), 0.048, INK, rot=(0, 0, 0), extrude=0.0012)
    relief("seal_char_b", "驻", (1.30, -0.315, 1.021), 0.048, INK, rot=(0, 0, 0), extrude=0.0012)
    relief("seal_print", "永", (1.42, -0.02, 0.923), 0.050, SEAL_CLAY, rot=(0, 0, 0.30), extrude=0.0010)
for i in range(5):
    box("slip_%d" % i, (-1.15 + i * 0.012, -0.52 + i * 0.014, 0.870 + i * 0.004), (0.34 - i * 0.012, 0.22 - i * 0.010, 0.004), PAPER, rot=(0, 0, 0.04 * i - 0.05), bev=0)
box("lamp_base", (2.42, -0.72, 0.876), (0.16, 0.16, 0.022), BRASS, bev=0.006)
cyl("lamp_stem", (2.42, -0.72, 0.97), 0.014, 0.14, BRASS, verts=14)
cyl("lamp_cup", (2.42, -0.72, 1.055), 0.055, 0.045, BRASS, verts=20)
GLOW = bpy.data.materials.new("lamp_glow")
GLOW.use_nodes = True
GLOW.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1.0, 0.62, 0.30, 1.0)
GLOW.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 26.0
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.026, location=(2.42, -0.72, 1.082))
flame = bpy.context.object
flame.name = "lamp_flame"
flame.data.materials.append(GLOW)
# paper shade around the flame: a translucent drum that glows warm
cyl("lamp_shade", (2.42, -0.72, 1.075), 0.062, 0.10, PAPER, verts=24)
sh = bpy.data.objects["lamp_shade"].data.materials[0]
try:
    sh.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1.0, 0.66, 0.34, 1.0)
    sh.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.6
except Exception as _e:
    print("shade emission skipped", _e)
box("lamp_shade_rib_a", (2.42, -0.72, 1.075), (0.128, 0.006, 0.10), WOOD_FRAME, bev=0)
box("lamp_shade_rib_b", (2.42, -0.72, 1.075), (0.006, 0.128, 0.10), WOOD_FRAME, bev=0)
# a second, shorter candle on the tray
cyl("candle2_body", (2.08, -0.30, 0.905), 0.026, 0.16, PAPER, verts=16)
cyl("candle2_flame", (2.08, -0.30, 1.005), 0.012, 0.03, GLOW, verts=10)
pl2 = bpy.data.lights.new("candle2_pt", type="POINT")
pl2.energy = 6.0
pl2.color = (1.0, 0.60, 0.32)
pl2.shadow_soft_size = 0.05
o2 = bpy.data.objects.new("candle2_pt", pl2)
scene.collection.objects.link(o2)
o2.location = (2.08, -0.30, 1.02)
# hanging lanterns on the back wall for depth
for li, lx in enumerate((-2.20, 2.60)):
    cyl("lantern_cord_%d" % li, (lx, 4.30, 3.05), 0.004, 0.60, CLOTH, verts=8)
    cyl("lantern_body_%d" % li, (lx, 4.30, 2.66), 0.105, 0.20, PAPER, verts=20)
    cyl("lantern_cap_%d" % li, (lx, 4.30, 2.77), 0.055, 0.04, WOOD_FRAME, verts=16)
    cyl("lantern_base_%d" % li, (lx, 4.30, 2.55), 0.055, 0.04, WOOD_FRAME, verts=16)
    cyl("lantern_flame_%d" % li, (lx, 4.30, 2.64), 0.020, 0.04, GLOW, verts=10)
    lt = bpy.data.lights.new("lantern_pt_%d" % li, type="POINT")
    lt.energy = 9.0
    lt.color = (1.0, 0.66, 0.36)
    lt.shadow_soft_size = 0.10
    lo = bpy.data.objects.new("lantern_pt_%d" % li, lt)
    scene.collection.objects.link(lo)
    lo.location = (lx, 4.30, 2.64)

pl = bpy.data.lights.new("lamp_pt", type="POINT")
pl.energy = 20.0
pl.color = (1.0, 0.60, 0.32)
pl.shadow_soft_size = 0.06
plo = bpy.data.objects.new("lamp_pt", pl)
scene.collection.objects.link(plo)
plo.location = (2.42, -0.72, 1.12)

# ---- hanging scroll on the back wall ----
box("hscroll_rod_top", (-6.30, 4.36, 2.62), (0.06, 1.30, 0.06), WOOD_FRAME, rot=(0, math.pi / 2, 0), bev=0.006)
box("hscroll_rod_bot", (-6.30, 4.36, 1.34), (0.05, 1.30, 0.05), WOOD_FRAME, rot=(0, math.pi / 2, 0), bev=0.006)
box("hscroll_silk", (-6.26, 4.36, 1.98), (0.012, 1.22, 1.24), PAPER, rot=(0, math.pi / 2, 0), bev=0)
box("hscroll_mount_top", (-6.24, 4.36, 2.50), (0.008, 1.26, 0.14), CLOTH_FB, rot=(0, math.pi / 2, 0), bev=0)
box("hscroll_mount_bot", (-6.24, 4.36, 1.46), (0.008, 1.26, 0.14), CLOTH_FB, rot=(0, math.pi / 2, 0), bev=0)
if get_font() is not None:
    for ri, ch in enumerate(("山", "河", "永", "驻")):
        relief("hscroll_char_%d" % ri, ch, (-6.20, 4.36, 2.28 - ri * 0.26), 0.19, INK,
               rot=(math.pi / 2, 0, math.pi / 2), extrude=0.0016)

# ---- lighting ----
def area(name, loc, target, energy, size, color, shape="RECTANGLE"):
    ld = bpy.data.lights.new(name, type="AREA")
    ld.energy = energy
    ld.size = size
    ld.color = color
    ld.shape = shape
    o = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(o)
    o.location = loc
    look_at(o, target)
    return o


# Lighting brief (measured against the previous render, not guessed):
#   old: median 0.136, p95 0.880, 16.4% of pixels crushed below 0.02,
#        left/centre/right = 0.264 / 0.387 / 0.145 -> the right third was unlit
#   fix: lift the floor with a low bounce card, give the right side its own
#        light, drop the key so highlights stop clipping, and let the practicals
#        (lamp, candles, lanterns) do the warm accents.
area("key_light", (-4.2, -2.0, 4.0), (0.3, 0.9, 1.00), 300.0, 3.0, (1.0, 0.80, 0.58))
area("fill_light", (5.0, 1.4, 2.4), (1.4, 1.0, 1.00), 180.0, 3.0, (1.0, 0.84, 0.64))
area("back_light", (0.4, 3.9, 3.6), (0.0, 1.2, 1.2), 150.0, 3.4, (1.0, 0.72, 0.48))
area("desk_glow", (0.0, 0.8, 2.1), (0.0, 0.8, 0.90), 55.0, 2.4, (1.0, 0.78, 0.54))
area("screen_wash", (0.2, 2.6, 3.3), (0.2, 4.3, 2.4), 110.0, 2.6, (1.0, 0.80, 0.58))
area("rim_left", (-6.6, -1.0, 2.4), (-1.0, 0.6, 0.9), 80.0, 2.2, (0.76, 0.84, 1.0))
# bounce card low on the floor: lifts the crushed 16% out of pure black
area("floor_bounce", (0.2, -1.6, 0.25), (0.2, 1.4, 0.95), 90.0, 4.0, (1.0, 0.86, 0.70))
# dedicated light for the right third (scroll rack / plum vase) that used to sit at 0.145
area("right_wash", (6.2, 0.4, 2.6), (3.2, 1.1, 1.05), 130.0, 3.0, (1.0, 0.83, 0.62))
# cool moonlight through the papered window, for a cold/warm split
area("window_moon", (-9.5, 1.6, 2.6), (-2.0, 1.2, 1.0), 70.0, 3.2, (0.68, 0.78, 1.0))

world = bpy.data.worlds.new("W")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.032, 0.026, 0.024, 1.0)
bg.inputs["Strength"].default_value = 0.34

# ---- camera ----
cd = bpy.data.cameras.new("cam")
cd.lens = 40.0
cam = bpy.data.objects.new("cam", cd)
scene.collection.objects.link(cam)
cam.location = (-0.60, -6.85, 3.55)
look_at(cam, (0.18, 1.72, 1.16))
scene.camera = cam

# ---- render setup ----
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
try:
    scene.eevee.taa_render_samples = 64
    scene.eevee.use_raytracing = True
except Exception as e:
    print("eevee opts skipped", e)
try:
    scene.view_settings.view_transform = "AgX"
except Exception as e:
    print("view transform skipped", e)
try:
    scene.view_settings.look = "AgX - High Contrast"
except Exception as e:
    print("look skipped", e)
# One-stop reduction keeps the parchment readable without clipping the paper props.
scene.view_settings.exposure = -0.65
# Keep the render path direct. Blender 5.2's compositor API changed and a
# partially-created node group can replace a valid render with a black frame;
# the area lights below provide the needed lift and falloff without post-bloom.
scene.compositing_node_group = None
print("compositor disabled: direct lit render")

# ---- save + render ----
blend_path = os.path.join(OUT, "shanhe-start-room.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)

hero = os.path.join(OUT, "start-room.png")
scene.render.filepath = hero
bpy.ops.render.render(write_still=True)

for o in ART:
    o.hide_render = True
plate = os.path.join(OUT, "start-room-plate.png")
scene.render.filepath = plate
bpy.ops.render.render(write_still=True)

print("HEADLESS " + json.dumps({
    "blend": blend_path,
    "hero": hero,
    "plate": plate,
    "heroBytes": os.path.getsize(hero) if os.path.exists(hero) else 0,
    "plateBytes": os.path.getsize(plate) if os.path.exists(plate) else 0,
    "objects": len(bpy.data.objects),
}))