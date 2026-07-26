#!/usr/bin/env python3
"""把 static/ 的前端打包成 Android App 用的 mobile/www/。

設計原則：static/ 永遠是唯一的來源。開發功能時只改 static/，
桌面版重整瀏覽器就看得到；要出 App 時跑這支腳本，把同一份前端轉成
可以離線塞進 APK 的形式，不需要維護第二套程式碼。

轉換內容：
  1. 複製 static/ → mobile/www/
  2. 把 CDN 上的 React / pdf.js / 字型換成打包在 App 內的檔案
     （手機沒網路或連不到 unpkg 時，App 不該整個開不起來）
  3. 用 esbuild 事先把 .jsx 編譯成 .js，App 內不必再載入 3MB 的
     Babel standalone 即時編譯，冷啟動快很多
  4. 打包 Capacitor 外掛橋接（mobile/src/bridge.js → window.SMCap）
  5. 注入 window.SM_NATIVE，讓前端知道自己是 App 內建版本，
     需要另外指定後端位址（見 static/js/config.js）

用法：
    python scripts/build_mobile.py
    python scripts/build_mobile.py --api-base http://192.168.1.50:8000
    python scripts/build_mobile.py --api-base https://scanmail.example.com --sync
    python scripts/build_mobile.py --dev-server http://192.168.1.50:8000 --sync
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
MOBILE_DIR = ROOT / "mobile"
WWW_DIR = MOBILE_DIR / "www"
VENDOR_DIR = WWW_DIR / "vendor"
NODE_MODULES = MOBILE_DIR / "node_modules"
ANDROID_DIR = MOBILE_DIR / "android"

IS_WINDOWS = sys.platform.startswith("win")
NPM = "npm.cmd" if IS_WINDOWS else "npm"
NPX = "npx.cmd" if IS_WINDOWS else "npx"

# ── 要打包進 App 的第三方檔案（來源相對於 mobile/node_modules）──
VENDOR_FILES = [
    ("react/umd/react.production.min.js", "react.production.min.js"),
    ("react-dom/umd/react-dom.production.min.js", "react-dom.production.min.js"),
    ("pdfjs-dist/build/pdf.min.js", "pdf.min.js"),
    ("pdfjs-dist/build/pdf.worker.min.js", "pdf.worker.min.js"),
]

# ── 字型：只帶拉丁字母的裝飾字型 ──
# Noto Sans TC 刻意不打包 —— 中文交給 Android 內建的 Noto Sans CJK，
# 外觀幾乎沒差，卻能省下好幾 MB。
FONT_FACES = [
    # (@fontsource 套件, CSS font-family, 檔名 stem, 字重)
    ("@fontsource/caveat", "Caveat", "caveat-latin", [500, 600, 700]),
    ("@fontsource/architects-daughter", "Architects Daughter",
     "architects-daughter-latin", [400]),
    ("@fontsource/jetbrains-mono", "JetBrains Mono", "jetbrains-mono-latin", [400, 600]),
]


class BuildError(RuntimeError):
    pass


def log(msg: str) -> None:
    print(f"  {msg}")


def step(msg: str) -> None:
    print(f"\n▸ {msg}")


# ══════════════════════════════════════════════
#  版本
# ══════════════════════════════════════════════

def read_version() -> str:
    """從 main.py 的 FastAPI(version=...) 讀出版本 —— 專案裡已有的唯一版本來源。"""
    text = (ROOT / "main.py").read_text(encoding="utf-8")
    m = re.search(r'version\s*=\s*"(\d+\.\d+\.\d+)"', text)
    if not m:
        raise BuildError("在 main.py 找不到 version=\"x.y.z\"，無法決定 App 版本")
    return m.group(1)


def version_code(version: str) -> int:
    """3.4.0 → 30400。可用 ANDROID_VERSION_CODE 覆寫（上架時需要遞增）。"""
    override = os.environ.get("ANDROID_VERSION_CODE")
    if override:
        return int(override)
    major, minor, patch = (int(p) for p in version.split("."))
    return major * 10000 + minor * 100 + patch


# ══════════════════════════════════════════════
#  Node 工具
# ══════════════════════════════════════════════

def run(cmd: list[str], cwd: Path, env: dict | None = None) -> None:
    try:
        subprocess.run(cmd, cwd=cwd, check=True, env=env)
    except FileNotFoundError as e:
        raise BuildError(f"找不到指令 {cmd[0]} —— 請先安裝 Node.js 18 以上版本") from e
    except subprocess.CalledProcessError as e:
        raise BuildError(f"指令失敗（exit {e.returncode}）：{' '.join(cmd)}") from e


def ensure_node_modules() -> None:
    if NODE_MODULES.exists():
        return
    step("安裝 mobile/ 的 Node 相依套件（第一次會比較久）")
    run([NPM, "install"], cwd=MOBILE_DIR)


def esbuild(args: list[str]) -> None:
    run([NPX, "--no-install", "esbuild", *args], cwd=MOBILE_DIR)


# ══════════════════════════════════════════════
#  建置步驟
# ══════════════════════════════════════════════

def copy_static() -> None:
    step("複製 static/ → mobile/www/")
    if WWW_DIR.exists():
        shutil.rmtree(WWW_DIR)
    shutil.copytree(STATIC_DIR, WWW_DIR)
    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    log(f"{sum(1 for _ in WWW_DIR.rglob('*') if _.is_file())} 個檔案")


def vendor_libs() -> None:
    step("打包第三方函式庫（取代 CDN）")
    for src_rel, dest_name in VENDOR_FILES:
        src = NODE_MODULES / src_rel
        if not src.exists():
            raise BuildError(
                f"缺少 {src_rel}；請在 mobile/ 執行 npm install"
            )
        shutil.copy2(src, VENDOR_DIR / dest_name)
        log(f"{dest_name}  ({src.stat().st_size // 1024} KB)")


def vendor_fonts() -> None:
    """複製拉丁字型並產生 vendor/fonts.css。字型缺檔只警告不中斷。"""
    step("打包字型")
    fonts_out = VENDOR_DIR / "fonts"
    fonts_out.mkdir(parents=True, exist_ok=True)
    css: list[str] = [
        "/* 由 scripts/build_mobile.py 產生 —— 取代 Google Fonts CDN。",
        "   中文字型沿用 Android 內建的 Noto Sans CJK，不另外打包。 */",
    ]
    copied = 0
    for pkg, family, stem, weights in FONT_FACES:
        for weight in weights:
            filename = f"{stem}-{weight}-normal.woff2"
            src = NODE_MODULES / pkg / "files" / filename
            if not src.exists():
                print(f"  ⚠ 找不到 {pkg}/files/{filename}，略過此字重")
                continue
            shutil.copy2(src, fonts_out / filename)
            copied += 1
            css.append(
                "@font-face{"
                f"font-family:'{family}';font-style:normal;font-weight:{weight};"
                f"font-display:swap;src:url('fonts/{filename}') format('woff2');"
                "}"
            )
    (VENDOR_DIR / "fonts.css").write_text("\n".join(css) + "\n", encoding="utf-8")
    log(f"{copied} 個字型檔")


def build_bridge() -> None:
    step("打包 Capacitor 外掛橋接")
    esbuild([
        "src/bridge.js",
        "--bundle",
        "--format=iife",
        "--minify",
        "--target=chrome90",
        f"--outfile={(VENDOR_DIR / 'capacitor-bridge.js').relative_to(MOBILE_DIR)}",
    ])


def transpile_jsx() -> None:
    """把 www/js/*.jsx 就地編譯成 *.js（不 bundle，維持原本的全域變數共享方式）。"""
    step("編譯 JSX（App 內不再需要 Babel standalone）")
    jsx_files = sorted((WWW_DIR / "js").glob("*.jsx"))
    if not jsx_files:
        raise BuildError("mobile/www/js 下找不到任何 .jsx，複製步驟可能出錯了")
    for jsx in jsx_files:
        out = jsx.with_suffix(".js")
        if out.exists():
            raise BuildError(
                f"{jsx.name} 編譯後會蓋掉已存在的 {out.name}，請先改名避免衝突"
            )
        esbuild([
            str(jsx.relative_to(MOBILE_DIR)),
            "--jsx-factory=React.createElement",
            "--jsx-fragment=React.Fragment",
            "--target=chrome90",
            f"--outfile={out.relative_to(MOBILE_DIR)}",
        ])
        jsx.unlink()
        log(f"{jsx.name} → {out.name}")


def transform_index_html(html: str, api_base: str, version: str, offline: bool = False) -> str:
    """把 index.html 的內容改成 App 版本。

    每個替換都會檢查命中次數，static/index.html 一改結構就會直接失敗，
    而不是安靜地產出一個還在連 CDN 的 App。
    """

    def sub(pattern: str, repl: str, what: str, *, expected: int = 1) -> None:
        nonlocal html
        html, n = re.subn(pattern, repl, html)
        if n != expected:
            raise BuildError(
                f"改寫「{what}」時預期命中 {expected} 次，實際 {n} 次。"
                " static/index.html 結構可能改了，請同步更新 scripts/build_mobile.py"
            )

    # CDN → 本地檔案
    sub(r'<script src="https://unpkg\.com/react@[^"]+"[^>]*></script>',
        '<script src="vendor/react.production.min.js"></script>', "React")
    sub(r'<script src="https://unpkg\.com/react-dom@[^"]+"[^>]*></script>',
        '<script src="vendor/react-dom.production.min.js"></script>', "React DOM")
    sub(r'<script src="https://unpkg\.com/@babel/standalone@[^"]+"[^>]*></script>\n?',
        '', "移除 Babel standalone")
    sub(r'<script src="https://cdnjs\.cloudflare\.com/[^"]*/pdf\.min\.js"></script>',
        '<script src="vendor/pdf.min.js"></script>', "pdf.js")
    sub(r"'https://cdnjs\.cloudflare\.com/[^']*/pdf\.worker\.min\.js'",
        "'vendor/pdf.worker.min.js'", "pdf.js worker")
    sub(r'<link href="https://fonts\.googleapis\.com/[^"]+" rel="stylesheet"/>',
        '<link rel="stylesheet" href="vendor/fonts.css"/>', "Google Fonts")

    # 已預先編譯，改載入 .js
    sub(r'<script type="text/babel" src="js/([a-z0-9-]+)\.jsx',
        r'<script src="js/\1.js', "JSX script 標籤", expected=4)

    # 執行環境旗標（必須在 js/config.js 之前）
    default_api = api_base.rstrip("/")
    inject = (
        "<head>\n"
        "<!-- 以下由 scripts/build_mobile.py 注入 —— 請勿手動編輯 mobile/www/ -->\n"
        "<script>\n"
        "  window.SM_NATIVE = true;\n"
        + ("  window.SM_OFFLINE = true;\n" if offline else "")
        + f'  window.SM_DEFAULT_API_BASE = "{default_api}";\n'
        + "</script>\n"
        + f'<script src="vendor/capacitor-bridge.js?v={version}"></script>\n'
    )
    sub(r"<head>\n", inject, "注入 App 執行環境旗標")

    remaining = re.findall(r'(?:src|href)="(https?://[^"]+)"', html)
    if remaining:
        raise BuildError(
            "改寫後仍有指向外部網站的資源，App 離線時會載入失敗：\n  "
            + "\n  ".join(remaining)
        )
    return html


