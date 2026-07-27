#!/usr/bin/env python3
"""產生 PDF 內嵌用的中文字型子集。

離線版要能自己輸出 PDF，就得在 App 裡放一份中文字型 —— 手機系統字型
拿不到檔案，PDF 又必須把字型嵌進去才能在別台機器正確顯示。

完整的 Noto Sans TC 有 20812 個字符、7.1 MB，全部塞進 APK 太浪費。
這支腳本把它裁成「Big5 全字集 + 常用符號 + 假名 + 希臘/西里爾」，
大約 13500 字、4.7 MB，涵蓋繁體中文實務上會用到的所有字。

執行階段還會再裁一次 —— static/js/ttf-lite.js 只會把文件真正用到的字
嵌進 PDF，所以輸出的 PDF 通常只有幾十 KB，不會背著整份字型。

用法：
    python scripts/make_pdf_font.py                 # 自動抓字型再裁
    python scripts/make_pdf_font.py --source a.ttf  # 用手上的 TTF

需要 fonttools（pip install fonttools）。字型來源是 npm 上的
@expo-google-fonts/noto-sans-tc，裡面就是 Google Fonts 的原始 TTF。
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "static" / "vendor" / "fonts"
OUT_FONT = OUT_DIR / "NotoSansTC-Subset.ttf"
OUT_LICENSE = OUT_DIR / "NotoSansTC-LICENSE.txt"

NPM_PKG = "@expo-google-fonts/noto-sans-tc"
TTF_IN_PKG = "package/400Regular/NotoSansTC_400Regular.ttf"
LICENSE_IN_PKG = "package/LICENSE_FONT"

IS_WINDOWS = sys.platform.startswith("win")
NPM = "npm.cmd" if IS_WINDOWS else "npm"

# Big5 的兩個漢字區段：常用字（A440–C67E）與次常用字（C940–F9D5）。
# 直接用 Python 內建的 big5 codec 反推，不必另外維護一份字表。
BIG5_LEAD_RANGES = ((0xA4, 0xC7), (0xC9, 0xFA))

# 符號區段。項目符號 •、圈號 ①、分隔線 ─ 這些轉檔時一定會用到，
# 少一個字在 PDF 裡就是一個空白，所以整段收進來（字型沒有的會自動略過）。
SYMBOL_RANGES = [
    (0x2000, 0x206F),  # 一般標點（含 • … – —）
    (0x2100, 0x214F),  # 類字母符號（№ ℃ ℉）
    (0x2190, 0x21FF),  # 箭頭
    (0x2200, 0x22FF),  # 數學運算子
    (0x2460, 0x24FF),  # 圈圈數字 ①②③
    (0x2500, 0x257F),  # 製表符號 ─│┌┐
    (0x25A0, 0x25FF),  # 幾何圖形 ■□●○
    (0x2600, 0x27BF),  # 雜項符號與裝飾符號 ★☆✓✗
]
EXTRA_SYMBOLS = "°×÷§¶·¥€£±"


def big5_chars() -> list[str]:
    out: list[str] = []
    trail = list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF))
    for lo, hi in BIG5_LEAD_RANGES:
        for lead in range(lo, hi):
            for t in trail:
                try:
                    out.append(bytes([lead, t]).decode("big5"))
                except UnicodeDecodeError:
                    continue
    return out


def charset() -> str:
    chars: list[str] = [chr(c) for c in range(0x20, 0x7F)]          # ASCII
    chars += list(EXTRA_SYMBOLS)
    chars += [chr(c) for c in range(0x00A0, 0x0100)]                # Latin-1 補充
    chars += [chr(c) for c in range(0x0391, 0x03CA)]                # 希臘
    chars += [chr(c) for c in range(0x0410, 0x0450)]                # 西里爾
    for lo, hi in SYMBOL_RANGES:
        chars += [chr(c) for c in range(lo, hi + 1)]
    chars += [chr(c) for c in range(0x3000, 0x3040)]                # CJK 標點
    chars += [chr(c) for c in range(0x3040, 0x3100)]                # 平假名 / 片假名
    chars += [chr(c) for c in range(0x3105, 0x3130)]                # 注音
    chars += [chr(c) for c in range(0xFF01, 0xFF60)]                # 全形
    chars += [chr(c) for c in range(0xFFE0, 0xFFE7)]                # 全形貨幣
    chars += big5_chars()
    # dict.fromkeys 去重但保留順序，讓輸出可重現
    return "".join(dict.fromkeys(chars))


def fetch_source(workdir: Path) -> tuple[Path, Path]:
    """從 npm 抓原始字型，回傳 (ttf, license)。"""
    print(f"→ npm pack {NPM_PKG}（約 39 MB，只需要做一次）")
    proc = subprocess.run(
        [NPM, "pack", NPM_PKG, "--quiet"],
        cwd=workdir, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(
            f"下載字型失敗：{proc.stderr.strip()}\n"
            f"也可以自己下載 Noto Sans TC Regular 的 TTF，再用 --source 指定。"
        )
    tgz = next(workdir.glob("*.tgz"), None)
    if tgz is None:
        raise SystemExit("npm pack 沒有產生 .tgz")
    with tarfile.open(tgz) as tar:
        for member in (TTF_IN_PKG, LICENSE_IN_PKG):
            tar.extract(tar.getmember(member), path=workdir)
    return workdir / TTF_IN_PKG, workdir / LICENSE_IN_PKG


def subset(source: Path, chars: str, out: Path) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as fh:
        fh.write(chars)
        text_file = fh.name
    try:
        # 只留 PDF 內嵌真正需要的表。GPOS/GSUB 是排版用的，我們自己算位置，
        # 留著只是白佔幾百 KB。
        subprocess.run([
            sys.executable, "-m", "fontTools.subset", str(source),
            f"--text-file={text_file}",
            f"--output-file={out}",
            "--layout-features=",
            "--drop-tables+=BASE,GDEF,GPOS,GSUB,STAT,vhea,vmtx,gasp",
            "--no-hinting",
            "--desubroutinize",
            "--name-IDs=1,2,3,4,5,6,13,14",
            "--notdef-outline",
            "--recommended-glyphs",
        ], check=True)
    finally:
        os.unlink(text_file)


def main() -> int:
    ap = argparse.ArgumentParser(description="產生 PDF 內嵌用的中文字型子集")
    ap.add_argument("--source", help="現成的 Noto Sans TC Regular TTF")
    args = ap.parse_args()

    try:
        import fontTools  # noqa: F401
    except ImportError:
        raise SystemExit("需要 fonttools：pip install fonttools")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    chars = charset()
    print(f"字集 {len(chars)} 字")

    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        if args.source:
            source, license_src = Path(args.source), None
        else:
            source, license_src = fetch_source(workdir)
        subset(source, chars, OUT_FONT)
        if license_src is not None:
            shutil.copy2(license_src, OUT_LICENSE)

    size = OUT_FONT.stat().st_size
    print(f"✓ {OUT_FONT.relative_to(ROOT)}  {size / 1024 / 1024:.2f} MB")
    if not OUT_LICENSE.exists():
        print("! 沒有一併複製 OFL 授權，請確認 static/vendor/fonts/ 裡有 NotoSansTC-LICENSE.txt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
