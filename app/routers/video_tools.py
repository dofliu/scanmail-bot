"""影片工具路由 — 合併、轉 GIF、壓縮"""
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse

from app.core.tasks import submit_task, get_task, task_progress_stream
from app.services.video_processor import merge_videos, video_to_gif, compress_video

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_VIDEO_SIZE = 200 * 1024 * 1024  # 200MB per file


@router.post("/merge")
async def api_merge_videos(
    files: list[UploadFile] = File(...),
    output_format: str = Form("mp4"),
):
    """合併多個影片（背景任務）"""
    if len(files) < 2:
        raise HTTPException(status_code=400, detail="至少需要 2 個影片")

    videos = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_VIDEO_SIZE:
            raise HTTPException(status_code=400, detail=f"檔案 {f.filename} 超過 200MB 上限")
        videos.append((f.filename or f"video_{len(videos)}.mp4", data))

    task_id = submit_task(merge_videos, videos, output_format)
    return {"task_id": task_id}


@router.post("/to-gif")
async def api_video_to_gif(
    file: UploadFile = File(...),
    fps: int = Form(10),
    width: int = Form(0),
    start_time: float = Form(0),
    end_time: float = Form(0),
):
    """影片轉 GIF（背景任務）"""
    data = await file.read()
    if len(data) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=400, detail="檔案超過 200MB 上限")

    task_id = submit_task(video_to_gif, data, fps, width, start_time, end_time)
    return {"task_id": task_id}


@router.post("/compress")
async def api_compress_video(
    file: UploadFile = File(...),
    resolution: str = Form(""),
    crf: int = Form(28),
):
    """壓縮影片（背景任務）"""
    data = await file.read()
    if len(data) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=400, detail="檔案超過 200MB 上限")

    task_id = submit_task(compress_video, data, resolution, crf)
    return {"task_id": task_id}


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

    # 判斷 content-type
    is_gif = b"GIF89a" in task.result[:10] or b"GIF87a" in task.result[:10]
    if is_gif:
        return Response(content=task.result, media_type="image/gif",
                        headers={"Content-Disposition": f"attachment; filename=result_{task_id}.gif"})
    return Response(content=task.result, media_type="video/mp4",
                    headers={"Content-Disposition": f"attachment; filename=result_{task_id}.mp4"})
