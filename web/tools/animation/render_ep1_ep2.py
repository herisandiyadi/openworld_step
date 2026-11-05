#!/usr/bin/env python3
"""Render Episode 1 & 2 of "Tim Kendaraan Konstruksi" to MP4.

Route: Pillow draws every frame -> ffmpeg encodes H.264 + AAC.
Pacing rules (Notion §3) are enforced by the timeline builder:
  - max 5 words per dialogue line
  - JD 2.0 s of silence after every line (3.0 s for chant lines)
No camera shake, no fast cuts: the only motion is slow vehicle drift + blink.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
AUDIO = ROOT / "audio"
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)
FRAMES = ROOT / ".frames"

W, H = 1280, 720
FPS = 30
SKY_TOP, SKY_BOT = (135, 206, 250), (206, 236, 250)
GROUND = (222, 184, 135)
GROUND_DARK = (198, 158, 110)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

JD = 2.0
JD_LONG = 3.0
DRIFT = 6.0  # px of horizontal drift over a beat -- deliberately tiny


# ---------------------------------------------------------------- characters
@dataclass
class Char:
    key: str
    name: str
    kind: str
    body: tuple[int, int, int]
    accent: tuple[int, int, int]
    trait: str


def rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


CHARS: dict[str, Char] = {
    "buldo": Char("buldo", "Buldo", "bulldozer", rgb("#F5C518"), rgb("#B8860B"), "I am strong!"),
    "eksa": Char("eksa", "Eksa", "excavator", rgb("#F07818"), rgb("#B45309"), "I dig!"),
    "truk": Char("truk", "Truk", "dumptruck", rgb("#2E86DE"), rgb("#1B5390"), "I carry sand!"),
    "kreni": Char("kreni", "Kreni", "crane", rgb("#E74C3C"), rgb("#A93226"), "I am tall!"),
    "molen": Char("molen", "Molen", "mixer", rgb("#ECF0F1"), rgb("#95A5A6"), "Round and round!"),
    "giling": Char("giling", "Giling", "roller", rgb("#27AE60"), rgb("#1E8449"), "I make it flat!"),
}

ORDER = ["buldo", "eksa", "truk", "kreni", "molen", "giling"]


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


# ---------------------------------------------------------------- background
def draw_bg(d: ImageDraw.ImageDraw, dirt_holes: int = 0, flat_road: bool = False) -> None:
    for y in range(0, H // 2):
        t = y / (H / 2)
        c = tuple(int(SKY_TOP[i] + (SKY_BOT[i] - SKY_TOP[i]) * t) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    # sun
    d.ellipse([W - 190, 55, W - 110, 135], fill=(255, 232, 140))
    # hills
    d.ellipse([-160, H // 2 - 130, 380, H // 2 + 90], fill=(150, 200, 150))
    d.ellipse([260, H // 2 - 90, 820, H // 2 + 100], fill=(166, 214, 160))
    d.ellipse([700, H // 2 - 120, 1300, H // 2 + 95], fill=(140, 192, 142))
    d.rectangle([0, H // 2, W, H], fill=GROUND)
    for i in range(0, W, 64):
        d.line([(i, H // 2), (i + 24, H)], fill=GROUND_DARK, width=2)
    if flat_road:
        d.rectangle([0, H - 150, W, H - 40], fill=(158, 158, 158))
        d.rectangle([0, H - 98, W, H - 92], fill=(250, 250, 250))
    for i in range(dirt_holes):
        x = 200 + i * 300
        d.ellipse([x, H - 190, x + 120, H - 120], fill=(176, 138, 96))
        d.ellipse([x + 20, H - 178, x + 100, H - 132], fill=(158, 122, 84))
    for i in range(3):
        cx, cy = 120 + i * 480, 300
        d.rectangle([cx, cy, cx + 10, cy + 70], fill=(120, 90, 60))
        d.ellipse([cx - 42, cy - 60, cx + 52, cy + 12], fill=(120, 190, 120))


# ---------------------------------------------------------------- vehicles
def _shadow(d: ImageDraw.ImageDraw, x: int, y: int, w: int) -> None:
    """Ground contact shadow so vehicles read as sitting on the dirt, not floating."""
    d.ellipse([x - 6, y - 8, x + w + 6, y + 8], fill=(150, 118, 80))


def _wheel(d: ImageDraw.ImageDraw, x: int, y: int, r: int) -> None:
    d.ellipse([x - r, y - r, x + r, y + r], fill=(48, 48, 52))
    d.ellipse([x - r // 2, y - r // 2, x + r // 2, y + r // 2], fill=(150, 150, 158))


def _eyes(d: ImageDraw.ImageDraw, cx: int, cy: int, blink: bool, look: int = 0) -> None:
    if blink:
        d.line([(cx - 20, cy), (cx - 6, cy)], fill=(25, 25, 30), width=4)
        d.line([(cx + 6, cy), (cx + 20, cy)], fill=(25, 25, 30), width=4)
        return
    for dx in (-13 + look, 13 + look):
        d.ellipse([cx + dx - 9, cy - 10, cx + dx + 9, cy + 10], fill=(255, 255, 255))
        d.ellipse([cx + dx - 4, cy - 5, cx + dx + 4, cy + 5], fill=(25, 25, 30))
        d.ellipse([cx + dx - 1, cy - 6, cx + dx + 3, cy - 2], fill=(255, 255, 255))


def _smile(d: ImageDraw.ImageDraw, cx: int, cy: int, happy: bool) -> None:
    if happy:
        d.arc([cx - 22, cy - 6, cx + 22, cy + 24], start=10, end=170, fill=(25, 25, 30), width=4)
    else:
        d.line([(cx - 14, cy + 8), (cx + 14, cy + 8)], fill=(25, 25, 30), width=4)


def _rainbow(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int) -> None:
    for i in range(6):
        d.rectangle(
            [x, y + i * (h // 6), x + w, y + (i + 1) * (h // 6)],
            fill=[(231, 76, 60), (243, 156, 18), (241, 196, 15), (39, 174, 96), (52, 152, 219), (155, 89, 182)][i],
        )


def draw_vehicle(
    d: ImageDraw.ImageDraw,
    ch: Char,
    x: int,
    y: int,
    t: float,
    blink: bool,
    happy: bool = False,
    spin: float = 0.0,
) -> None:
    """Draw one construction vehicle. (x, y) is the bottom-left of its footprint."""
    body, acc = ch.body, ch.accent
    bump = math.sin(t * 1.6) * 1.5  # very slow engine idle, no bounce
    y = int(y + bump)
    _shadow(d, x + 10, y + 4, 200)

    if ch.kind == "bulldozer":
        d.rectangle([x + 20, y - 78, x + 150, y - 30], fill=body)
        d.rectangle([x + 20, y - 96, x + 120, y - 74], fill=acc)
        d.rectangle([x + 40, y - 92, x + 100, y - 76], fill=(190, 230, 250))
        d.rectangle([x - 6, y - 66, x + 26, y - 22], fill=acc)  # blade
        d.rectangle([x + 4, y - 30, x + 12, y - 8], fill=acc)
        _eyes(d, x + 76, y - 62, blink)
        _smile(d, x + 76, y - 46, happy)
        _wheel(d, x + 52, y - 14, 16)
        _wheel(d, x + 122, y - 14, 16)

    elif ch.kind == "excavator":
        d.rectangle([x + 30, y - 84, x + 158, y - 26], fill=body)
        d.rectangle([x + 46, y - 104, x + 140, y - 80], fill=acc)
        d.rectangle([x + 62, y - 100, x + 124, y - 84], fill=(190, 230, 250))
        d.line([(x + 150, y - 92), (x + 210, y - 132)], fill=acc, width=14)
        d.line([(x + 210, y - 132), (x + 232, y - 84)], fill=acc, width=12)
        d.polygon(
            [(x + 216, y - 86), (x + 254, y - 86), (x + 246, y - 52), (x + 224, y - 52)],
            fill=(120, 120, 126),
        )
        _eyes(d, x + 92, y - 66, blink)
        _smile(d, x + 92, y - 50, happy)
        d.rectangle([x + 34, y - 30, x + 182, y - 12], fill=(70, 70, 76))
        for wx in (x + 56, x + 110, x + 162):
            _wheel(d, wx, y - 12, 14)

    elif ch.kind == "dumptruck":
        d.rectangle([x + 16, y - 74, x + 108, y - 30], fill=body)
        d.rectangle([x + 26, y - 92, x + 96, y - 72], fill=acc)
        d.rectangle([x + 40, y - 88, x + 88, y - 74], fill=(190, 230, 250))
        d.polygon(
            [(x + 116, y - 34), (x + 240, y - 34), (x + 232, y - 86), (x + 124, y - 86)],
            fill=acc,
        )
        d.ellipse([x + 136, y - 88, x + 226, y - 74], fill=(214, 180, 130))
        _eyes(d, x + 62, y - 58, blink)
        _smile(d, x + 62, y - 42, happy)
        _wheel(d, x + 50, y - 14, 17)
        _wheel(d, x + 118, y - 14, 17)
        _wheel(d, x + 186, y - 14, 17)

    elif ch.kind == "crane":
        d.rectangle([x + 26, y - 66, x + 154, y - 22], fill=body)
        d.rectangle([x + 40, y - 86, x + 122, y - 64], fill=acc)
        d.rectangle([x + 56, y - 82, x + 108, y - 68], fill=(190, 230, 250))
        d.line([(x + 150, y - 60), (x + 150, y - 250)], fill=acc, width=16)
        d.line([(x + 150, y - 244), (x + 268, y - 244)], fill=acc, width=14)
        hook_y = int(y - 244 + 60 + 12 * math.sin(t * 1.1))
        d.line([(x + 258, y - 240), (x + 258, hook_y)], fill=(70, 70, 76), width=3)
        d.rectangle([x + 246, hook_y, x + 272, hook_y + 26], fill=acc)
        _eyes(d, x + 74, y - 50, blink)
        _smile(d, x + 74, y - 34, happy)
        _wheel(d, x + 56, y - 10, 16)
        _wheel(d, x + 126, y - 10, 16)

    elif ch.kind == "mixer":
        d.rectangle([x + 20, y - 70, x + 112, y - 26], fill=body)
        d.rectangle([x + 32, y - 88, x + 102, y - 68], fill=acc)
        d.rectangle([x + 44, y - 84, x + 94, y - 70], fill=(190, 230, 250))
        d.ellipse([x + 118, y - 108, x + 244, y - 18], fill=body)
        d.ellipse([x + 128, y - 100, x + 234, y - 26], fill=(232, 234, 236))
        for i in range(3):  # rotating drum stripes
            a = spin + i * 2.09
            sx = int(x + 181 + 44 * math.cos(a))
            sy = int(y - 63 + 30 * math.sin(a))
            d.ellipse([sx - 9, sy - 9, sx + 9, sy + 9], fill=acc)
        _eyes(d, x + 66, y - 56, blink)
        _smile(d, x + 66, y - 40, happy)
        _wheel(d, x + 56, y - 12, 16)
        _wheel(d, x + 176, y - 12, 16)
        _wheel(d, x + 216, y - 12, 16)

    else:  # roller
        d.rectangle([x + 40, y - 74, x + 150, y - 26], fill=body)
        d.rectangle([x + 54, y - 92, x + 132, y - 70], fill=acc)
        d.rectangle([x + 70, y - 88, x + 118, y - 74], fill=(190, 230, 250))
        d.ellipse([x - 24, y - 52, x + 60, y + 6], fill=(158, 158, 166))
        d.ellipse([x - 12, y - 40, x + 48, y - 2], fill=(120, 120, 128))
        _eyes(d, x + 92, y - 58, blink)
        _smile(d, x + 92, y - 42, happy)
        _wheel(d, x + 148, y - 14, 15)


# ---------------------------------------------------------------- subtitles
def subtitle(d: ImageDraw.ImageDraw, speaker: str, text: str, color: tuple[int, int, int]) -> None:
    f = font(40)
    label = font(26)
    tw = d.textlength(text, font=f)
    x0 = (W - tw) / 2 - 26
    d.rounded_rectangle([x0, H - 132, x0 + tw + 52, H - 62], radius=18, fill=(20, 22, 28))
    d.text(((W - tw) / 2, H - 122), text, font=f, fill=(255, 255, 255))
    if speaker:
        lw = d.textlength(speaker, font=label)
        d.rounded_rectangle([(W - lw) / 2 - 14, H - 170, (W - lw) / 2 + lw + 14, H - 134], radius=12, fill=color)
        d.text(((W - lw) / 2, H - 166), speaker, font=label, fill=(255, 255, 255))


def title_card(d: ImageDraw.ImageDraw, main: str, sub: str) -> None:
    d.rectangle([0, 0, W, H], fill=(28, 32, 44))
    f1, f2 = font(76), font(34)
    w1, w2 = d.textlength(main, font=f1), d.textlength(sub, font=f2)
    d.text(((W - w1) / 2, H / 2 - 96), main, font=f1, fill=(255, 255, 255))
    d.text(((W - w2) / 2, H / 2 + 10), sub, font=f2, fill=(180, 190, 210))
    _rainbow(d, (W - 320) / 2, H / 2 + 78, 320, 24)


# ---------------------------------------------------------------- timeline
@dataclass
class Beat:
    kind: str  # "line" | "action" | "open" | "title"
    dur: float
    char: str = ""
    text: str = ""
    audio: str = ""
    jd: float = JD
    happy: bool = False
    holes: int = 0
    road: bool = False
    cast: list[str] = field(default_factory=list)
    sub: str = ""


def build_timeline() -> list[Beat]:
    b: list[Beat] = []

    b.append(Beat("title", 3.5, text="Tim Kendaraan Konstruksi", sub="Episode 1 - Let's Meet First!"))

    # 1.1 opening, no dialogue
    b.append(Beat("open", 12.0, cast=ORDER))

    # 1.2 greeting a
    for ch, txt, fn in [
        ("buldo", "Hi! I am Buldo.", "en_ep1_buldo_0.mp3"),
        ("buldo", "I am strong!", "en_ep1_buldo_1.mp3"),
        ("eksa", "Hi! I am Eksa.", "en_ep2_eksa_2.mp3"),
        ("eksa", "I dig!", "en_ep2_eksa_3.mp3"),
    ]:
        b.append(Beat("line", 0, ch, txt, fn, cast=ORDER))
    # 1.3 greeting b
    for ch, txt, fn in [
        ("truk", "Hi! I am Truk.", "en_ep3_truk_4.mp3"),
        ("truk", "I carry sand!", "en_ep3_truk_5.mp3"),
        ("kreni", "Hi! I am Kreni.", "en_ep4_kreni_6.mp3"),
        ("kreni", "I am tall!", "en_ep4_kreni_7.mp3"),
    ]:
        b.append(Beat("line", 0, ch, txt, fn, cast=ORDER))
    # 1.4 greeting c
    for ch, txt, fn in [
        ("molen", "Hi! I am Molen.", "en_ep5_molen_8.mp3"),
        ("molen", "Round and round!", "en_ep5_molen_9.mp3"),
        ("giling", "Hi! I am Giling.", "en_ep6_giling_10.mp3"),
        ("giling", "I make it flat!", "en_ep6_giling_11.mp3"),
    ]:
        b.append(Beat("line", 0, ch, txt, fn, cast=ORDER))
    # 1.5 chant
    for txt, fn, jd in [
        ("Buldo, Eksa, Truk!", "en_ep7_all_12.mp3", JD),
        ("Kreni, Molen, Giling!", "en_ep7_all_13.mp3", JD_LONG),
        ("We are all friends!", "en_ep8_all_14.mp3", JD_LONG),
    ]:
        b.append(Beat("line", 0, "all", txt, fn, jd, happy=True, cast=ORDER))

    b.append(Beat("title", 3.0, text="Episode 2", sub="Let's Get to Work!"))

    # 2.1 problem
    b.append(Beat("action", 10.0, cast=ORDER, holes=2))
    b.append(Beat("line", 0, "buldo", "Ground is not flat.", "en_ep8_buldo_15.mp3", cast=ORDER, holes=2))
    b.append(Beat("line", 0, "buldo", "Let us go, Buldo helps!", "en_ep9_buldo_16.mp3", cast=ORDER, holes=2))
    # 2.2 buldo works
    b.append(Beat("action", 9.0, char="buldo", cast=ORDER, happy=True))
    b.append(Beat("line", 0, "buldo", "The ground is flat!", "en_ep9_buldo_17.mp3", happy=True, cast=ORDER))
    # 2.3 eksa digs
    b.append(Beat("line", 0, "eksa", "Now, I dig.", "en_ep10_eksa_18.mp3", cast=ORDER))
    b.append(Beat("action", 9.0, char="eksa", cast=ORDER))
    b.append(Beat("line", 0, "eksa", "One. Two.", "en_ep10_eksa_19.mp3", cast=ORDER))
    b.append(Beat("line", 0, "eksa", "The hole is ready!", "en_ep11_eksa_20.mp3", happy=True, cast=ORDER))
    # 2.4 truk carries
    b.append(Beat("line", 0, "truk", "Sand, let us go up!", "en_ep11_truk_21.mp3", cast=ORDER))
    b.append(Beat("action", 9.0, char="truk", cast=ORDER, road=True))
    b.append(Beat("line", 0, "truk", "Vroom vroom... go!", "en_ep12_truk_22.mp3", cast=ORDER, road=True))
    b.append(Beat("line", 0, "truk", "The sand is here!", "en_ep12_truk_23.mp3", happy=True, cast=ORDER, road=True))
    # 2.5 close
    b.append(Beat("line", 0, "all", "Working together is fun!", "en_ep13_all_24.mp3", JD_LONG, happy=True, cast=ORDER))
    b.append(Beat("action", 6.0, cast=ORDER, happy=True))

    # resolve line durations from the real audio
    for beat in b:
        if beat.kind == "line":
            path = AUDIO / beat.audio
            out = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                capture_output=True,
                text=True,
                check=True,
            )
            beat.dur = float(out.stdout.strip()) + beat.jd
    return b


# ---------------------------------------------------------------- render
def layout(cast: list[str]) -> dict[str, tuple[int, int]]:
    """Bottom-left anchor per character for the current cast."""
    n = len(cast)
    if n == 1:
        return {cast[0]: (W // 2 - 130, H - 210)}
    if n <= 3:
        step = W // (n + 1)
        return {c: (step * (i + 1) - 130, H - 200) for i, c in enumerate(cast)}
    # 4-6 vehicles: two rows, wide spacing so no footprint overlaps a neighbour
    xs = [60, 470, 880]
    ys = [H - 360, H - 150]
    out = {}
    for i, c in enumerate(cast):
        out[c] = (xs[i % 3], ys[i // 3])
    return out


_BG_CACHE: dict[tuple[int, bool], Image.Image] = {}


def background(holes: int = 0, flat_road: bool = False) -> Image.Image:
    """Cached static background -- drawn once per variant, pasted per frame."""
    key = (holes, flat_road)
    if key in _BG_CACHE:
        return _BG_CACHE[key]
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    draw_bg(d, dirt_holes=holes, flat_road=flat_road)
    _BG_CACHE[key] = img
    return img


def render() -> None:
    beats = build_timeline()
    total = sum(x.dur for x in beats)
    print(f"beats={len(beats)} total={total:.1f}s frames={int(total * FPS)}", flush=True)

    if FRAMES.exists():
        for f in FRAMES.glob("*.png"):
            f.unlink()
    FRAMES.mkdir(exist_ok=True)

    idx = 0
    t_global = 0.0
    for bi, beat in enumerate(beats):
        n = max(1, int(round(beat.dur * FPS)))
        cast = beat.cast or ([beat.char] if beat.char else ORDER)
        pos = layout(cast)
        for k in range(n):
            local = k / FPS
            t_global += 1 / FPS
            img = Image.new("RGB", (W, H), (255, 255, 255))
            d = ImageDraw.Draw(img)

            if beat.kind == "title":
                title_card(d, beat.text, beat.sub)
            else:
                img.paste(background(beat.holes, beat.road), (0, 0))
                d = ImageDraw.Draw(img)
                for i, key in enumerate(cast):
                    ch = CHARS[key]
                    bx, by = pos[key]
                    bx = int(bx + DRIFT * math.sin(local * 0.25 + i))
                    blink = (k + i * 17) % 90 < 7
                    speaker = beat.kind == "line" and (beat.char == key or beat.char == "all")
                    happy = beat.happy or speaker
                    spin = local * (1.1 if key == "molen" else 0.0)
                    if beat.kind == "line" and beat.char == key and ch.kind in ("bulldozer",):
                        bx += int(6 * math.sin(local * 3.0))
                    if beat.kind == "line" and beat.char == key and ch.kind == "excavator":
                        bx -= int(5 * math.sin(local * 2.4))
                    draw_vehicle(d, ch, bx, by, t_global, blink, happy=happy, spin=spin)
                    if speaker:
                        nm = "All" if beat.char == "all" else ch.name
                        f = font(30)
                        tw = d.textlength(nm, font=f)
                        d.rounded_rectangle(
                            [bx + 40, by - 300, bx + 40 + tw + 26, by - 258],
                            radius=14,
                            fill=ch.body,
                        )
                        d.text((bx + 53, by - 296), nm, font=f, fill=(25, 25, 30))
                if beat.kind == "line":
                    col = CHARS[beat.char].body if beat.char in CHARS else (60, 62, 70)
                    nm = "All" if beat.char == "all" else (CHARS[beat.char].name if beat.char in CHARS else "")
                    subtitle(d, f"{nm}", beat.text, col)

            img.save(FRAMES / f"f{idx:05d}.png")
            idx += 1

    print(f"frames written: {idx}")

    # ---------------------------------------------------------- audio graph
    inputs, filters, labels = [], [], []
    cursor = 0.0
    ai = 0
    for beat in beats:
        if beat.kind == "line":
            inputs += ["-i", str(AUDIO / beat.audio)]
            # input 0 is the frame sequence, so audio inputs start at index 1
            filters.append(f"[{ai + 1}:a]adelay={int(cursor * 1000)}|{int(cursor * 1000)},volume=1.0[a{ai}]")
            labels.append(f"[a{ai}]")
            ai += 1
        cursor += beat.dur
    amix = "".join(labels) + f"amix=inputs={ai}:duration=longest:normalize=0[aout]" if ai else ""
    fg = ";".join(filters + ([amix] if amix else []))

    video = OUT / "ep1_ep2_tim_kendaraan_konstruksi.mp4"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-framerate", str(FPS), "-i", str(FRAMES / "f%05d.png"),
        *inputs,
        "-filter_complex", fg,
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium",
        "-c:a", "aac", "-b:a", "160k",
        "-t", f"{total + 1.2:.2f}",
        str(video),
    ]
    print("encoding...")
    subprocess.run(cmd, check=True)
    print("OUT:", video)


if __name__ == "__main__":
    render()
