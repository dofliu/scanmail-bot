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

from app.services.form_fill.schema import FormField, DetectionResult

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


def detect(data: bytes) -> DetectionResult:
    """從可選取文字的 PDF 偵測欄位"""
    if not is_available():
        return DetectionResult(
            backend_used="pdfplumber",
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
                            backend="pdfplumber",
                            confidence=0.65,
                        ))
                        break  # 該起點已命中，跳到下一個 i

    logger.info("pdfplumber detected: %d candidate fields", len(fields))
    return DetectionResult(
        backend_used="pdfplumber",
        page_count=page_count,
        fields=fields,
        needs_review=True,
        notes="啟發式偵測（必須有冒號的 label 才算），建議使用者確認欄位範圍",
    )


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
