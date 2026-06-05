"""為 Auto Form Fill 產生各類型測試表單

產生的檔案會放在 tests/fixtures/forms/：
  1. acroform_application.pdf   - AcroForm 申請表（Layer 1 對象）
  2. flat_travel_expense.pdf    - 文字 PDF 差旅費報銷單（Layer 2 對象）
  3. flat_meeting_signin.pdf    - 文字 PDF 會議簽到表（Layer 2 對象）
  4. scanned_leave_form.png     - 影像式請假單（Layer 4 對象）
"""
import io
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import black, gray
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    NameObject, DictionaryObject, ArrayObject, NumberObject,
    BooleanObject, TextStringObject, IndirectObject,
)
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "fixtures" / "forms"
OUT.mkdir(parents=True, exist_ok=True)


# ════════════════════════════════════════════════════════════
# 1. AcroForm PDF — 用 reportlab 直接畫
# ════════════════════════════════════════════════════════════

def make_acroform():
    """建立帶 AcroForm 欄位的申請表 PDF"""
    path = OUT / "acroform_application.pdf"
    c = rl_canvas.Canvas(str(path), pagesize=A4)
    w, h = A4

    # 標題
    c.setFont("Helvetica-Bold", 18)
    c.drawString(50, h - 60, "Conference Attendance Application")
    c.setFont("Helvetica", 10)
    c.drawString(50, h - 80, "Please complete all fields below.")

    # AcroForm 欄位（reportlab 內建支援）
    form = c.acroForm

    fields = [
        ("applicant_name", "Applicant Name", h - 130),
        ("title",          "Job Title",       h - 170),
        ("department",     "Department",      h - 210),
        ("email",          "Email",           h - 250),
        ("phone",          "Phone",           h - 290),
        ("event_name",     "Conference",      h - 330),
        ("event_date",     "Date",            h - 370),
    ]

    for name, label, y in fields:
        c.setFont("Helvetica", 11)
        c.drawString(50, y, f"{label}:")
        form.textfield(
            name=name,
            tooltip=label,
            x=180, y=y - 5, width=300, height=22,
            borderColor=black, fillColor=gray, textColor=black,
            forceBorder=True, fontSize=11,
        )

    c.showPage()
    c.save()
    print(f"  [OK] {path.name}")
    return path


# ════════════════════════════════════════════════════════════
# 2. 文字 PDF — 差旅費報銷單
# ════════════════════════════════════════════════════════════

def make_flat_travel_expense():
    path = OUT / "flat_travel_expense.pdf"
    c = rl_canvas.Canvas(str(path), pagesize=A4)
    w, h = A4

    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, h - 60, "Travel Expense Reimbursement Form")
    c.setFont("Helvetica", 10)
    c.drawString(50, h - 80, "Please fill in the blanks.")

    rows = [
        ("Name:",        h - 130),
        ("Title:",       h - 170),
        ("Department:",  h - 210),
        ("Email:",       h - 250),
        ("Phone:",       h - 290),
        ("Date:",        h - 330),
        ("Destination:", h - 370),
        ("Amount:",      h - 410),
        ("Purpose:",     h - 450),
    ]
    for label, y in rows:
        c.setFont("Helvetica", 11)
        c.drawString(50, y, label)
        c.setStrokeColor(black)
        c.line(160, y - 2, 500, y - 2)

    c.setFont("Helvetica", 10)
    c.drawString(50, h - 510, "Signature:")
    c.line(160, h - 512, 350, h - 512)

    c.showPage()
    c.save()
    print(f"  [OK] {path.name}")
    return path


# ════════════════════════════════════════════════════════════
# 3. 文字 PDF — 中文表單（會議簽到表）
# ════════════════════════════════════════════════════════════

def make_flat_meeting_signin():
    path = OUT / "flat_meeting_signin.pdf"
    c = rl_canvas.Canvas(str(path), pagesize=A4)
    w, h = A4

    # 沒有中文字型也能跑 — 用英文 label，但模擬常見中英混合場景
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, h - 60, "Meeting Sign-in Sheet / Subject")
    c.setFont("Helvetica", 10)
    c.drawString(50, h - 80, "Please write your information below.")

    rows = [
        ("Subject:",      h - 130),
        ("Date:",         h - 170),
        ("Name:",         h - 220),
        ("Department:",   h - 260),
        ("Title:",        h - 300),
        ("Email:",        h - 340),
        ("Phone:",        h - 380),
        ("Signature:",    h - 440),
    ]
    for label, y in rows:
        c.setFont("Helvetica", 11)
        c.drawString(50, y, label)
        c.line(150, y - 2, 500, y - 2)

    c.showPage()
    c.save()
    print(f"  [OK] {path.name}")
    return path


# ════════════════════════════════════════════════════════════
# 4. 掃描型表單影像 — 模擬手機拍的紙本
# ════════════════════════════════════════════════════════════

def make_scanned_image():
    path = OUT / "scanned_leave_form.png"
    W, H = 1240, 1754  # ~A4 @ 150dpi
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    try:
        font_t = ImageFont.truetype("DejaVuSans-Bold.ttf", 32)
        font_b = ImageFont.truetype("DejaVuSans.ttf", 22)
    except Exception:
        font_t = ImageFont.load_default()
        font_b = ImageFont.load_default()

    draw.text((80, 80), "Leave Application Form", fill="black", font=font_t)
    draw.text((80, 130), "Please fill in your information below.", fill="black", font=font_b)

    rows = [
        ("Name:",        220),
        ("Title:",       290),
        ("Department:",  360),
        ("Email:",       430),
        ("Phone:",       500),
        ("Leave Date:",  570),
        ("Reason:",      640),
        ("Signature:",   780),
    ]
    for label, y in rows:
        draw.text((80, y), label, fill="black", font=font_b)
        draw.line([(280, y + 30), (1100, y + 30)], fill="black", width=2)

    # 故意加一點掃描雜訊（淡灰色斜線）
    for x in range(0, W, 40):
        draw.line([(x, 0), (x + 30, H)], fill=(245, 245, 245), width=1)

    img.save(path, "PNG")
    print(f"  [OK] {path.name}")
    return path


# ════════════════════════════════════════════════════════════
# 5. 表格式表單 — label 在 cell、相鄰空白 cell 為填寫處（Layer 2 M4.5 對象）
# ════════════════════════════════════════════════════════════

def make_table_form():
    """建立以表格框線排版的表單（cell-based），測試 M4.5 表格偵測。

    用英文 label（reportlab 內建字型無法渲染中文），且 label 皆命中
    pdfplumber_extract._LABEL_KEYWORDS，每個 label cell 右側留空白 cell。
    """
    path = OUT / "table_visit_form.pdf"
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(str(path), pagesize=A4,
                            topMargin=25 * mm, leftMargin=20 * mm)

    title = Paragraph("Student Home Visit Form", styles["Title"])

    # 4 欄：label | value(blank) | label | value(blank)
    data = [
        ["Name", "", "Title", ""],
        ["Department", "", "Email", ""],
        ["Phone", "", "Date", ""],
        ["Address", "", "Purpose", ""],
    ]
    col_w = [35 * mm, 50 * mm, 35 * mm, 50 * mm]
    table = Table(data, colWidths=col_w, rowHeights=14 * mm)
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.6, black),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))

    doc.build([title, table])
    print(f"  [OK] {path.name}")
    return path


def main():
    print("Generating test forms...")
    make_acroform()
    make_flat_travel_expense()
    make_flat_meeting_signin()
    make_scanned_image()
    make_table_form()
    print(f"\nAll fixtures saved to: {OUT}")


if __name__ == "__main__":
    main()
