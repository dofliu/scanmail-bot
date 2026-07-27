#!/usr/bin/env python3
"""產生 PDF 頁面操作的測試素材。

自己產、自己讀的測試驗不出「只認得自己的寫法」這種問題，所以這裡用 pikepdf
（背後是 qpdf）產出兩種結構明顯不同的 PDF：

  pages-a.pdf  傳統 xref 表、物件各自獨立、MediaBox 寫在每一頁上
  pages-b.pdf  xref 串流 + 物件串流（PDF 1.5 之後的寫法），
               而且 MediaBox 只寫在 Pages 節點上 —— 逼解析器處理屬性繼承

執行：pip install pikepdf && python mobile/test/fixtures/make_fixtures.py
"""
from pathlib import Path

import pikepdf

HERE = Path(__file__).resolve().parent


def text_page(pdf, label, width=612, height=792, rotate=0):
    font = pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica,
    ))
    page = pikepdf.Dictionary(
        Type=pikepdf.Name.Page,
        Resources=pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font)),
        Contents=pdf.make_stream(
            f"BT /F1 28 Tf 60 {height - 90} Td ({label}) Tj ET".encode("ascii")
        ),
    )
    if rotate:
        page.Rotate = rotate
    return page, width, height


def build_a() -> None:
    """傳統寫法：MediaBox 在每一頁上，尺寸與方向都不一樣。"""
    pdf = pikepdf.new()
    specs = [("PAGE-A1", 612, 792, 0), ("PAGE-A2", 842, 595, 0), ("PAGE-A3", 612, 792, 90)]
    for label, w, h, rot in specs:
        page, w, h = text_page(pdf, label, w, h, rot)
        page.MediaBox = [0, 0, w, h]
        pdf.pages.append(pikepdf.Page(pdf.make_indirect(page)))
    pdf.save(HERE / "pages-a.pdf")


def build_b() -> None:
    """現代寫法：xref 串流 + 物件串流，而且 MediaBox 只寫在 Pages 節點。"""
    pdf = pikepdf.new()
    for label in ("PAGE-B1", "PAGE-B2"):
        page, _, _ = text_page(pdf, label, 595, 842)
        page.MediaBox = [0, 0, 595, 842]
        pdf.pages.append(pikepdf.Page(pdf.make_indirect(page)))
    # 把 MediaBox 從每一頁搬到共同的父節點，測試屬性繼承
    root = pdf.Root.Pages
    for page in pdf.pages:
        if "/MediaBox" in page:
            del page["/MediaBox"]
    root.MediaBox = [0, 0, 595, 842]
    pdf.save(
        HERE / "pages-b.pdf",
        object_stream_mode=pikepdf.ObjectStreamMode.generate,
        compress_streams=True,
    )


def build_locked() -> None:
    """加密的 PDF —— 應該要被明確拒絕，而不是產出壞掉的檔案。"""
    pdf = pikepdf.new()
    page, _, _ = text_page(pdf, "LOCKED", 612, 792)
    page.MediaBox = [0, 0, 612, 792]
    pdf.pages.append(pikepdf.Page(pdf.make_indirect(page)))
    pdf.save(HERE / "pages-locked.pdf", encryption=pikepdf.Encryption(owner="x", user=""))


def build_incremental() -> None:
    """增量更新：在原檔後面追加一個改過的頁面物件與新的 xref 段。

    這是真實世界最常見的形狀之一 —— 只要 PDF 被註解過、簽過名，就長這樣。
    解析器必須沿著 /Prev 往回走，而且「後面出現的覆蓋前面的」。
    這裡把第 2 頁轉成 180 度，讀出來是 180 才算走對了。
    """
    base = (HERE / "pages-a.pdf").read_bytes()
    with pikepdf.open(HERE / "pages-a.pdf") as pdf:
        num, _gen = pdf.pages[1].obj.objgen
        size = int(pdf.trailer.Size)
        root = pdf.Root.objgen[0]
    prev = int(base.rsplit(b"startxref", 1)[1].split()[0])

    body = base + b"\n"
    at = len(body)
    body += (
        f"{num} 0 obj\n<< /Type /Page /MediaBox [0 0 842 595] /Rotate 180 "
        f"/Resources << /Font << /F1 {num + 1} 0 R >> >> /Contents {num - 1} 0 R >>\nendobj\n"
    ).encode("ascii")
    xref_at = len(body)
    body += (
        f"xref\n{num} 1\n{at:010d} 00000 n \n"
        f"trailer\n<< /Size {size} /Root {root} 0 R /Prev {prev} >>\n"
        f"startxref\n{xref_at}\n%%EOF\n"
    ).encode("ascii")
    (HERE / "pages-incremental.pdf").write_bytes(body)


def main() -> None:
    build_a()
    build_b()
    build_locked()
    build_incremental()
    for name in ("pages-a.pdf", "pages-b.pdf", "pages-locked.pdf", "pages-incremental.pdf"):
        path = HERE / name
        with pikepdf.open(path) as pdf:
            data = path.read_bytes()
            kind = "xref 串流" if b"/ObjStm" in data else "加密" if b"/Encrypt" in data else "傳統 xref"
            print(f"✓ {name}  {len(pdf.pages)} 頁  {path.stat().st_size} bytes  ({kind})")


if __name__ == "__main__":
    main()
