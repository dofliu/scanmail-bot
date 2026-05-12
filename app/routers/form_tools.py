"""Auto Form Fill 路由 — 表單欄位偵測與自動填寫

API 端點：
    POST /api/tools/form/detect            上傳表單 → 偵測欄位
    POST /api/tools/form/suggest           套用 semantic mapping 取得建議值
    POST /api/tools/form/fill              背景任務：填寫並產生 PDF
    GET  /api/tools/form/task/{id}/...     進度 / 下載

詳細設計：docs/AUTO_FORM_FILL.md
"""
import io
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import Response, StreamingResponse

from app.core.tasks import submit_task, get_task, task_progress_stream
from app.core.file_manager import save_temp_file, get_temp_path
from app.services.form_fill import (
    detect_fields, fill_form, suggest_values,
    DetectionResult, FormField,
)
from app.services.form_fill.schema import UnsupportedFormat
from app.models.sender import SenderModel
from app.models.contact import ContactModel

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/detect")
async def api_detect_fields(
    file: UploadFile = File(...),
    hint: Optional[str] = Form(None),
):
    """偵測表單欄位

    回傳：
        {
            "session_token": "<uuid>",      # 後續 fill 時帶回
            "filename": "<原檔名>",
            "result": { ...DetectionResult... }
        }
    """
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="空檔案")

    mime = file.content_type or _guess_mime(file.filename or "")

    try:
        result: DetectionResult = detect_fields(data, mime, hint=hint)
    except UnsupportedFormat as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("偵測失敗: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"偵測失敗: {e}")

    # 暫存原檔，後續 fill 時直接取用
    ext = ".pdf" if mime == "application/pdf" else ".bin"
    path = save_temp_file(data, suffix=ext)

    return {
        "session_token": path.name,
        "filename": file.filename,
        "result": result.to_dict(),
    }


@router.post("/suggest")
async def api_suggest_values(payload: dict):
    """對欄位清單套用 semantic mapping，回傳建議值

    Request:
        {
            "user_id": "default",
            "contact_id": 3,             # optional
            "fields": [ {...FormField...}, ... ]
        }
    Response:
        {
            "values": { "field_0": "王小明", ... },
            "matched": 5,
            "total": 12
        }
    """
    fields_raw = payload.get("fields") or []
    fields = [_field_from_dict(f) for f in fields_raw]

    user_id = payload.get("user_id", "default")
    sender = SenderModel.get_or_default(user_id)

    contact = None
    contact_id = payload.get("contact_id")
    if contact_id is not None:
        contact = ContactModel.get_by_id(int(contact_id))

    values = suggest_values(fields, sender, contact)
    return {
        "values": values,
        "matched": len(values),
        "total": len(fields),
    }


@router.post("/fill")
async def api_fill_form(payload: dict):
    """根據欄位值填寫 PDF（背景任務）

    Request:
        {
            "session_token": "<from detect>",
            "fields": [ {...FormField...} ],
            "values": { "field_0": "...", ... }
        }
    Response:
        { "task_id": "..." }
    """
    token = payload.get("session_token")
    if not token:
        raise HTTPException(status_code=400, detail="缺少 session_token")
    path = get_temp_path(token)
    if not path:
        raise HTTPException(status_code=404, detail="session 已過期，請重新上傳")

    fields_raw = payload.get("fields") or []
    fields = [_field_from_dict(f) for f in fields_raw]
    values = payload.get("values") or {}

    if not fields or not values:
        raise HTTPException(status_code=400, detail="fields 或 values 為空")

    data = path.read_bytes()
    task_id = submit_task(_run_fill, data, fields, values)
    return {"task_id": task_id}


def _run_fill(task_id: str, data: bytes, fields: list, values: dict) -> bytes:
    """背景任務：執行填寫"""
    from app.core.tasks import update_task_progress
    update_task_progress(task_id, 20, "填寫欄位中...")
    result = fill_form(data, fields, values)
    update_task_progress(task_id, 95, "輸出 PDF...")
    return result


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
    return Response(
        content=task.result,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=filled_{task_id}.pdf"},
    )


# ── helpers ──

def _guess_mime(filename: str) -> str:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    return {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(ext, "application/octet-stream")


def _field_from_dict(d: dict) -> FormField:
    bbox = d.get("bbox")
    if bbox is not None:
        bbox = tuple(float(v) for v in bbox)
    return FormField(
        name=str(d.get("name", "")),
        label=str(d.get("label", "")),
        field_type=str(d.get("field_type", "text")),
        bbox=bbox,
        page=int(d.get("page", 0)),
        backend=str(d.get("backend", "")),
        confidence=float(d.get("confidence", 1.0)),
        suggested_value=d.get("suggested_value"),
        semantic_key=d.get("semantic_key"),
    )
