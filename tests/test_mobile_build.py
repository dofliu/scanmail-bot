"""Android App 打包流程的防呆測試。

實際的 APK 由 CI 建置（需要 Android SDK），這裡守住的是比較容易在改前端時
默默壞掉、又不會馬上被發現的部分：

  * static/index.html 的結構還符合 build_mobile.py 的假設
  * 打包後的 index.html 沒有殘留任何 CDN 連結（App 離線就打不開）
  * 全域 script 之間沒有頂層變數撞名（Babel 會噴 SyntaxError，整頁白畫面）
  * 前端沒有繞過 SM_CONFIG 直接寫死 /api 路徑（App 內會打到 https://localhost）
"""
import importlib.util
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
JS = STATIC / "js"


def _load_build_module():
    """build_mobile.py 在 scripts/ 下，不是套件，直接用檔案路徑載入。"""
    path = ROOT / "scripts" / "build_mobile.py"
    spec = importlib.util.spec_from_file_location("build_mobile", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build_mobile = _load_build_module()


# ══════════════════════════════════════════════
#  版本
# ══════════════════════════════════════════════

def test_version_comes_from_main_py():
    version = build_mobile.read_version()
    assert re.fullmatch(r"\d+\.\d+\.\d+", version)
    assert f'version="{version}"' in (ROOT / "main.py").read_text(encoding="utf-8")


def test_version_code_is_monotonic_in_version():
    assert build_mobile.version_code("3.4.0") == 30400
    assert build_mobile.version_code("3.4.1") > build_mobile.version_code("3.4.0")
    assert build_mobile.version_code("3.5.0") > build_mobile.version_code("3.4.99")
    assert build_mobile.version_code("4.0.0") > build_mobile.version_code("3.99.99")


def test_android_version_properties_match_main_py():
    """version.properties 有進版控，改版號後別忘了重跑 build_mobile.py。"""
    props_file = ROOT / "mobile" / "android" / "version.properties"
    assert props_file.exists(), "缺少 mobile/android/version.properties"
    props = dict(
        line.split("=", 1)
        for line in props_file.read_text(encoding="utf-8").splitlines()
        if "=" in line and not line.startswith("#")
    )
    version = build_mobile.read_version()
    assert props["versionName"] == version
    assert int(props["versionCode"]) == build_mobile.version_code(version)


# ══════════════════════════════════════════════
#  index.html 改寫
# ══════════════════════════════════════════════

@pytest.fixture(scope="module")
def transformed_html():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    return build_mobile.transform_index_html(html, "http://192.168.1.50:8000", "3.4.0")


def test_transform_matches_current_index_html():
    """所有替換規則都必須命中 —— 沒命中就會丟 BuildError。"""
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    build_mobile.transform_index_html(html, "", "3.4.0")


def test_transformed_html_has_no_external_resources(transformed_html):
    assert 'src="https://' not in transformed_html
    assert 'href="https://' not in transformed_html


def test_transformed_html_uses_local_vendor_bundle(transformed_html):
    for asset in (
        "vendor/react.production.min.js",
        "vendor/react-dom.production.min.js",
        "vendor/pdf.min.js",
        "vendor/pdf.worker.min.js",
        "vendor/fonts.css",
        "vendor/capacitor-bridge.js",
    ):
        assert asset in transformed_html, f"打包後的 index.html 少了 {asset}"


def test_transformed_html_drops_babel_and_jsx(transformed_html):
    assert "@babel/standalone" not in transformed_html
    assert 'type="text/babel"' not in transformed_html
    assert ".jsx" not in transformed_html


def test_transformed_html_injects_native_flags(transformed_html):
    assert "window.SM_NATIVE = true;" in transformed_html
    assert 'window.SM_DEFAULT_API_BASE = "http://192.168.1.50:8000";' in transformed_html
    # 旗標必須在 config.js 之前，否則 config.js 讀不到
    assert transformed_html.index("window.SM_NATIVE") < transformed_html.index("js/config.js")


def test_transform_fails_loudly_when_index_changes():
    with pytest.raises(build_mobile.BuildError):
        build_mobile.transform_index_html("<html><head>\n</head></html>", "", "3.4.0")


def test_jsx_outputs_do_not_collide_with_existing_js():
    """atoms.jsx → atoms.js 之類的轉換不能蓋掉已存在的 .js 檔。"""
    js_names = {p.stem for p in JS.glob("*.js")}
    jsx_names = {p.stem for p in JS.glob("*.jsx")}
    assert not (js_names & jsx_names), f"JSX 編譯後會蓋掉同名檔案：{js_names & jsx_names}"


# ══════════════════════════════════════════════
#  離線精簡版
# ══════════════════════════════════════════════

def test_offline_build_injects_flag():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    offline = build_mobile.transform_index_html(html, "", "3.5.0", offline=True)
    assert "window.SM_OFFLINE = true;" in offline
    # 旗標必須在 config.js 之前，config.js 才讀得到
    assert offline.index("window.SM_OFFLINE") < offline.index("js/config.js")


def test_normal_build_has_no_offline_flag():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    normal = build_mobile.transform_index_html(html, "", "3.5.0")
    assert "SM_OFFLINE" not in normal


def test_config_reads_offline_flag():
    source = (JS / "config.js").read_text(encoding="utf-8")
    assert "window.SM_OFFLINE === true" in source
    # 離線版沒有後端，isConfigured 必須直接為真，否則會卡在伺服器設定畫面
    assert "offlineOnly ||" in source


def test_local_image_engine_is_self_contained():
    """本地引擎不能依賴 window.API / SM_CONFIG —— 它要能在完全沒有後端時運作。"""
    source = _strip_comments((JS / "image-local.js").read_text(encoding="utf-8"))
    for forbidden in ("window.API", "fetch(", "SM_CONFIG"):
        assert forbidden not in source, f"image-local.js 不該用到 {forbidden}"
    for symbol in ("window.SMImageLocal", "runner", "supportsOutput"):
        assert symbol in source, f"image-local.js 少了 {symbol}"


def test_local_engine_rejects_formats_canvas_cannot_encode():
    """canvas.toBlob 遇到不認得的型別會安靜地吐 PNG，必須先擋掉。"""
    source = (JS / "image-local.js").read_text(encoding="utf-8")
    mime_block = source[source.index("const MIME"):source.index("const EXT")]
    assert "BMP" not in mime_block and "GIF" not in mime_block


def test_offline_app_is_the_studio_shell():
    """離線版不共用完整版的導覽殼，直接進 Studio（編輯 + 轉換）。"""
    boot = (JS / "boot.jsx").read_text(encoding="utf-8")
    assert "offlineOnly" in boot and "window.Studio" in boot, "boot.jsx 沒有把離線版導向 Studio"

    studio = (JS / "studio.jsx").read_text(encoding="utf-8")
    for symbol in ("function Studio(", "function StudioEditor(", "function StudioConvert("):
        assert symbol in studio, f"studio.jsx 少了 {symbol}"


def test_studio_only_uses_the_local_engine():
    """Studio 是離線版的全部介面，不能出現任何後端呼叫。"""
    source = _strip_comments((JS / "studio.jsx").read_text(encoding="utf-8"))
    assert "SMImageLocal" in source, "studio.jsx 應該走本地引擎"
    for forbidden in ("fetch(", "window.API.img", "window.API.pdf", "window.API.docConvert"):
        assert forbidden not in source, f"studio.jsx 不該用到 {forbidden}"


def test_studio_offers_only_canvas_supported_formats():
    """Canvas 編不出 BMP / GIF，介面就不該讓使用者選。"""
    source = (JS / "studio.jsx").read_text(encoding="utf-8")
    formats = re.search(r"STUDIO_FORMATS = \[([^\]]*)\]", source).group(1)
    assert "BMP" not in formats and "GIF" not in formats, formats
    for fmt in ("JPG", "PNG", "WebP"):
        assert fmt in formats, f"少了 {fmt}"


def test_editor_shares_one_layout_source():
    """即時預覽與匯出必須走同一套版面計算，否則會「看到的跟存出來的不一樣」。"""
    source = (JS / "image-local.js").read_text(encoding="utf-8")
    assert "function layoutBoxes(" in source
    for fn in ("function merge(", "function composeToCanvas(", "function previewInto("):
        body_start = source.index(fn)
        body = source[body_start:body_start + 1800]
        assert "layoutBoxes(" in body, f"{fn} 沒有共用 layoutBoxes()"


def test_offline_build_makes_no_backend_calls_on_startup():
    """store.init() 在離線版必須直接返回，否則一開 App 就會噴連線錯誤。"""
    source = (JS / "store.js").read_text(encoding="utf-8")
    assert "offlineOnly" in source, "store.js 沒有處理離線版"


# ══════════════════════════════════════════════
#  全域 script 的頂層變數
# ══════════════════════════════════════════════

# index.html 直接載入、共用同一個全域範圍的檔案
GLOBAL_SCRIPTS = ["atoms.jsx", "mobile.jsx", "desktop.jsx", "boot.jsx"]

_DECL = re.compile(r"^(?:const|let|class)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)", re.MULTILINE)


def _top_level_names(source: str) -> set[str]:
    """抓出頂層（行首、沒有縮排）的 const / let / class 名稱。"""
    names: set[str] = set()
    for match in _DECL.finditer(source):
        raw = match.group(1)
        if raw.startswith("{"):
            for part in raw.strip("{}").split(","):
                part = part.strip()
                if not part:
                    continue
                # { useState: mUseState } → 綁定的是 mUseState
                names.add(part.split(":")[-1].strip())
        else:
            names.add(raw)
    return names


def test_global_scripts_have_no_duplicate_top_level_declarations():
    """兩支全域 script 宣告同名的頂層 const，瀏覽器會直接丟 SyntaxError，

    後面的 script 整個不執行 —— 畫面全白但錯誤訊息很不直觀。
    mobile.jsx / desktop.jsx 用 mUseState / dUseState 就是為了避開這件事。
    """
    seen: dict[str, str] = {}
    clashes = []
    for name in GLOBAL_SCRIPTS:
        for decl in _top_level_names((JS / name).read_text(encoding="utf-8")):
            if decl in seen:
                clashes.append(f"{decl}（{seen[decl]} 與 {name}）")
            else:
                seen[decl] = name
    assert not clashes, "全域 script 頂層變數撞名：" + "、".join(clashes)


# ══════════════════════════════════════════════
#  API 位址
# ══════════════════════════════════════════════

def test_index_html_loads_config_before_api():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    assert html.index("js/config.js") < html.index("js/native.js") < html.index("js/api.js")


def _strip_comments(source: str) -> str:
    """去掉註解，避免說明文字裡提到的路徑被誤判。"""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    # 只吃行首的 //，才不會誤刪 https:// 這種字串內容
    return re.sub(r"^\s*//.*$", "", source, flags=re.MULTILINE)


def _hardcoded_api_paths(name: str) -> list[str]:
    source = _strip_comments((JS / name).read_text(encoding="utf-8"))
    return re.findall(r"""['"`](/api/[^'"`]*)['"`]""", source)


def test_api_layer_routes_every_call_through_sm_config():
    """api.js 是前端唯一對外的出口，位址必須來自 SM_CONFIG。

    寫死 '/api/...' 在網頁版沒問題，但 App 內會打到 https://localhost 而失敗。
    """
    source = (JS / "api.js").read_text(encoding="utf-8")
    assert "window.SM_CONFIG" in source
    hardcoded = _hardcoded_api_paths("api.js")
    assert not hardcoded, f"api.js 出現寫死的 API 路徑：{hardcoded}"


def test_shell_scripts_do_not_call_api_urls_directly():
    """UI 層一律透過 window.API，不自己組 /api 路徑。"""
    offenders = {
        name: found
        for name in GLOBAL_SCRIPTS + ["store.js"]
        if (found := _hardcoded_api_paths(name))
    }
    assert not offenders, f"UI 層直接寫死 API 路徑：{offenders}"


def test_config_js_defaults_to_same_origin_on_web():
    source = (JS / "config.js").read_text(encoding="utf-8")
    assert "window.SM_NATIVE === true" in source
    assert "sm_api_base" in source


# ══════════════════════════════════════════════
#  Service Worker
# ══════════════════════════════════════════════

def test_service_worker_caches_all_loaded_scripts():
    """index.html 載入的前端檔案都要在 SW 的預快取清單裡，否則離線時會少檔案。"""
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    sw = (STATIC / "sw.js").read_text(encoding="utf-8")
    loaded = set(re.findall(r'src="(js/[\w.-]+\.jsx?)\?', html))
    assert loaded, "index.html 沒有載入任何 js/ 檔案？"
    missing = [path for path in loaded if f"'/{path}'" not in sw]
    assert not missing, f"sw.js 的 ASSETS 少了：{missing}"


# ══════════════════════════════════════════════
#  Android 專案設定
# ══════════════════════════════════════════════

ANDROID = ROOT / "mobile" / "android" / "app" / "src" / "main"


def test_android_manifest_declares_camera_and_cleartext():
    manifest = (ANDROID / "AndroidManifest.xml").read_text(encoding="utf-8")
    assert "android.permission.INTERNET" in manifest
    # 掃描頁用 getUserMedia，沒有 CAMERA 權限相機開不起來
    assert "android.permission.CAMERA" in manifest
    # 後端通常是區網 http://192.168.x.x:8000
    assert "networkSecurityConfig" in manifest
    assert (ANDROID / "res" / "xml" / "network_security_config.xml").exists()


def test_capacitor_config_allows_mixed_content():
    """WebView 來源是 https://localhost，要打區網 http 後端必須放行 mixed content。"""
    config = (ROOT / "mobile" / "capacitor.config.js").read_text(encoding="utf-8")
    assert "allowMixedContent: true" in config
    assert "webDir: 'www'" in config
