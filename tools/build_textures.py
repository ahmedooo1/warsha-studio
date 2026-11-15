#!/usr/bin/env python3
"""Build the PBR texture sets used by the 3D scene.

Usage: python3 tools/build_textures.py <raw_dir> <out_dir>

<raw_dir> holds the original CC0 downloads, one folder per source asset
(Poly Haven names in snake_case, ambientCG names like Marble012).
The originals are not kept in the repository; assets/tex/SOURCES.md says
where each one comes from and what was changed.

Every set gets, per size: albedo_<s>.jpg (sRGB), normal_<s>.jpg (OpenGL
convention, as three.js expects), rough_<s>.jpg (grey, roughness).
Sizes: 512 for the Performance level, 1k for Standard, 2k for Ultra and
photo renders when the source is large enough.
"""
import json, os, sys
import numpy as np
from PIL import Image

RAW, OUT = sys.argv[1], sys.argv[2]
SIZES = {512: '512', 1024: '1k', 2048: '2k'}


def load(path, mode='RGB'):
    im = Image.open(path)
    if im.mode in ('I;16', 'I;16B', 'I'):
        im = im.point(lambda v: v / 256).convert('L')
    return np.asarray(im.convert(mode), dtype=np.float32) / 255.0


def save(arr, path, q):
    arr = np.clip(arr * 255 + .5, 0, 255).astype(np.uint8)
    Image.fromarray(arr).save(path, quality=q, optimize=True, progressive=True)


def resize(arr, s):
    if arr.shape[0] == s:
        return arr
    mode = 'L' if arr.ndim == 2 else 'RGB'
    im = Image.fromarray(np.clip(arr * 255 + .5, 0, 255).astype(np.uint8), mode)
    return np.asarray(im.resize((s, s), Image.LANCZOS), dtype=np.float32) / 255.0


def lum(c):
    return c[..., 0] * .2126 + c[..., 1] * .7152 + c[..., 2] * .0722


def grade(c, sat=1.0, tint=(1, 1, 1), bright=1.0, gamma=1.0, contrast=1.0):
    L = lum(c)[..., None]
    c = L + (c - L) * sat
    if contrast != 1.0:
        m = L.mean()
        c = m + (c - m) * contrast
    c = np.clip(c, 0, 1) ** gamma
    return np.clip(c * np.array(tint, np.float32) * bright, 0, 1)


def neutral(c, mean=.92, contrast=.6):
    """Grey detail around a light mean, so a colour chosen in the app can tint it."""
    L = lum(c)
    L = mean + (L - L.mean()) * contrast
    return np.repeat(np.clip(L, 0, 1)[..., None], 3, 2)


def rot90(a):
    return np.ascontiguousarray(np.rot90(a, 1))


def rot90_normal(n):
    # rotating the picture by 90 deg also turns the tangent-space vectors: (x, y) -> (-y, x)
    r = rot90(n).copy()
    x, y = r[..., 0] * 2 - 1, r[..., 1] * 2 - 1
    r[..., 0], r[..., 1] = (-y + 1) / 2, (x + 1) / 2
    return r


