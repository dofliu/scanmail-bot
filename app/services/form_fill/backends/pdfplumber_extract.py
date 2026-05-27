"""Layer 2 — 可選取文字 PDF 欄位偵測（pdfplumber）

策略：
1. pdfplumber 抽出每頁文字（含座標）與表格框線
2. 啟發式配對：標籤右側 / 下方的「空白矩形」視為欄位
3. 信心度低於門檻時 needs_review=True，提示使用者手動微調

注意：pdfplumber 不在 requirements.txt 中時，is_available() 會回傳 False。
"""
import io
import logging
import re
from typing import Optional

from app.services.form_fill.schema import FormField, DetectionResult, Backend

logger = logging.getLogger(__name__)


def is_available() -> bool:
    try:
        import pdfplumber  # noqa: F401
        return True
    except ImportError:
        return False


def has_text_layer(data: bytes) -> bool:
    """快速判斷 PDF 是否含可選取文字"""
    if not is_available():
        # 退而求其次：用 pymupdf 判斷
        try:
            import fitz
            doc = fitz.open(stream=data, filetype="pdf")
            for page in doc:
                if page.get_text("text").strip():
                    doc.close()
                    return True
            doc.close()
            return False
        except Exception:
            return False

    import pdfplumber
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                if (page.extract_text() or "").strip():
                    return True
        return False
    except Exception as e:
        logger.debug("has_text_layer check failed: %s", e)
        return False


# 常見表單標籤的關鍵字（中文+英文），命中後旁邊的空白視為欄位
# 使用 \b word boundary 避免 "Subject" 卡到 "Sign-in Sheet / Subject" 之類的 header
_LABEL_KEYWORDS = (
    r"姓名|申請人|填表人|職稱|單位|部門|系所|學校|機關|"
    r"電話|手機|傳真|信箱|電子郵件|地址|"
    r"日期|時間|金額|統一編號|身分證|學號|"
    r"主旨|事由|備註|簽章|簽名|"
    r"Name|Title|Department|Email|Phone|Tel|Date|Address|Subject|Signature|"
    r"Destination|Amount|Purpose|Reason|Leave"
)
# 必須以「冒號 / 全形冒號」結尾才算欄位 label，避免抓到 header 文字
_LABEL_REGEX = re.compile(
    rf"^\s*({_LABEL_KEYWORDS})\s*[:：﹕]\s*$",
    re.IGNORECASE,
)
# 表格 cell 版本：cell 內常無冒號（如單獨一格寫「姓名」），故冒號可有可無，
# 但仍要求整格幾乎只有 label 文字，避免把長句誤判為欄位
_TABLE_LABEL_REGEX = re.compile(
    rf"^\s*({_LABEL_KEYWORDS})\s*[:：﹕]?\s*$",
    re.IGNORECASE,
)


def detect(data: bytes) -> DetectionResult:
    """從可選取文字的 PDF 偵測欄位"""
    if not is_available():
        return DetectionResult(
            backend_used=Backend.PDFPLUMBER,
            page_count=0,
            fields=[],
            needs_review=True,
            notes="pdfplumber 未安裝，請改用 AcroForm 或 OCR backend",
        )

    import pdfplumber

    fields: list[FormField] = []
    seen_keys: set = set()  # (page, label_lower, round(top, 0)) 去重
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        page_count = len(pdf.pages)
        for page_num, page in enumerate(pdf.pages):
            # 一次抓多個 word 拼起來，才能命中 "Leave Date:" 這種多字 label
            lines = _group_words_into_lines(page.extract_words(use_text_flow=True) or [])
            for line_words in lines:
                # 嘗試從第一個 word 開始往右串接，找出符合 _LABEL_REGEX 的 label
                for i in range(len(line_words)):
                    for j in range(i + 1, min(i + 5, len(line_words)) + 1):
                        chunk = " ".join(w["text"] for w in line_words[i:j])
                        m = _LABEL_REGEX.match(chunk)
                        if not m:
                            continue
                        label = m.group(1).strip()
                        # 去重 key
                        first_w = line_words[i]
                        last_w = line_words[j - 1]
                        key = (page_num, label.lower(), round(float(first_w["top"]), 0))
                        if key in seen_keys:
                            continue
                        seen_keys.add(key)

                        x1 = float(last_w["x1"])
                        y0 = float(first_w["top"])
                        y1 = float(last_w["bottom"])
                        ph = float(page.height)
                        bbox_pdf = (x1 + 4, ph - y1, x1 + 200, ph - y0)

                        fields.append(FormField(
                            name=f"p{page_num}_f{len(fields)}",
                            label=label,
                            field_type=_guess_type(label),
                            bbox=bbox_pdf,
                            page=page_num,
                            backend=Backend.PDFPLUMBER,
                            confidence=0.65,
                        ))
                        break  # 該起點已命中，跳到下一個 i

            # M4.5：表格式表單 — label 在某 cell、相鄰空白 cell 為填寫處
            _detect_table_fields(page, page_num, fields, seen_keys)

    logger.info("pdfplumber detected: %d candidate fields", len(fields))
    return DetectionResult(
        backend_used=Backend.PDFPLUMBER,
        page_count=page_count,
        fields=fields,
        needs_review=True,
        notes="啟發式偵測（必須有冒號的 label 才算），建議使用者確認欄位範圍",
    )


