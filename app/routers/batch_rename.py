"""批次改名路由 — 預覽 + 套用"""
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.core.tasks import submit_task, get_task, task_progress_stream
from app.services.batch_renamer import preview_rename, apply_rename
from app.services.ai_renamer import scan_directory, apply_renames

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


class AIScanRequest(BaseModel):
    directory: str
    only_exts: str = ""


class AIRenameItem(BaseModel):
    src_path: str
    dst_name: str


class AIRenameRequest(BaseModel):
    items: list[AIRenameItem]


@router.post("/ai/scan")
async def api_ai_scan(body: AIScanRequest):
    """AI 智慧改名預覽 — 本機路徑模式，僅對低資訊檔名呼叫 Gemini。"""
    directory = (body.directory or "").strip()
    if not directory:
        raise HTTPException(status_code=400, detail="請提供資料夾路徑")
    try:
        results = scan_directory(directory, only_exts=body.only_exts or None)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception("AI 掃描失敗")
        raise HTTPException(status_code=500, detail=f"AI 掃描失敗: {e}")
    return {"success": True, "results": results}


@router.post("/ai/rename")
async def api_ai_rename(body: AIRenameRequest):
    """AI 智慧改名套用 — 直接在本機對檔案 os.replace，無 ZIP。"""
    if not body.items:
        raise HTTPException(status_code=400, detail="沒有可套用的項目")
    items = [i.model_dump() for i in body.items]
    results = apply_renames(items)
    renamed = sum(1 for r in results if r.get("result") == "renamed")
    failed = sum(1 for r in results if r.get("result") == "error")
    return {"success": True, "results": results, "renamed": renamed, "failed": failed}


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
