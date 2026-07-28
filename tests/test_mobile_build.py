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


def test_toolbar_is_contextual():
    """所有選項都在底部工具列，且依有沒有選圖切換 —— 不能兩組同時攤在畫面上。"""
    source = (JS / "studio.jsx").read_text(encoding="utf-8")
    # 以 current（= 有選到圖）決定工具列內容
    assert "{current ? (" in source, "工具列沒有依選取狀態切換"
    for label in ("左轉", "右轉", "裁切", "打碼", "調整", "完成"):
        assert f'label="{label}"' in source, f"圖片工具列少了 {label}"
    for label in ("版面", "圖框", "間距", "文字", "加圖", "製作"):
        assert f'label="{label}"' in source, f"拼貼工具列少了 {label}"


def test_options_live_in_sheets_not_on_screen():
    """細項一律收進面板，靠 sheet 狀態開關，不常駐佔畫面。"""
    source = (JS / "studio.jsx").read_text(encoding="utf-8")
    assert "const [sheet, setSheet]" in source
    assert "{sheet && sheets[sheet]}" in source, "面板不是依狀態渲染"
    # 每個面板都要有關閉的方式
    assert "function StudioSheet(" in source and "onClose" in source


def test_layout_presets_cover_common_grids():
    """版面要能直接選 2×3 / 3×3 這種，不是只給一個欄數輸入框。"""
    source = (JS / "studio.jsx").read_text(encoding="utf-8")
    presets = source[source.index("STUDIO_LAYOUTS"):source.index("STUDIO_FRAMES")]
    for label in ("直式", "橫式", "2×2", "2×3", "3×2", "3×3", "4×4"):
        assert label in presets, f"版面預設少了 {label}"
    # 格狀預設要用 cover，格子才會一樣大、圖片填滿
    assert presets.count("fill: 'cover'") >= 5, "格狀預設沒有使用 cover"


def test_frame_and_crop_options_exist():
    source = (JS / "studio.jsx").read_text(encoding="utf-8")
    frames = source[source.index("STUDIO_FRAMES"):source.index("STUDIO_CROPS")]
    for label in ("圓角", "細邊", "白框", "陰影", "拍立得"):
        assert label in frames, f"圖框樣式少了 {label}"
    crops = source[source.index("STUDIO_CROPS"):source.index("STUDIO_SWATCHES")]
    for label in ("自由", "1:1", "16:9"):
        assert label in crops, f"裁切比例少了 {label}"


def test_engine_supports_crop_and_frames():
    source = _strip_comments((JS / "image-local.js").read_text(encoding="utf-8"))
    for fn in ("function cropToRect(", "function drawCell(", "function roundedPath("):
        assert fn in source, f"引擎少了 {fn}"
    # 裁切要在變形階段生效，才會影響版面計算
    assert "cropToRect(out.canvas, item.cropRect)" in source, "renderItem 沒有套用裁切"


def test_crop_happens_after_rotation():
    """裁切框是使用者在畫面上拉的，而畫面是轉過的 —— 先裁再轉會裁到別的地方。"""
    source = _strip_comments((JS / "image-local.js").read_text(encoding="utf-8"))
    body = source[source.index("function renderItem("):]
    body = body[: body.index("function rotateRect(")]
    assert body.index("ctx.rotate(") < body.index("cropToRect("), "renderItem 的裁切排在旋轉之前"
    # 轉圖時裁切框要跟著轉，否則轉一下就會裁到別的地方
    for fn in ("function rotateRect(", "function flipRect("):
        assert fn in source, f"引擎少了 {fn}"
    studio = (JS / "studio.jsx").read_text(encoding="utf-8")
    assert "rotateRect(current.cropRect" in studio
    assert "flipRect(current.cropRect" in studio


def test_free_crop_is_a_full_screen_editor():
    """固定比例的置中裁切不夠用 —— 要能自己拉框。"""
    studio = (JS / "studio.jsx").read_text(encoding="utf-8")
    assert "function StudioCropper(" in studio
    for handler in ("onPointerDown", "onPointerMove", "onPointerUp"):
        assert handler in studio, f"裁切少了 {handler}，手機上拖不動"
    assert "touchAction: 'none'" in studio, "沒有擋掉捲動，手機上會邊拖邊捲"
    assert "setCropping(true)" in studio, "裁切沒有進入獨立畫面"
    # 離開裁切後 canvas 是新的 DOM 元素，不重畫會停在瀏覽器預設的空白畫布。
    # 每個全螢幕模式都要列進相依 —— 打碼、拉正、簽名都一樣。
    assert ("[items, layout, frame, sel, cropping, redacting, deskewing, signing, "
            "text, stamps, signatures]") in studio


