#!/usr/bin/env python3
"""Build the Craig's Leaside badge as path-based SVG (no runtime font needed)."""

import math
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
PACIFICO = ROOT / "assets" / "fonts" / "Pacifico-Regular.ttf"
LIBERATION = Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf")
OUT = ROOT / "assets" / "logo.svg"

RED = "#E10613"
GREY = "#5C6168"
WHITE = "#FFFFFF"

SHIELD = (
    "M 256 492 "
    "C 138 418, 64 346, 64 220 "
    "L 64 112 "
    "Q 64 68, 112 68 "
    "L 400 68 "
    "Q 448 68, 448 112 "
    "L 448 220 "
    "C 448 346, 374 418, 256 492 Z"
)


def glyph_runs(font, text, size, tracking):
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font["head"].unitsPerEm
    scale = size / upem
    hmtx = font["hmtx"].metrics
    runs = []
    x = 0.0
    for ch in text:
        name = cmap.get(ord(ch))
        if name is None:
            x += size * 0.35
            continue
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(pen)
        commands = pen.getCommands()
        advance = hmtx[name][0] * scale
        if commands:
            runs.append((commands, x, scale))
        x += advance + tracking
    width = max(0.0, x - tracking) if text else 0.0
    return runs, width


def text_group(font, text, size, cx, baseline, tracking, fill, stroke=None, stroke_px=0):
    runs, width = glyph_runs(font, text, size, tracking)
    origin = cx - width / 2
    parts = [f'<g fill="{fill}">']
    for commands, x, scale in runs:
        stroke_attr = ""
        if stroke and stroke_px:
            font_units = stroke_px / scale
            stroke_attr = (
                f' stroke="{stroke}" stroke-width="{font_units:.2f}" '
                'stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"'
            )
        parts.append(
            f'<path d="{commands}" transform="translate({origin + x:.2f} {baseline:.2f}) '
            f'scale({scale:.6f} {-scale:.6f})"{stroke_attr}/>'
        )
    parts.append("</g>")
    return "\n".join(parts), width


def star(cx, cy, outer, inner, points=8):
    cmds = []
    for i in range(points * 2):
        ang = -math.pi / 2 + i * math.pi / points
        radius = outer if i % 2 == 0 else inner
        x = cx + radius * math.cos(ang)
        y = cy + radius * math.sin(ang)
        cmds.append(("M" if i == 0 else "L") + f"{x:.2f} {y:.2f}")
    cmds.append("Z")
    return " ".join(cmds)


def wrench_group():
    # Compact wrench and star, sitting between PARTS and SERVICE.
    return f"""
    <g fill="{WHITE}" transform="translate(256 304)">
      <path d="M-46 -11
               h12 v5 h6 v-8 h8 v8 h6 v-5 h12
               v7
               c0 7 -5 11 -12 11
               h-26
               c-7 0 -12 -4 -12 -11 Z"/>
      <rect x="-8" y="-4.5" width="22" height="9" rx="2"/>
      <circle cx="32" cy="0" r="12"/>
      <circle cx="32" cy="0" r="5" fill="{RED}"/>
      <path d="{star(-2, 0, 11, 4.6)}"/>
    </g>
    """


def build():
    pacifico = TTFont(str(PACIFICO))
    bold = TTFont(str(LIBERATION))
    script, _ = text_group(
        pacifico, "Craig's", 78, 256, 78, 0.5, RED, stroke=WHITE, stroke_px=7
    )
    leaside, _ = text_group(bold, "LEASIDE", 52, 256, 188, 6, WHITE)
    parts, _ = text_group(bold, "PARTS", 18, 148, 312, 1.2, WHITE)
    service, _ = text_group(bold, "SERVICE", 18, 368, 312, 1.1, WHITE)
    automotive, _ = text_group(bold, "AUTOMOTIVE", 28, 256, 392, 4.2, WHITE)

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 520" role="img" aria-label="Craig's Leaside Automotive">
  <path d="{SHIELD}" fill="{WHITE}"/>
  <g transform="translate(256 280) scale(0.955) translate(-256 -280)">
    <path d="{SHIELD}" fill="{RED}"/>
  </g>
  <g transform="translate(256 280) scale(0.905) translate(-256 -280)">
    <path d="{SHIELD}" fill="{GREY}"/>
  </g>
  <clipPath id="banner-clip">
    <path d="{SHIELD}" transform="translate(256 280) scale(0.955) translate(-256 -280)"/>
  </clipPath>
  <g clip-path="url(#banner-clip)">
    <rect x="40" y="276" width="432" height="56" fill="{RED}"/>
    <rect x="40" y="276" width="432" height="3" fill="{WHITE}"/>
    <rect x="40" y="329" width="432" height="3" fill="{WHITE}"/>
  </g>
  {leaside}
  {automotive}
  {parts}
  {service}
  {wrench_group()}
  {script}
</svg>
"""
    OUT.write_text(svg)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    build()
