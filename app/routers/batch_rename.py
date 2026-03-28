"""批次改名路由 — 預覽 + 套用"""
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.core.tasks import submit_task, get_task, task_progress_stream
from app.services.batch_renamer import preview_rename, apply_rename

logger = logging.getLogger(__name__)
router = APIRouter()


class RenamePreviewRequest(BaseModel):
    filenames: list[str]
    prefix: str = ""
    suffix: str = ""
    find: str = ""
    replace: str = ""
    numbering: bool = False
    numbering_start: int = 1
    numbering_digits: int = 3
    numbering_position: str = "prefix"


@router.post("/preview")
async def api_preview(body: RenamePreviewRequest):
    """預覽改名結果（純計算，不需要上傳檔案）"""
    if not body.filenames:
        raise HTTPException(status_code=400, detail="請提供檔名列表")

    result = preview_rename(
        body.filenames,
        prefix=body.prefix, suffix=body.suffix,
        find=body.find, replace=body.replace,
        numbering=body.numbering,
        numbering_start=body.numbering_start,
        numbering_digits=body.numbering_digits,
        numbering_position=body.numbering_position,
    )
    return {"success": True, "results": result}


@router.post("/apply")
async def api_apply(
    files: list[UploadFile] = File(...),
    prefix: str = Form(""),
    suffix: str = Form(""),
    find: str = Form(""),
    replace: str = Form(""),
    numbering: bool = Form(False),
    numbering_start: int = Form(1),
    numbering_digits: int = Form(3),
    numbering_position: str = Form("prefix"),
):
    """套用改名規則並打包 ZIP 下載"""
    if not files:
        raise HTTPException(status_code=400, detail="請上傳檔案")

    filenames = [f.filename or f"file_{i}" for i, f in enumerate(files)]
    rename_map = preview_rename(
        filenames,
        prefix=prefix, suffix=suffix,
        find=find, replace=replace,
        numbering=numbering,
        numbering_start=numbering_start,
        numbering_digits=numbering_digits,
        numbering_position=numbering_position,
    )

    file_data = []
    for f in files:
        data = await f.read()
        file_data.append((f.filename or f"file_{len(file_data)}", data))

    task_id = submit_task(apply_rename, file_data, rename_map)
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
    return Response(content=task.result, media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename=renamed_{task_id}.zip"})