def test_images_convert_to_pdf_losslessly():
    """PDF 的 /DCTDecode 吃的就是 JPEG 原始位元組，照片可以完全不重新編碼。"""
    writer = _strip_comments((JS / "pdf-write.js").read_text(encoding="utf-8"))
    assert "function readJpeg(" in writer
    assert "/DCTDecode" in writer
    assert "/Subtype /Image" in writer
    # PDF 檢視器不看 Exif，轉正得靠變換矩陣
    assert "function readExifOrientation(" in writer
    assert "const ORIENT = {" in writer

    engine = _strip_comments((JS / "image-local.js").read_text(encoding="utf-8"))
    assert "async function imagesToPdf(" in engine
    assert "async function jpegBytesFor(" in engine
    assert "return { bytes: raw, reused: true }" in engine, "沒有原樣沿用的路徑，等於每張都重壓一次"


def test_pdf_renders_back_to_images():
    source = _strip_comments((JS / "doc-local.js").read_text(encoding="utf-8"))
    assert "async function pdfToImages(" in source
    # 空白頁沒有底色，直接存 JPG 會變黑底
    body = source[source.index("async function pdfToImages("):]
    assert "fillRect(0, 0, canvas.width, canvas.height)" in body[:2000]


def test_pdf_buffer_is_copied_before_handing_to_pdfjs():
    """pdf.js 會接管傳進去的緩衝區，同一份檔案想抽文字又轉圖片就會炸。"""
    source = _strip_comments((JS / "doc-local.js").read_text(encoding="utf-8"))
    assert "function pdfBytes(" in source
    # pdfToImages / pdfThumbnails / pdfPageImage / parse —— 每一條路都要走 pdfBytes
    assert source.count("getDocument({ data: pdfBytes(") == 4
    assert "getDocument({ data: new Uint8Array(" not in source


def test_editor_shares_one_layout_source():
    """即時預覽與匯出必須走同一套版面計算，否則會「看到的跟存出來的不一樣」。"""
    source = (JS / "image-local.js").read_text(encoding="utf-8")
    assert "function layoutBoxes(" in source
    for fn in ("function merge(", "function composeToCanvas(", "function previewInto("):
        body_start = source.index(fn)
        body = source[body_start:body_start + 1800]
        assert "layoutBoxes(" in body, f"{fn} 沒有共用 layoutBoxes()"


# ══════════════════════════════════════════════
#  文件轉檔（PDF / Word / Markdown）
# ══════════════════════════════════════════════

PDF_FONT = STATIC / "vendor" / "fonts" / "NotoSansTC-Subset.ttf"


def test_pdf_font_is_bundled():
    """PDF 一定要內嵌字型，收檔案的人才看得到中文 —— 系統字型拿不到檔案。"""
    assert PDF_FONT.exists(), "缺少 PDF 內嵌用的中文字型，請跑 scripts/make_pdf_font.py"
    size = PDF_FONT.stat().st_size
    # 太小代表裁過頭（大概只剩拉丁字母），太大代表沒裁
    assert 2_000_000 < size < 8_000_000, f"字型大小不合理：{size} bytes"
    assert (STATIC / "vendor" / "fonts" / "NotoSansTC-LICENSE.txt").exists(), \
        "Noto Sans TC 是 OFL 授權，必須一併附上授權條款"


def test_build_refuses_to_run_without_the_font():
    """字型沒產出來就打包，App 會裝好之後才在輸出 PDF 時炸掉 —— 要在建置階段擋下來。"""
    source = (ROOT / "scripts" / "build_mobile.py").read_text(encoding="utf-8")
    assert "PDF_FONT" in source and "if not PDF_FONT.exists()" in source


