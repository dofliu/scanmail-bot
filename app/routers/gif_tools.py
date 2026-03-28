"""GIF 工具路由 — 圖片序列轉動畫 GIF"""
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse

from app.core.tasks import submit_task, get_task, task_progress_stream
from app.services.gif_creator import create_gif_from_images

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/create")
async def api_create_gif(
    files: list[UploadFile] = File(...),
    duration_ms: int = Form(500),
    loop: int = Form(0),
    resize_width: int = Form(0),
    resize_height: int = Form(0),
    resize_mode: str = Form("fit"),
):
    """從圖片序列建立 GIF（背景任務）"""
    if len(files) < 2:
        raise HTTPException(status_code=400, detail="至少需要 2 張圖片")

    images = []
    for f in files:
        data = await f.read()
        images.append((f.filename or f"frame_{len(images)}.jpg", data))

    task_id = submit_task(
        create_gif_from_images, images, duration_ms, loop,
        resize_width, resize_height, resize_mode,
    )
    return {"task_id": task_id}


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
    return Response(content=task.result, media_type="image/gif",
                    headers={"Content-Disposition": f"attachment; filename=animation_{task_id}.gif"})