def _detect_table_fields(page, page_num: int, fields: list, seen_keys: set) -> None:
    """從表格 cell 偵測欄位（M4.5）

    啟發式：若某 cell 文字命中 label 關鍵字（整格幾乎只有 label），且其
    右側或下方相鄰 cell 為空，則把該空白 cell 視為填寫欄位。
    結果 in-place 併入 fields，並用 seen_keys 去重。
    """
    try:
        tables = page.find_tables()
    except Exception as e:
        logger.debug("find_tables failed on page %d: %s", page_num, e)
        return

    ph = float(page.height)

    for table in tables:
        try:
            text_grid = table.extract()
            rows = table.rows
        except Exception as e:
            logger.debug("table.extract failed: %s", e)
            continue

        for i, row in enumerate(rows):
            cells = row.cells  # list[bbox|None]，與 text_grid[i] 同欄位對齊
            text_row = text_grid[i] if i < len(text_grid) else []
            for j, cell_bbox in enumerate(cells):
                if cell_bbox is None:
                    continue
                text = (text_row[j] or "").strip() if j < len(text_row) else ""
                if not text or not _TABLE_LABEL_REGEX.match(text):
                    continue
                label = _TABLE_LABEL_REGEX.match(text).group(1).strip()

                target = _adjacent_blank_cell(rows, text_grid, i, j, cells)
                if target is None:
                    continue

                x0, top, x1, bottom = (float(v) for v in target)
                key = (page_num, label.lower(), round(top))
                if key in seen_keys:
                    continue
                seen_keys.add(key)

                fields.append(FormField(
                    name=f"p{page_num}_t{len(fields)}",
                    label=label,
                    field_type=_guess_type(label),
                    bbox=(x0, ph - bottom, x1, ph - top),
                    page=page_num,
                    backend=Backend.PDFPLUMBER,
                    confidence=0.6,
                ))


def _adjacent_blank_cell(rows, text_grid, i, j, cells):
    """回傳 label cell (i, j) 右側或下方的空白 cell bbox；都沒有則 None"""
    # 右側同列
    if j + 1 < len(cells) and cells[j + 1] is not None:
        text_row = text_grid[i] if i < len(text_grid) else []
        right_text = (text_row[j + 1] or "").strip() if j + 1 < len(text_row) else ""
        if not right_text:
            return cells[j + 1]
    # 下方同欄
    if i + 1 < len(rows):
        below_cells = rows[i + 1].cells
        below_text_row = text_grid[i + 1] if i + 1 < len(text_grid) else []
        if j < len(below_cells) and below_cells[j] is not None:
            below_text = (below_text_row[j] or "").strip() if j < len(below_text_row) else ""
            if not below_text:
                return below_cells[j]
    return None


def _group_words_into_lines(words: list, y_tolerance: float = 3.0) -> list[list]:
    """把 pdfplumber 的 word list 按 y 座標分群成行，並依 x 排序"""
    if not words:
        return []
    sorted_words = sorted(words, key=lambda w: (round(float(w["top"]) / y_tolerance), float(w["x0"])))
    lines: list[list] = []
    current_line: list = []
    current_y: Optional[float] = None
    for w in sorted_words:
        top = float(w["top"])
        if current_y is None or abs(top - current_y) <= y_tolerance:
            current_line.append(w)
            current_y = top if current_y is None else current_y
        else:
            lines.append(current_line)
            current_line = [w]
            current_y = top
    if current_line:
        lines.append(current_line)
    return lines


def _guess_type(label: str) -> str:
    if re.search(r"日期|Date|時間|Time", label, re.IGNORECASE):
        return "date"
    if re.search(r"金額|數量|編號|電話|手機", label):
        return "number"
    if re.search(r"簽章|簽名|Signature", label, re.IGNORECASE):
        return "signature"
    return "text"