def test_doc_conversion_is_fully_local():
    """文件轉檔不能偷偷打後端 —— 這幾支就是離線版的全部本事。"""
    for name in ("doc-local.js", "zip-lite.js", "ttf-lite.js", "pdf-write.js"):
        source = _strip_comments((JS / name).read_text(encoding="utf-8"))
        assert "/api/" not in source, f"{name} 不該呼叫後端"
        assert "window.API" not in source, f"{name} 不該依賴後端 API 層"
    # 只有字型是靠 fetch 拿的，而且是本地檔案
    doc = _strip_comments((JS / "doc-local.js").read_text(encoding="utf-8"))
    fetches = re.findall(r"fetch\(([^)]*)\)", doc)
    assert fetches == ["url || FONT_URL"], f"doc-local.js 有預期外的 fetch：{fetches}"


def test_every_input_format_reaches_every_output_format():
    """中間隔一層文件模型，所以格式之間是任意組合，不是寫死的每一對轉換。"""
    source = (JS / "doc-local.js").read_text(encoding="utf-8")
    for fn in ("function fromMarkdown(", "function fromDocx(", "async function fromPdf("):
        assert fn in source, f"少了輸入端 {fn}"
    for fn in ("function toMarkdown(", "async function toDocx(", "async function toPdf(",
               "function toHtml(", "function toText("):
        assert fn in source, f"少了輸出端 {fn}"
    assert "INPUTS = ['md', 'docx', 'pdf', 'txt']" in source
    assert "OUTPUTS = ['md', 'docx', 'pdf', 'txt', 'html']" in source


def test_pdf_embeds_a_subset_not_the_whole_font():
    """整份字型 4.6 MB，每產一個 PDF 都塞一份就沒得用了。"""
    ttf = _strip_comments((JS / "ttf-lite.js").read_text(encoding="utf-8"))
    assert "function subset(gidSet)" in ttf
    assert "function closeOver(" in ttf, "複合字符要遞迴收齊，否則字會缺一塊"
    writer = _strip_comments((JS / "pdf-write.js").read_text(encoding="utf-8"))
    assert "font.ttf.subset(new Set(font.used.keys()))" in writer, "PDF 沒有只嵌入用到的字"
    # 裁字型會重新編號，內文一定要跟著換算
    assert "op.font.remap" in writer
    assert "還沒子集化就要輸出內容" in (JS / "pdf-write.js").read_text(encoding="utf-8")


def test_pdf_text_stays_selectable():
    """沒有 ToUnicode，PDF 裡的中文複製出來會變亂碼。"""
    writer = _strip_comments((JS / "pdf-write.js").read_text(encoding="utf-8"))
    assert "function toUnicode(" in writer
    assert "/ToUnicode" in writer
    assert "/Encoding /Identity-H" in writer


def test_docx_contains_the_parts_word_requires():
    source = (JS / "doc-local.js").read_text(encoding="utf-8")
    for part in ("[Content_Types].xml", "_rels/.rels", "word/document.xml",
                 "word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels"):
        assert f"'{part}'" in source, f"DOCX 少了 {part}"
    assert "w:tblGrid" in source, "少了 w:tblGrid，嚴謹的解析器會判定檔案無效"


def test_docx_reader_handles_list_styles():
    """Word 與 python-docx 的清單常常只寫在樣式上，段落本身沒有 w:numPr。"""
    source = (JS / "doc-local.js").read_text(encoding="utf-8")
    assert "function readStyles(" in source
    assert "function resolveStyle(" in source, "樣式的 basedOn 要能往上追"


def test_pdf_object_layer_is_lossless():
    """頁面操作要無損 —— 內容串流原樣搬過去，不是重畫成圖再貼回去。"""
    source = _strip_comments((JS / "pdf-lite.js").read_text(encoding="utf-8"))
    assert "async function open(" in source
    assert "async function compose(" in source
    # 兩種 xref 格式都要讀：舊的表格與 PDF 1.5 之後的串流
    assert "function readXrefTable(" in source
    assert "async function readXrefStream(" in source
    assert "async function expandObjectStream(" in source, "物件串流沒展開，現代 PDF 會讀不到東西"
    assert "function unpredict(" in source, "xref 串流幾乎都用 PNG 預測子"
    # 串流原樣保留：複製時只換字典，raw 直接沿用
    assert "new PdfStream(copy(doc, value.dict, depth + 1), value.raw)" in source