def rewrite_index(api_base: str, version: str, offline: bool) -> None:
    step("改寫 index.html")
    index = WWW_DIR / "index.html"
    index.write_text(
        transform_index_html(index.read_text(encoding="utf-8"), api_base, version, offline),
        encoding="utf-8",
    )
    if offline:
        log("離線精簡版：只保留在裝置上就能做完的圖片工具，不需要後端")
    else:
        log(f"預設後端位址：{api_base.rstrip('/') or '（未設定，App 首次啟動時詢問使用者）'}")


def write_version_props(version: str) -> None:
    step("寫入 Android 版本資訊")
    code = version_code(version)
    (ANDROID_DIR / "version.properties").write_text(
        "# 由 scripts/build_mobile.py 產生 —— 版本號來自 main.py\n"
        f"versionName={version}\n"
        f"versionCode={code}\n",
        encoding="utf-8",
    )
    log(f"versionName={version}  versionCode={code}")


def cap_sync(dev_server: str) -> None:
    step("同步到 Android 專案（npx cap sync android）")
    env = dict(os.environ)
    if dev_server:
        env["CAP_SERVER_URL"] = dev_server
        log(f"開發模式：App 會直接載入 {dev_server} 的前端")
    else:
        env.pop("CAP_SERVER_URL", None)
    run([NPX, "--no-install", "cap", "sync", "android"], cwd=MOBILE_DIR, env=env)


