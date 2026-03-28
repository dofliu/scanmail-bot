"""文件格式轉換 — Word⟷PDF、Markdown⟷PDF/Word

純 Python 實作，不依賴 LibreOffice。
"""
import io
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════
# 1. Word → PDF
# ══════════════════════════════════════════════════════════════

def word_to_pdf(docx_data: bytes) -> bytes:
    """將 DOCX 轉為 PDF

    使用 pymupdf 的 Document 支援 + python-docx 提取內容後
    透過 ReportLab 渲染為 PDF。
    """
    from docx import Document
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_CENTER
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # 嘗試註冊中文字型
    _register_cjk_font()

    doc = Document(io.BytesIO(docx_data))
    buf = io.BytesIO()

    pdf = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=25*mm, rightMargin=25*mm,
                            topMargin=20*mm, bottomMargin=20*mm)

    styles = getSampleStyleSheet()
    # 建立支援中文的樣式
    body_font = _get_available_font()
    body_style = ParagraphStyle(
        "CJKBody", parent=styles["Normal"],
        fontName=body_font, fontSize=11, leading=18,
    )
    heading_style = ParagraphStyle(
        "CJKHeading", parent=styles["Heading1"],
        fontName=body_font, fontSize=16, leading=24,
        spaceAfter=12,
    )

    story = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            story.append(Spacer(1, 6))
            continue

        # 簡單判斷是否為標題
        if para.style and para.style.name and "Heading" in para.style.name:
            story.append(Paragraph(_escape_xml(text), heading_style))
        else:
            story.append(Paragraph(_escape_xml(text), body_style))

    if not story:
        story.append(Paragraph("(空白文件)", body_style))

    pdf.build(story)
    result = buf.getvalue()
    logger.info("Word → PDF 完成: %d bytes", len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 2. PDF → Word
# ══════════════════════════════════════════════════════════════

def pdf_to_word(pdf_data: bytes) -> bytes:
    """將 PDF 轉為 DOCX（提取文字內容）"""
    import fitz  # pymupdf
    from docx import Document
    from docx.shared import Pt

    pdf_doc = fitz.open(stream=pdf_data, filetype="pdf")
    word_doc = Document()

    for i, page in enumerate(pdf_doc):
        if i > 0:
            word_doc.add_page_break()

        text = page.get_text("text")
        for line in text.split("\n"):
            line = line.strip()
            if line:
                p = word_doc.add_paragraph(line)
                p.style.font.size = Pt(11)

    buf = io.BytesIO()
    word_doc.save(buf)
    result = buf.getvalue()
    logger.info("PDF → Word 完成: %d 頁, %d bytes", len(pdf_doc), len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 3. Markdown → PDF
# ══════════════════════════════════════════════════════════════

def markdown_to_pdf(md_text: str) -> bytes:
    """將 Markdown 轉為 PDF"""
    import markdown
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    _register_cjk_font()
    body_font = _get_available_font()

    # Markdown → HTML
    html = markdown.markdown(md_text, extensions=["tables", "fenced_code"])

    # HTML → 簡單文字段落（用 BeautifulSoup 提取）
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")

    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=25*mm, rightMargin=25*mm,
                            topMargin=20*mm, bottomMargin=20*mm)

    styles = getSampleStyleSheet()
    body_style = ParagraphStyle("MDBody", parent=styles["Normal"],
                                fontName=body_font, fontSize=11, leading=18)
    h1_style = ParagraphStyle("MDH1", parent=styles["Heading1"],
                              fontName=body_font, fontSize=20, leading=28, spaceAfter=12)
    h2_style = ParagraphStyle("MDH2", parent=styles["Heading2"],
                              fontName=body_font, fontSize=16, leading=22, spaceAfter=10)
    code_style = ParagraphStyle("MDCode", parent=styles["Code"],
                                fontName="Courier", fontSize=9, leading=12,
                                leftIndent=20, spaceAfter=8)

    story = []
    for element in soup.children:
        tag = getattr(element, "name", None)
        text = element.get_text(strip=True) if hasattr(element, "get_text") else str(element).strip()
        if not text:
            continue

        if tag == "h1":
            story.append(Paragraph(_escape_xml(text), h1_style))
        elif tag == "h2":
            story.append(Paragraph(_escape_xml(text), h2_style))
        elif tag in ("h3", "h4", "h5", "h6"):
            story.append(Paragraph(_escape_xml(text), h2_style))
        elif tag in ("pre", "code"):
            story.append(Paragraph(_escape_xml(text), code_style))
        elif tag:
            story.append(Paragraph(_escape_xml(text), body_style))
        else:
            if text:
                story.append(Paragraph(_escape_xml(text), body_style))

    if not story:
        story.append(Paragraph("(空白文件)", body_style))

    pdf.build(story)
    result = buf.getvalue()
    logger.info("Markdown → PDF 完成: %d bytes", len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 4. Markdown → Word
# ══════════════════════════════════════════════════════════════

def markdown_to_word(md_text: str) -> bytes:
    """將 Markdown 轉為 DOCX"""
    import markdown
    from bs4 import BeautifulSoup
    from docx import Document
    from docx.shared import Pt

    html = markdown.markdown(md_text, extensions=["tables", "fenced_code"])
    soup = BeautifulSoup(html, "html.parser")

    doc = Document()

    for element in soup.children:
        tag = getattr(element, "name", None)
        text = element.get_text(strip=True) if hasattr(element, "get_text") else str(element).strip()
        if not text:
            continue

        if tag == "h1":
            doc.add_heading(text, level=1)
        elif tag == "h2":
            doc.add_heading(text, level=2)
        elif tag in ("h3", "h4", "h5", "h6"):
            doc.add_heading(text, level=3)
        elif tag in ("ul", "ol"):
            for li in element.find_all("li"):
                li_text = li.get_text(strip=True)
                if li_text:
                    doc.add_paragraph(li_text, style="List Bullet")
        elif tag in ("pre", "code"):
            p = doc.add_paragraph(text)
            p.style.font.size = Pt(9)
            p.style.font.name = "Courier New"
        else:
            doc.add_paragraph(text)

    buf = io.BytesIO()
    doc.save(buf)
    result = buf.getvalue()
    logger.info("Markdown → Word 完成: %d bytes", len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 5. Word → Markdown
# ══════════════════════════════════════════════════════════════

def word_to_markdown(docx_data: bytes) -> str:
    """將 DOCX 轉為 Markdown 文字"""
    from docx import Document

    doc = Document(io.BytesIO(docx_data))
    lines = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            lines.append("")
            continue

        style_name = para.style.name if para.style else ""

        if "Heading 1" in style_name:
            lines.append(f"# {text}")
        elif "Heading 2" in style_name:
            lines.append(f"## {text}")
        elif "Heading 3" in style_name:
            lines.append(f"### {text}")
        elif "List" in style_name:
            lines.append(f"- {text}")
        else:
            lines.append(text)

    result = "\n\n".join(lines)
    logger.info("Word → Markdown 完成: %d chars", len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 共用工具
# ══════════════════════════════════════════════════════════════

def _escape_xml(text: str) -> str:
    """轉義 XML 特殊字元（ReportLab Paragraph 需要）"""
    return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))


_cjk_registered = False

def _register_cjk_font():
    """嘗試註冊系統中的 CJK 字型"""
    global _cjk_registered
    if _cjk_registered:
        return

    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # 嘗試常見的中文字型路徑
    font_paths = [
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]

    for path in font_paths:
        try:
            pdfmetrics.registerFont(TTFont("CJKFont", path))
            _cjk_registered = True
            logger.info("已註冊 CJK 字型: %s", path)
            return
        except Exception:
            continue

    _cjk_registered = True  # 標記為已嘗試，避免重複


def _get_available_font() -> str:
    """取得可用的字型名稱"""
    from reportlab.pdfbase import pdfmetrics
    if "CJKFont" in pdfmetrics.getRegisteredFontNames():
        return "CJKFont"
    return "Helvetica"
