#!/usr/bin/env python3
"""產生 App 標誌 —— static/icon-192.png 與 static/icon-512.png。

原本的圖示是「相機快門 + 信封」，那是掃描寄信時代的識別。
現在這個 App 是裝置端的媒體處理工具，識別改成三張斜向疊起來的媒體卡片，
最上面那張畫著最通用的「山與太陽」圖片符號。

設計上刻意只用幾何圖形與兩三個色階：
  * 縮到 48px 仍然看得出是「疊起來的東西」
  * 沒有文字，不會在小尺寸糊成一團
  * 沿用 Paper + Mint 配色，和 App 內部一致

用法：
    python scripts/gen_logo.py            # 產生 static/ 的圖示
    python scripts/gen_logo.py --preview  # 另外輸出一張各尺寸並排的預覽圖
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - Pillow 已列在 requirements.txt
    print("需要 Pillow：pip install -r requirements.txt", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"

# Paper + Mint 配色（與 static/css/palette.css 一致）
BG_TOP = (26, 62, 47)        # 深綠
BG_BOTTOM = (14, 32, 25)     # 更深的綠
CARD_BACK = (78, 160, 124)   # mint-3
CARD_MID = (114, 192, 154)   # mint-2
CARD_FRONT = (216, 240, 227) # 近白的薄荷

# 所有比例都以 1024 為基準，縮放到任何尺寸都一致
BASE = 1024
SS = 4  # 超取樣倍率，邊緣才不會有鋸齒


def _vertical_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return grad.resize((size, size), Image.BILINEAR)


def _rounded(draw: ImageDraw.ImageDraw, box, radius: int, fill) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def _draw_mark(draw: ImageDraw.ImageDraw, k: float, card_r: int) -> None:
    """畫出標誌本體（三張卡片 + 山與太陽），不含背景。"""
    # 三張斜向堆疊的卡片：最下面最小、最上面最大
    cards = [
        # (左, 上, 右, 下, 顏色)
        (300, 210, 830, 640, CARD_BACK),
        (245, 300, 775, 730, CARD_MID),
        (190, 390, 720, 820, CARD_FRONT),
    ]
    for left, top, right, bottom, color in cards:
        _rounded(
            draw,
            (round(left * k), round(top * k), round(right * k), round(bottom * k)),
            card_r // 2,
            color,
        )

    # 前景卡片上的「山與太陽」——最通用的圖片符號，小尺寸也認得出來
    sun_c = (round(300 * k), round(500 * k))
    sun_r = round(46 * k)
    draw.ellipse(
        (sun_c[0] - sun_r, sun_c[1] - sun_r, sun_c[0] + sun_r, sun_c[1] + sun_r),
        fill=CARD_BACK,
    )
    draw.polygon(
        [
            (round(230 * k), round(700 * k)),
            (round(390 * k), round(545 * k)),
            (round(545 * k), round(700 * k)),
        ],
        fill=CARD_MID,
    )
    draw.polygon(
        [
            (round(420 * k), round(700 * k)),
            (round(540 * k), round(590 * k)),
            (round(660 * k), round(700 * k)),
        ],
        fill=CARD_BACK,
    )



def render(size: int = BASE) -> Image.Image:
    """完整圖示：漸層背景 + 標誌 + 圓角遮罩。"""
    s_px = size * SS
    k = s_px / BASE
    card_r = round(150 * k)

    img = _vertical_gradient(s_px, BG_TOP, BG_BOTTOM).convert("RGBA")
    _draw_mark(ImageDraw.Draw(img), k, card_r)

    mask = Image.new("L", (s_px, s_px), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s_px - 1, s_px - 1), radius=card_r, fill=255)
    img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def render_mark(size: int = BASE) -> Image.Image:
    """只有標誌本體、透明背景，並裁到內容邊界。

    Android 自適應圖示的前景要能被系統任意遮罩，背景由 ic_launcher_background
    負責，所以前景不能自己帶一塊深色底。
    """
    s_px = size * SS
    k = s_px / BASE
    img = Image.new("RGBA", (s_px, s_px), (0, 0, 0, 0))
    _draw_mark(ImageDraw.Draw(img), k, round(150 * k))
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    return img.resize((size, round(size * img.height / img.width)), Image.LANCZOS)

def main() -> int:
    parser = argparse.ArgumentParser(description="產生 App 標誌")
    parser.add_argument("--preview", action="store_true", help="另外輸出各尺寸並排的預覽圖")
    parser.add_argument("--out", default=str(STATIC), help="輸出目錄（預設 static/）")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    for size in (192, 512):
        path = out_dir / f"icon-{size}.png"
        render(size).save(path, "PNG")
        print(f"  ✓ {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")

    if args.preview:
        sizes = [48, 72, 96, 144, 192]
        gap = 16
        width = sum(sizes) + gap * (len(sizes) + 1)
        height = max(sizes) + gap * 2
        sheet = Image.new("RGBA", (width, height), (246, 244, 236, 255))
        x = gap
        for size in sizes:
            sheet.paste(render(size), (x, (height - size) // 2), render(size))
            x += size + gap
        preview = out_dir / "icon-preview.png"
        sheet.save(preview, "PNG")
        print(f"  ✓ {preview}（各尺寸並排）")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
