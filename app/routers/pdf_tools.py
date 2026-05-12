"""PDF 工具路由 — 合併、浮水印、密碼保護"""
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse

from app.core.tasks import submit_task, get_task, task_progress_stream
from app.services.pdf_processor import (
    merge_pdfs, add_text_watermark_to_pdf, add_image_watermark_to_pdf,
    protect_pdf, get_pdf_info,
    split_pdf, compress_pdf, pdf_to_images,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/merge")
async def api_merge_pdfs(
    files: list[UploadFile] = File(...),
    add_toc: bool = Form(False),
    add_page_numbers: bool = Form(False),
):
    """合併多個 PDF（背景任務）"""
    if len(files) < 2:
        raise HTTPException(status_code=400, detail="至少需要 2 個 PDF 檔案")

    pdfs = []
    for f in files:
        data = await f.read()
        pdfs.append((f.filename or f"doc_{len(pdfs)}.pdf", data))

    task_id = submit_task(merge_pdfs, pdfs, None, add_toc, add_page_numbers)
    return {"task_id": task_id}


@router.post("/split")
async def api_split_pdf(
    file: UploadFile = File(...),
    ranges: str = Form(""),
    individual: bool = Form(False),
):
    """分割 PDF — 依範圍切成多份，產出 ZIP（背景任務）

    ranges 範例：`"1-3,5,7-9"`。
    individual=True 時忽略 ranges，每頁拆成獨立檔。
    """
    data = await file.read()
    task_id = submit_task(split_pdf, data, ranges, individual)
    return {"task_id": task_id}


@router.post("/compress")
async def api_compress_pdf(
    file: UploadFile = File(...),
    level: str = Form("basic"),
    image_quality: int = Form(60),
):
    """壓縮 PDF（背景任務）

    level: `basic` | `images` | `deep`
    image_quality: 1-95（僅 images / deep 模式生效）
    """
    if level not in ("basic", "images", "deep"):
        raise HTTPException(status_code=400, detail="level 必須是 basic / images / deep")
    data = await file.read()
    task_id = submit_task(compress_pdf, data, level, image_quality)
    return {"task_id": task_id}


@router.post("/to-images")
async def api_pdf_to_images(
    file: UploadFile = File(...),
    fmt: str = Form("png"),
    dpi: int = Form(150),
):
    """PDF → 影像，每頁一張，產出 ZIP（背景任務）

    fmt: `png` | `jpg`
    dpi: 72–300 建議範圍
    """
    if fmt.lower() not in ("png", "jpg", "jpeg"):
        raise HTTPException(status_code=400, detail="fmt 必須是 png 或 jpg")
    if not (50 <= dpi <= 600):
        raise HTTPException(status_code=400, detail="dpi 必須在 50–600")
    data = await file.read()
    task_id = submit_task(pdf_to_images, data, fmt, dpi)
    return {"task_id": task_id}


@router.post("/watermark/text")
async def api_text_watermark(
    file: UploadFile = File(...),
    text: str = Form("CONFIDENTIAL"),
    font_size: int = Form(48),
    opacity: float = Form(0.15),
    rotation: int = Form(45),
    color_r: int = Form(0),
    color_g: int = Form(0),
    color_b: int = Form(0),
):
    """對 PDF 加文字浮水印"""
    data = await file.read()
    result = add_text_watermark_to_pdf(
        data, text, font_size, opacity, rotation, (color_r, color_g, color_b)
    )
    return Response(content=result, media_type="application/pdf",
                    headers={"Content-Disposition": "attachment; filename=watermarked.pdf"})


@router.post("/watermark/image")
async def api_image_watermark(
    file: UploadFile = File(...),
    watermark: UploadFile = File(...),
    opacity: float = Form(0.3),
    scale: float = Form(0.4),
    position: str = Form("center"),
):
    """對 PDF 加圖片浮水印"""
    pdf_data = await file.read()
    wm_data = await watermark.read()
    result = add_image_watermark_to_pdf(pdf_data, wm_data, opacity, scale, position)
    return Response(content=result, media_type="application/pdf",
                    headers={"Content-Disposition": "attachment; filename=watermarked.pdf"})


@router.post("/protect")
async def api_protect_pdf(
    file: UploadFile = File(...),
    password: str = Form(...),
):
    """為 PDF 加上密碼保護"""
    if not password or len(password) < 1:
        raise HTTPException(status_code=400, detail="請輸入密碼")
    data = await file.read()
    result = protect_pdf(data, password)
    return Response(content=result, media_type="application/pdf",
                    headers={"Content-Disposition": "attachment; filename=protected.pdf"})


@router.post("/info")
async def api_pdf_info(file: UploadFile = File(...)):
    """取得 PDF 資訊"""
    data = await file.read()
    return get_pdf_info(data)


# ── 任務進度 + 下載 ──

@router.get("/task/{task_id}/progress")
async def api_task_progress(task_id: str):
    return StreamingResponse(
        task_progress_stream(task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/task/{task_id}/download")
async def api_task_download(task_id: str):
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任務不存在")
    if task.status.value != "completed":
        raise HTTPException(status_code=400, detail=f"任務狀態: {task.status.value}")
    if not task.result or not isinstance(task.result, bytes):
        raise HTTPException(status_code=500, detail="任務結果無效")
    # 依 magic bytes 判斷 ZIP / PDF（split + to-images 回 ZIP，其他回 PDF）
    if task.result[:2] == b"PK":
        media_type = "application/zip"
        filename = f"result_{task_id}.zip"
    else:
        media_type = "application/pdf"
        filename = f"result_{task_id}.pdf"
    return Response(content=task.result, media_type=media_type,
                    headers={"Content-Disposition": f"attachment; filename={filename}"})