def test_pdf_parser_survives_real_world_files():
    source = _strip_comments((JS / "pdf-lite.js").read_text(encoding="utf-8"))
    # xref 壞掉是常態，要有退路
    assert "function scanAllObjects(" in source
    # 屬性可以寫在父節點上，抽頁時要一起帶走
    assert "const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate']" in source
    # 加密的檔案要明講，不要產出壞掉的輸出
    assert "有加密保護" in (JS / "pdf-lite.js").read_text(encoding="utf-8")


def test_page_copy_does_not_drag_in_other_pages():
    """註解的跳頁目的地會指向別頁，照抄就會把整份文件帶過來。"""
    source = _strip_comments((JS / "pdf-lite.js").read_text(encoding="utf-8"))
    assert "isName(dict.get('Type'), 'Page') && !included.get(doc).has(target)" in source
    assert "if (k === 'Parent') continue" in source, "頁面樹要自己重建，不能沿用來源的 Parent"


def test_redaction_actually_destroys_pixels():
    """打碼要真的把像素改掉 —— 蓋一層可以移除的東西等於沒遮。"""
    source = _strip_comments((JS / "image-local.js").read_text(encoding="utf-8"))
    assert "function applyRedactions(" in source
    for style in ("'fill'", "'blur'"):
        assert style in source, f"打碼少了 {style} 樣式"
    assert "imageSmoothingEnabled = false" in source, "馬賽克要關掉平滑才會是方格"
    # renderItem 的位移沒還原的話，遮罩會整個飄走
    assert "out.ctx.save()" in source and "out.ctx.restore()" in source
    body = source[source.index("function applyRedactions("):]
    assert "ctx.setTransform(1, 0, 0, 1, 0, 0)" in body[:600], \
        "applyRedactions 沒有把座標系歸零，換個呼叫端就會畫錯位置"


def test_text_layer_scales_with_the_canvas():
    """位置與字級都要用相對值，不然縮圖預覽跟原圖匯出會長得不一樣。"""
    source = _strip_comments((JS / "image-local.js").read_text(encoding="utf-8"))
    assert "function drawTexts(" in source
    assert "const unit = Math.min(W, H)" in source
    assert "t.tile" in source, "少了平鋪浮水印"
    # 描邊是白字壓白底時唯一看得見的辦法
    assert "strokeText(" in source
    # 文字疊在成品最上層，不是疊在某一格上；簽名再疊在文字之上
    compose = source[source.index("function composeToCanvas("):]
    assert "drawTexts(out.canvas, opts.texts)" in compose[:1400]
    assert compose.index("drawTexts(out.canvas") < compose.index("drawSignatures(out.canvas"), \
        "簽名要蓋在文字上面 —— 簽名是最後蓋的那一道"


def test_studio_exposes_the_new_editing_tools():
    source = (JS / "studio.jsx").read_text(encoding="utf-8")
    assert "function StudioRedactor(" in source
    for label in ("打碼", "調整", "文字"):
        assert f'label="{label}"' in source, f"工具列少了 {label}"
    # 「大小」併進「調整」了，工具列才不會擠爆
    assert 'label="大小"' not in source
    assert "StudioSheet title=\"調整\"" in source
    # 濾鏡預設由引擎提供，介面不要自己再抄一份
    assert "window.SMImageLocal.ADJUST_PRESETS" in source


def test_studio_has_a_pages_tab():
    source = (JS / "studio.jsx").read_text(encoding="utf-8")
    assert "function StudioPages(" in source
    assert "SMPDFLite.compose(" in source
    for label in ("加檔", "前移", "後移", "左轉", "右轉"):
        assert f"label=\"{label}\"" in source, f"頁面工具列少了 {label}"
    # 分頁名稱不能撞名，不然使用者跟測試都會分不清
    assert "label={target === 'images' ? '畫質' : '紙張'}" in source