def normal_from_height(h, strength):
    gy, gx = np.gradient(h)
    n = np.stack([-gx * strength, gy * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * .5 + .5


def blend_normals(a, b):
    # whiteout blend of two OpenGL normal maps
    a, b = a * 2 - 1, b * 2 - 1
    n = np.stack([a[..., 0] + b[..., 0], a[..., 1] + b[..., 1], a[..., 2] * b[..., 2]], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * .5 + .5


def periodic_noise(size, freq, seed, octaves=4):
    rng = np.random.default_rng(seed)
    out = np.zeros((size, size), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        f = freq * 2 ** o
        g = rng.random((f, f)).astype(np.float32)
        # wrap-around resize: tile 3x3 and crop centre, so the noise repeats without seams
        big = np.tile(g, (3, 3))
        im = Image.fromarray((big * 255).astype(np.uint8)).resize((size * 3, size * 3), Image.BICUBIC)
        out += amp * np.asarray(im, np.float32)[size:2 * size, size:2 * size] / 255.0
        tot += amp
        amp *= .5
    return out / tot


def src(name, f):
    return os.path.join(RAW, name, f)


def first(name, *cands):
    for c in cands:
        p = src(name, c)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(name + str(cands))


def rough_of(name):
    p = [f for f in os.listdir(os.path.join(RAW, name)) if f.lower().startswith(('rough', 'arm'))]
    p = sorted(p, key=lambda f: 0 if f.lower().startswith('rough') else 1)[0]
    a = load(src(name, p))
    return a[..., 1] if p.lower().startswith('arm') else lum(a)


def std_set(name):
    d = load(first(name, 'diff.jpg', 'diff.png', 'Color.jpg'))
    n = load(first(name, 'nor_nor_gl.jpg', 'nor_nor_gl.png', 'NormalGL.jpg'))
    if os.path.exists(src(name, 'Roughness.jpg')):
        r = load(src(name, 'Roughness.jpg'), 'L')
    else:
        r = rough_of(name)
    return d, n, r


SETS = {}


def out(id, albedo, normal, rough, maxsize, note):
    os.makedirs(os.path.join(OUT, id), exist_ok=True)
    sizes = []
    for s, tag in SIZES.items():
        if s > maxsize:
            continue
        if albedo is not None:
            save(resize(albedo, s), os.path.join(OUT, id, f'albedo_{tag}.jpg'), 86)
        save(resize(normal, s), os.path.join(OUT, id, f'normal_{tag}.jpg'), 90)
        save(resize(rough, s), os.path.join(OUT, id, f'rough_{tag}.jpg'), 84)
        sizes.append(tag)
    SETS[id] = {'sizes': sizes, 'albedo': albedo is not None, 'note': note}
    print(id, sizes, flush=True)


def native(a):
    return a.shape[0]


# ---------- woods (grain runs up the picture: along the height of a door) ----------
d, n, r = std_set('oak_veneer_01')
out('oak', d, n, r, 1024, 'oak_veneer_01')
out('oaklight', grade(d, sat=.62, tint=(1.0, .985, .95), bright=1.2, gamma=.86), n, r, 1024, 'oak_veneer_01, lighter and less saturated (bleached oak)')
out('oaktop', rot90(d), rot90_normal(n), rot90(r), 1024, 'oak_veneer_01 turned 90 deg: grain along the length of a worktop')

d, n, r = std_set('dark_wood')
d, n, r = rot90(d), rot90_normal(n), rot90(r)
out('walnut', grade(d, sat=.42, tint=(1.0, .86, .72), bright=1.42, gamma=.88), n, r, 2048, 'dark_wood turned 90 deg, toned to a walnut brown')

d, n, r = std_set('wood_table_001')
out('wenge', grade(d, sat=.8, bright=1.08), n, r, 2048, 'wood_table_001 (dark wood)')

# ---------- floors ----------
d, n, r = std_set('laminate_floor_02')
out('floor_oak', d, n, r, 2048, 'laminate_floor_02')
d, n, r = std_set('herringbone_parquet')
out('floor_herring', d, n, r, 2048, 'herringbone_parquet')

cd, cn, cr = std_set('concrete_floor_02')
cement = grade(cd, sat=.18, bright=1.12, contrast=.85)
out('cement', cement, cn, np.clip(cr * .9 + .05, 0, 1), 1024, 'concrete_floor_02, desaturated')

# large-format porcelain tiles 60 x 60 drawn from the concrete: 2 x 2 tiles per picture, 3 mm joints
S = 1024
base = resize(grade(cd, sat=.06, bright=1.62, contrast=.32, gamma=.85), S)
bn, br = resize(cn, S), resize(cr, S)
alb, nor, rou = np.zeros((S, S, 3), np.float32), np.zeros((S, S, 3), np.float32), np.zeros((S, S), np.float32)
h = S // 2
shifts = [(0, 0), (311, 97), (173, 401), (457, 229)]
tones = [1.0, .965, .985, .95]
for k, (sy, sx) in enumerate(shifts):
    y0, x0 = (k // 2) * h, (k % 2) * h
    alb[y0:y0 + h, x0:x0 + h] = np.roll(base, (sy, sx), (0, 1))[:h, :h] * tones[k]
    nor[y0:y0 + h, x0:x0 + h] = np.roll(bn, (sy, sx), (0, 1))[:h, :h]
    rou[y0:y0 + h, x0:x0 + h] = np.roll(br, (sy, sx), (0, 1))[:h, :h]
yy, xx = np.mgrid[0:S, 0:S]
dist = np.minimum(np.minimum(yy % h, h - yy % h), np.minimum(xx % h, h - xx % h)).astype(np.float32)
joint = np.clip(1.6 - dist, 0, 1)                    # about 3 px = 3.5 mm
bevel = np.clip(dist / 6.0, 0, 1)
alb = alb * (1 - joint[..., None]) + np.array([.42, .42, .41]) * joint[..., None]
nor = blend_normals(nor, normal_from_height(bevel, 2.2))
rou = np.clip(rou * .25 + .16, 0, 1) * (1 - joint) + .9 * joint
out('floor_tile', alb, nor, rou, 1024, 'concrete_floor_02 laid out as 60 x 60 cm tiles with joints (derived)')

d, n, r = std_set('Terrazzo001')
out('terrazzo', d, n, r, 2048, 'ambientCG Terrazzo001')

# ---------- stone ----------
d, n, r = std_set('Marble012')
out('carrara', grade(d, sat=.12, bright=1.1, contrast=1.15), n, np.clip(r * .5 + .05, 0, 1), 1024, 'ambientCG Marble012, neutral white-grey')
d, n, r = std_set('Marble021')
out('quartz', grade(d, sat=.25, tint=(.78, .79, .79), contrast=1.05), n, np.clip(r * .5 + .12, 0, 1), 2048, 'ambientCG Marble021, toned grey (quartz with fine veins)')
out('calacatta', grade(d, sat=.8, bright=1.0, contrast=1.25), n, np.clip(r * .45 + .04, 0, 1), 2048, 'ambientCG Marble021 (white marble)')
d, n, r = std_set('Marble006')
out('nero', d, n, np.clip(r * .5 + .04, 0, 1), 2048, 'ambientCG Marble006 (black marble)')
d, n, r = std_set('marble_01')
out('travertine', d, n, r, 2048, 'marble_01 (travertine-like stone)')

# ---------- walls, fabric, metal ----------
d, n, r = std_set('painted_plaster_wall')
out('plaster', neutral(d, .93, .55), n, r, 1024, 'painted_plaster_wall, made grey so the wall colour can tint it')
d, n, r = std_set('Fabric030')
out('fabric', neutral(d, .82, 1.1), n, r, 1024, 'ambientCG Fabric030, made grey for tinting')
d, n, r = std_set('Metal032')
out('brushed', neutral(d, .9, .5), n, r, 1024, 'ambientCG Metal032 (brushed metal), made grey for tinting')

# ---------- melamine: fine orange-peel relief, generated here (no source) ----------
hgt = periodic_noise(512, 32, 7, 4) * .7 + periodic_noise(512, 128, 9, 2) * .3
out('melamine', None, normal_from_height(hgt, 3.0), .5 + (periodic_noise(512, 16, 3, 3) - .5) * .25, 512, 'generated by this script')

json.dump(SETS, open(os.path.join(OUT, 'sets.json'), 'w'), indent=1)
