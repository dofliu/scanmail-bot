#!/usr/bin/env python3
"""從 scripts/gen_logo.py 的標誌產生 Android 的啟動圖示與啟動畫面。

圖示只有在來源圖換掉時才需要重跑，產物會直接進版控
（Android 專案本來就該是可以直接開起來 build 的狀態）。

用法：
    python scripts/gen_android_icons.py
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - 依賴已列在 requirements.txt
    print("需要 Pillow：pip install -r requirements.txt", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "mobile" / "android" / "app" / "src" / "main" / "res"

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_logo  # noqa: E402  —— 標誌的唯一來源

# 自適應圖示的底色（取自來源圖的深綠）與啟動畫面底色（與 theme_color 一致）
ADAPTIVE_BG = "#1b3f30"
SPLASH_BG = "#141c18"

LAUNCHER_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# 自適應圖示是 108dp，系統只保證中央 66dp 不會被裁掉
FOREGROUND_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SAFE_ZONE_RATIO = 66 / 108

SPLASH_SIZES = {
    "mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280),
    "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920),
}


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def write(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def main() -> int:
    print("標誌來源：scripts/gen_logo.py")

    count = 0
    for dpi, size in LAUNCHER_SIZES.items():
        square = gen_logo.render(size)
        write(square, RES / f"mipmap-{dpi}" / "ic_launcher.png")

        # 圓形圖示：整張圖套圓形遮罩
        round_icon = square.copy()
        round_icon.putalpha(circle_mask(size))
        write(round_icon, RES / f"mipmap-{dpi}" / "ic_launcher_round.png")
        count += 2

    for dpi, size in FOREGROUND_SIZES.items():
        # 前景是透明底，logo 縮到安全區內，四周留白讓系統裁切遮罩不會切到內容
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        inner = int(size * SAFE_ZONE_RATIO)
        mark = gen_logo.render_mark(inner)
        canvas.paste(mark, ((size - mark.width) // 2, (size - mark.height) // 2), mark)
        write(canvas, RES / f"mipmap-{dpi}" / "ic_launcher_foreground.png")
        count += 1

    for dpi, (w, h) in SPLASH_SIZES.items():
        for orientation, size in (("port", (w, h)), ("land", (h, w))):
            canvas = Image.new("RGBA", size, SPLASH_BG)
            art = gen_logo.render_mark(int(min(size) * 0.42))
            canvas.paste(art, ((size[0] - art.width) // 2, (size[1] - art.height) // 2), art)
            write(canvas.convert("RGB"), RES / f"drawable-{orientation}-{dpi}" / "splash.png")
            count += 1

    # 沒有 dpi 限定的預設啟動圖
    default = Image.new("RGBA", (480, 320), SPLASH_BG)
    art = gen_logo.render_mark(int(320 * 0.42))
    default.paste(art, ((480 - art.width) // 2, (320 - art.height) // 2), art)
    write(default.convert("RGB"), RES / "drawable" / "splash.png")
    count += 1

    # 自適應圖示底色
    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">{ADAPTIVE_BG}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )

    # Capacitor 預設會產一份向量前景，改用 PNG 後要移掉，
    # 否則 drawable-v24 的優先度較高，會蓋掉 mipmap 的前景圖。
    stale = RES / "drawable-v24" / "ic_launcher_foreground.xml"
    if stale.exists():
        stale.unlink()
        try:
            stale.parent.rmdir()
        except OSError:
            pass
        print("  移除 Capacitor 預設的向量前景 drawable-v24/ic_launcher_foreground.xml")

    print(f"✓ 產生 {count} 個圖檔 → {RES.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