def test_edge_detection_ports_the_v5_scoring():
    """評分的權重是後端 22 個案例的基準測試磨出來的，憑感覺重寫只會退步。"""
    source = _strip_comments((JS / "scan-lite.js").read_text(encoding="utf-8"))
    assert "function scoreQuad(" in source
    # 凸性取代矩形度 —— v4 的矩形度會懲罰透視梯形，大角度拍攝時包圍盒反而贏
    assert "isConvex(quad) ? 1 : 0.35" in source
    assert "areaS * 0.35 + convexity * 0.25 + borderS * 0.2 + aspectS * 0.2" in source
    assert "geo * 0.4 + content * 0.6" in source
    # 最弱邊乘法門控：一條邊沒有影像證據就重罰，不管其他分數多高
    assert "(0.55 + 0.45 * edgeMin)" in source
    assert "function edgeSupport(" in source
    assert "Math.max(1.6 * gIn, 25)" in source, "少了「邊上 vs 內側」的梯度比較"

    # 硬性條件也要在：三條邊貼著畫面邊緣 = 整張照片被當成文件
    assert "function isValidQuad(" in source
    assert "touching >= 3" in source


def test_edge_detection_stays_honest_when_it_fails():
    """亂裁一通比不裁更糟 —— 使用者不會發現。"""
    source = _strip_comments((JS / "scan-lite.js").read_text(encoding="utf-8"))
    assert "MIN_CONFIDENCE = 0.45" in source, "信心門檻要跟後端一致"
    assert "method: 'fallback'" in source, "找不到時要明講是退回來的框"
    assert "confidence: 0," in source

    ui = (JS / "studio.jsx").read_text(encoding="utf-8")
    assert "function StudioDeskew(" in ui
    assert "沒把握" in ui, "低信心時要提醒使用者確認，不能默默裁下去"
    assert "MIN_CONFIDENCE" in ui


def test_perspective_correction_does_not_flip_or_stretch():
    """兩個只有靠內容方向 / 真實比例才驗得出來的坑。"""
    source = _strip_comments((JS / "scan-lite.js").read_text(encoding="utf-8"))
    # UNPACK_FLIP_Y 是關的，貼圖 t=0 就是第一列 —— 再翻一次輸出就上下顛倒，
    # 而且「線還是直的」，光看線直不直看不出來
    assert "UNPACK_FLIP_Y_WEBGL, false" in source
    assert "texture2D(u_img, uv)" in source, "多翻一次 y 的話輸出會上下顛倒"

    # 一張 canvas 只能有一種 context：直接回傳 WebGL 畫布的話，
    # 呼叫端的 getContext('2d') 會拿到 null，後面的合成整條斷掉
    assert "out.getContext('2d').drawImage(gl, 0, 0)" in source

    # 低階裝置拿不到 WebGL 時要有退路，而不是整個功能不能用
    assert "function warp2D(" in source

    # Zhang–He：不反推真實比例的話，斜拍的 A4 拉正後會系統性地被拉扁
    assert "function recoverAspect(" in source
    assert "0.75 * diag" in source, "一點透視時焦距不可觀測，要有假設焦距的退路"
    assert "function outputSize(" in source


def test_deskew_is_reversible():
    """拉正是破壞性的（換掉原圖），所以一定要留一條回得去的路。"""
    engine = _strip_comments((JS / "image-local.js").read_text(encoding="utf-8"))
    assert "function deskewItem(" in engine
    assert "function undoDeskew(" in engine
    # 只留第一次的原圖 —— 拉正兩次的話「還原」該回到最初，不是回到上一次
    assert "item.original || {" in engine
    # 拉正之後尺寸與內容都變了，原本的裁切框座標沒有意義
    assert "cropRect: null" in engine

    ui = (JS / "studio.jsx").read_text(encoding="utf-8")
    assert 'label="還原原圖"' in ui
    assert "SMImageLocal.undoDeskew(" in ui


