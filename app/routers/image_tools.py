"""圖片工具路由 — 批次縮放、格式轉換、壓縮、浮水印"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.core.tasks import submit_task, get_task, task_progress_stream
from app.core.file_manager import save_temp_file, make_thumbnail
from app.services.image_batch import (
    resize_image, batch_resize,
    convert_format, batch_convert,
    compress_image, batch_compress,
    add_text_watermark, batch_watermark,
    merge_images,
    get_image_info_detail,
    SUPPORTED_FORMATS, FORMAT_MAP,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# 最大上傳數
MAX_FILES = 50
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB per file


def _validate_files(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    """驗證並讀取上傳檔案"""
    if not files:
        raise HTTPException(status_code=400, detail="請上傳至少一個檔案")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"最多上傳 {MAX_FILES} 個檔案")

    results = []
    for f in files:
        ext = (f.filename or "").rsplit(".", 1)[-1].lower()
        if ext not in SUPPORTED_FORMATS:
            continue  # 跳過不支援的格式
    return results  # placeholder, actual reading is async


async def _read_files(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    """非同步讀取並驗證上傳檔案"""
    if not files:
        raise HTTPException(status_code=400, detail="請上傳至少一個檔案")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"最多上傳 {MAX_FILES} 個檔案")

    results = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_FILE_SIZE:
            continue  # 跳過過大的檔案
        name = f.filename or f"image_{len(results)}"
        results.append((name, data))

    if not results:
        raise HTTPException(status_code=400, detail="沒有有效的圖片檔案")
    return results


# ── 單檔快速處理（直接回傳結果）──

@router.post("/resize")
async def api_resize(
    file: UploadFile = File(...),
    width: int = Form(800),
    height: int = Form(600),
    mode: str = Form("fit"),
    bg_color: str = Form("#ffffff"),
    output_format: str = Form("JPEG"),
    quality: int = Form(85),
):
    """縮放單張圖片"""
    data = await file.read()
    result = resize_image(data, width, height, mode, bg_color, output_format, quality)
    media_type = "image/jpeg" if output_format == "JPEG" else f"image/{output_format.lower()}"
    return Response(content=result, media_type=media_type,
                    headers={"Content-Disposition": f"attachment; filename=resized.{output_format.lower()}"})


@router.post("/convert")
async def api_convert(
    file: UploadFile = File(...),
    target_format: str = Form("PNG"),
    quality: int = Form(85),
):
    """轉換單張圖片格式"""
    data = await file.read()
    fmt = FORMAT_MAP.get(target_format.lower(), target_format.upper())
    result = convert_format(data, fmt, quality)
    ext = target_format.lower()
    if ext == "jpeg":
        ext = "jpg"
    return Response(content=result, media_type=f"image/{ext}",
                    headers={"Content-Disposition": f"attachment; filename=converted.{ext}"})


@router.post("/compress")
async def api_compress(
    file: UploadFile = File(...),
    quality: int = Form(70),
    max_dimension: int = Form(0),
):
    """壓縮單張圖片"""
    data = await file.read()
    result = compress_image(data, quality, max_dimension)
    return Response(content=result, media_type="image/jpeg",
                    headers={"Content-Disposition": "attachment; filename=compressed.jpg"})


@router.post("/watermark")
async def api_watermark(
    file: UploadFile = File(...),
    text: str = Form("CONFIDENTIAL"),
    font_size: int = Form(36),
    opacity: int = Form(80),
    position: str = Form("center"),
    color: str = Form("#000000"),
):
    """加文字浮水印到單張圖片"""
    data = await file.read()
    result = add_text_watermark(data, text, font_size, opacity, position, color)
    return Response(content=result, media_type="image/jpeg",
                    headers={"Content-Disposition": "attachment; filename=watermarked.jpg"})


@router.post("/info")
async def api_info(file: UploadFile = File(...)):
    """取得圖片資訊"""
    data = await file.read()
    return get_image_info_detail(data)


# ── 批次處理（背景任務 + SSE 進度）──

@router.post("/batch/resize")
async def api_batch_resize(
    files: list[UploadFile] = File(...),
    width: int = Form(800),
    height: int = Form(600),
    mode: str = Form("fit"),
    bg_color: str = Form("#ffffff"),
    output_format: str = Form("JPEG"),
    quality: int = Form(85),
):
    """批次縮放 → 回傳 task_id"""
    images = await _read_files(files)
    task_id = submit_task(
        batch_resize, images, width, height, mode, bg_color, output_format, quality
    )
    return {"task_id": task_id}


@router.post("/batch/convert")
async def api_batch_convert(
    files: list[UploadFile] = File(...),
    target_format: str = Form("PNG"),
    quality: int = Form(85),
):
    """批次轉檔 → 回傳 task_id"""
    images = await _read_files(files)
    fmt = FORMAT_MAP.get(target_format.lower(), target_format.upper())
    task_id = submit_task(batch_convert, images, fmt, quality)
    return {"task_id": task_id}


@router.post("/batch/compress")
async def api_batch_compress(
    files: list[UploadFile] = File(...),
    quality: int = Form(70),
    max_dimension: int = Form(0),
):
    """批次壓縮 → 回傳 task_id"""
    images = await _read_files(files)
    task_id = submit_task(batch_compress, images, quality, max_dimension)
    return {"task_id": task_id}


@router.post("/batch/watermark")
async def api_batch_watermark(
    files: list[UploadFile] = File(...),
    text: str = Form("CONFIDENTIAL"),
    font_size: int = Form(36),
    opacity: int = Form(80),
    position: str = Form("center"),
    color: str = Form("#000000"),
):
    """批次浮水印 → 回傳 task_id"""
    images = await _read_files(files)
    task_id = submit_task(
        batch_watermark, images, text, font_size, opacity, position, color
    )
    return {"task_id": task_id}


# ── 拼接（多張 → 單張）──

@router.post("/merge")
async def api_merge(
    files: list[UploadFile] = File(...),
    direction: str = Form("vertical"),    # vertical | horizontal | grid
    gap: int = Form(0),
    bg_color: str = Form("#ffffff"),
    align: str = Form("center"),          # start | center | end
    output_format: str = Form("JPEG"),    # JPEG | PNG | WEBP
    quality: int = Form(90),
    columns: int = Form(0),               # grid 模式欄數，0=自動
    normalize: bool = Form(True),
):
    """拼接多張圖片成單張 → 回傳 task_id

    使用 /task/{task_id}/progress 監聽進度，
    /merge/result/{task_id}?format=jpeg 下載結果。
    """
    if not files or len(files) < 2:
        raise HTTPException(status_code=400, detail="至少需要 2 張圖片")
    images = await _read_files(files)
    if len(images) < 2:
        raise HTTPException(status_code=400, detail="有效圖片少於 2 張")
    task_id = submit_task(
        merge_images, images,
        direction, gap, bg_color, align,
        output_format, quality, columns, normalize,
    )
    return {"task_id": task_id, "output_format": output_format}


@router.get("/merge/result/{task_id}")
async def api_merge_download(task_id: str, format: str = "jpeg"):
    """下載拼接結果（單張圖片，非 ZIP）"""
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任務不存在")
    if task.status.value != "completed":
        raise HTTPException(status_code=400, detail=f"任務狀態: {task.status.value}")
    if not task.result or not isinstance(task.result, bytes):
        raise HTTPException(status_code=500, detail="任務結果無效")

    fmt = (format or "jpeg").lower()
    if fmt in ("jpg", "jpeg"):
        ext, media = "jpg", "image/jpeg"
    elif fmt == "png":
        ext, media = "png", "image/png"
    elif fmt == "webp":
        ext, media = "webp", "image/webp"
    elif fmt == "bmp":
        ext, media = "bmp", "image/bmp"
    else:
        ext, media = "jpg", "image/jpeg"

    return Response(
        content=task.result, media_type=media,
        headers={"Content-Disposition": f"attachment; filename=merged_{task_id}.{ext}"},
    )


# ── 任務進度 + 下載 ──

@router.get("/task/{task_id}/progress")
async def api_task_progress(task_id: str):
    """SSE 串流：即時任務進度"""
    return StreamingResponse(
        task_progress_stream(task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/task/{task_id}/download")
async def api_task_download(task_id: str):
    """下載任務結果（ZIP）"""
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任務不存在")
    if task.status.value != "completed":
        raise HTTPException(status_code=400, detail=f"任務狀態: {task.status.value}")
    if not task.result or not isinstance(task.result, bytes):
        raise HTTPException(status_code=500, detail="任務結果無效")

    return Response(
        content=task.result,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=batch_result_{task_id}.zip"},
    )