# ══════════════════════════════════════════════
#  進入點
# ══════════════════════════════════════════════

def main() -> int:
    parser = argparse.ArgumentParser(
        description="把 static/ 打包成 Android App 用的前端",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--api-base", default=os.environ.get("SM_API_BASE", ""),
        help="打包時預先填入的後端位址，例如 http://192.168.1.50:8000。"
             "不指定的話 App 第一次開啟會請使用者輸入。",
    )
    parser.add_argument(
        "--dev-server", default=os.environ.get("CAP_SERVER_URL", ""),
        help="開發模式：讓 App 直接載入這個位址的前端（改完存檔重整即可，不用重打包）。"
             "需搭配 --sync。",
    )
    parser.add_argument(
        "--offline", action="store_true", default=bool(os.environ.get("SM_OFFLINE")),
        help="建置離線精簡版：只保留能在裝置上用 Canvas 做完的圖片工具"
             "（縮放 / 轉檔 / 壓縮 / 拼接 / 旋轉 / 翻轉），完全不需要後端。",
    )
    parser.add_argument(
        "--sync", action="store_true",
        help="產生 www/ 後執行 npx cap sync android",
    )
    args = parser.parse_args()

    try:
        version = read_version()
        mode = "離線精簡版" if args.offline else "完整版"
        print(f"ScanMail+ {version} — 建置 Android App 前端（{mode}）")

        ensure_node_modules()
        copy_static()
        vendor_libs()
        vendor_fonts()
        build_bridge()
        transpile_jsx()
        rewrite_index(args.api_base, version, args.offline)
        write_version_props(version)
        if args.sync:
            cap_sync(args.dev_server)
    except BuildError as e:
        print(f"\n✗ 建置失敗：{e}", file=sys.stderr)
        return 1

    print("\n✓ 完成 → mobile/www/")
    if not args.sync:
        print("  接著執行：cd mobile && npx cap sync android")
    print("  產生 APK：cd mobile/android && ./gradlew assembleDebug")
    return 0


if __name__ == "__main__":
    sys.exit(main())