def test_signatures_stay_vector_where_they_can():
    """手繪簽名存的是筆畫的點，不是像素 —— 放大不糊、蓋進 PDF 才是向量。"""
    source = _strip_comments((JS / "sign-lite.js").read_text(encoding="utf-8"))
    assert "function fromStrokes(" in source
    assert "function simplify(" in source, "沒有簡化，一枚簽名就會塞爆 localStorage"
    # PDF 沒有二次貝茲運算子，得換算成三次 —— 兩邊畫的必須是同一條線
    assert "quadraticCurveTo(" in source, "canvas 端沒有走曲線，筆跡會有稜角"
    assert "(2 / 3)" in source, "PDF 端沒有把二次貝茲換算成三次"
    assert "function walk(" in source, \
        "曲線邏輯要只有一份，canvas 與 PDF 各寫一套遲早會不一樣"
    # 手繪的那條路要輸出真正的路徑運算子（移動 / 曲線 / 描邊），
    # 不是偷偷畫成點陣圖再貼上去
    ops = source[source.index("function pdfOps("):]
    assert "if (sig.kind === 'image')" in ops, "點陣簽名要走影像那條路"
    assert "} m`" in ops and "} c`" in ops, "沒有輸出路徑運算子"
    assert "dotted ? 'f' : 'S'" in ops, "沒有描邊，路徑畫不出來"


def test_signature_stamps_land_where_the_user_put_them():
    """/Rotate 是檢視器轉的，內容串流的座標不會跟著轉 —— 沒補償就會蓋錯位置。"""
    source = _strip_comments((JS / "pdf-lite.js").read_text(encoding="utf-8"))
    assert "function displayMatrix(" in source
    for angle in ("0:", "90:", "180:", "270:"):
        assert angle in source, f"少了 {angle} 的變換"
    assert "async function applyStamps(" in source
    # MediaBox 的原點不一定是 (0, 0)
    assert "Math.min(box[0], box[2])" in source, "沒有處理 MediaBox 原點的位移"
    # 原本的內容可能留下改過的座標系，不包起來簽名會跑掉
    assert "streamOf('q\\n')" in source, "沒有把原本的內容包在 q…Q 裡"
    # Resources 常被好幾頁共用，直接改會改到別頁
    assert "new Map(asDict(resolveNew(copied.get('Resources'))))" in source


def test_signature_images_keep_their_transparency():
    """印章是不規則形狀，沒有 SMask 的話白底會把底下的字整個蓋掉。"""
    source = _strip_comments((JS / "pdf-lite.js").read_text(encoding="utf-8"))
    assert "async function addAlphaImage(" in source
    assert "'SMask'" in source, "沒有軟遮罩，透明就沒了"
    assert "'DeviceGray'" in source and "'DeviceRGB'" in source
    # 壓不動時要還能輸出，只是檔案大一點
    assert "if (packed) dict.set('Filter'" in source, "沒有 CompressionStream 時要能退回未壓縮"

    engine = _strip_comments((JS / "sign-lite.js").read_text(encoding="utf-8"))
    assert "function fromImage(" in engine
    # 用亮度當透明度：紅色關防的紅留得住，太淡的原子筆也能整個換成墨色
    assert "0.299" in engine, "沒有算亮度"
    assert "mode === 'ink'" in engine


def test_studio_wires_signatures_into_both_images_and_pdfs():
    source = (JS / "studio.jsx").read_text(encoding="utf-8")
    for name in ("function SignaturePad(", "function SignaturePlacer(", "function SignatureSheet("):
        assert name in source, f"少了 {name}"
    # 兩個分頁共用同一個簽名庫
    assert source.count("<SignaturePad") == 2, "編輯與頁面分頁都要能手寫簽名"
    assert source.count("<SignaturePlacer") == 2, "編輯與頁面分頁都要能擺放簽名"
    assert 'label="簽名"' in source
    # 存的是 id，簽名被刪掉時不該留下壞掉的圖層
    assert source.count("signatures.find((x) => x.id === s.sigId)") == 2
    # 擺放的背景不能含簽名，否則會看到兩份
    assert "{ ...composeOpts, signatures: null }" in source
    # PDF 頁面單獨畫大一點才對得準簽名欄的橫線
    assert "SMDocLocal.pdfPageImage(" in source
    assert "doc.bytes.slice()" in source, "沒有複製緩衝區，pdf.js 會把解析器腳下的位元組抽掉"


def test_studio_has_a_document_tab():
    source = (JS / "studio.jsx").read_text(encoding="utf-8")
    assert "function StudioDocs(" in source
    assert "文件" in source
    # 跟圖片編輯同一套規則：內容佔滿，選項收進工具列的面板
    assert "StudioSheet title=\"轉成什麼格式\"" in source
    assert "StudioSheet title=\"紙張設定\"" in source


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
