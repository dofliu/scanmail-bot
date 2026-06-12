"""Auto Form Fill 路由 — 表單欄位偵測與自動填寫

API 端點：
  - POST /api/tools/form/detect           偵測 PDF/圖片 欄位，自動匹配模板
  - POST /api/tools/form/suggest          提供 semantic mapping 欄位建議與模板數值覆寫
  - POST /api/tools/form/fill             提交背景填寫任務
  - GET  /api/tools/form/task/:id/progress SSE 任務進度
  - GET  /api/tools/form/task/:id/download 下載填寫後的 PDF
  - POST /api/tools/form/task/:id/send     寄送填寫後的 PDF 到指定聯絡人

模板端點：
  - GET  /api/tools/form/templates         列出使用者的自訂模板
  - POST /api/tools/form/templates         儲存/更新自訂模板
  - POST /api/tools/form/templates/:id/apply 手動套用模板
  - DELETE /api/tools/form/templates/:id   刪除模板
"""
import logging
from typing import Optional
from pydantic import BaseModel

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request, Depends
from fastapi.responses import Response, StreamingResponse

from app.core.tasks import submit_task, get_task, task_progress_stream
from app.core.file_manager import save_temp_file, get_temp_path
from app.core.sessions import get_user_id, get_session
from app.core.rate_limiter import sensitive_rate_limit
from app.services.image_processor import image_to_pdf, images_to_pdf

from app.services.form_fill import (
    detect_fields, normalize_to_pdf, fill_form, suggest_values,
    DetectionResult, FormField, match_new_fields_with_template,
)
from app.services.form_fill.schema import UnsupportedFormat
from app.services.email_sender import send_email

from app.models.sender import SenderModel
from app.models.contact import ContactModel
from app.models.history import HistoryModel
from app.models.form_template import FormTemplateModel, compute_form_fingerprint

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic Request Models ──

class FormTemplateSaveRequest(BaseModel):
    name: str
    fields: list[dict]
    values: dict


class FormTemplateApplyRequest(BaseModel):
    fields: list[dict]


class FormBatchSendRequest(BaseModel):
    contact_ids: list[int]
    subject: Optional[str] = None
    body: Optional[str] = None
    filename: Optional[str] = None


# ── 核心 Form API ──

@router.post("/detect", dependencies=[Depends(sensitive_rate_limit)])
async def api_detect_fields(
    request: Request,
    file: UploadFile = File(...),
    hint: Optional[str] = Form(None),
):
    """偵測表單欄位，並自動檢測是否匹配已儲存之模板

    對於影像輸入，會先在邊界轉換成 PDF 後存為 session 檔，
    後續 /fill 流程一律操作 PDF。

    回傳：
        {
            "session_token": "<32-hex>.pdf",
            "filename": "<原檔名>",
            "result": { ...DetectionResult... },
            "matched_template": { "id": 12, "name": "模板名稱" } 或 null
        }
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="空檔案")

    mime = file.content_type or _guess_mime(file.filename or "")

    try:
        # 邊界：任何輸入 → PDF（影像會被包成一頁 PDF）
        pdf_data = normalize_to_pdf(raw, mime)
    except UnsupportedFormat as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        result: DetectionResult = detect_fields(pdf_data, hint=hint)
    except Exception as e:
        logger.error("偵測失敗: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"偵測失敗: {e}")

    # session 一律存 PDF — /fill 不再需要關心原始格式
    path = save_temp_file(pdf_data, suffix=".pdf")

    # 偵測是否能匹配模板
    user_id = get_user_id(request)
    fields_dict = [f.to_dict() for f in result.fields]
    fingerprint = compute_form_fingerprint(fields_dict)
    matched_tmpl = FormTemplateModel.get_by_fingerprint(user_id, fingerprint)

    matched_tmpl_info = None
    if matched_tmpl:
        matched_tmpl_info = {
            "id": matched_tmpl["id"],
            "name": matched_tmpl["name"]
        }
        # 自動套用模板調整後的 bbox 與 field_type
        enriched_fields_dict, _ = match_new_fields_with_template(
            fields_dict, matched_tmpl["fields"], matched_tmpl["values"]
        )
        result.fields = [_field_from_dict(f) for f in enriched_fields_dict]

    return {
        "session_token": path.name,
        "filename": file.filename,
        "result": result.to_dict(),
        "matched_template": matched_tmpl_info,
    }


@router.post("/detect_from_scan", dependencies=[Depends(sensitive_rate_limit)])
async def api_detect_from_scan(request: Request):
    """將當前掃描工作階段 (scanmail) 的影像轉換為 PDF 表單並進行欄位偵測"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.pages and not session.image_data:
        raise HTTPException(status_code=400, detail="掃描工作階段中沒有任何文件，請先拍照或上傳。")

    try:
        if session.pages:
            pdf_data = images_to_pdf(session.pages)
        else:
            pdf_data = image_to_pdf(session.image_data)
    except Exception as e:
        logger.error("掃描影像轉 PDF 失敗: %s", e)
        raise HTTPException(status_code=500, detail=f"轉換 PDF 失敗: {e}")

    try:
        result: DetectionResult = detect_fields(pdf_data)
    except Exception as e:
        logger.error("偵測失敗: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"偵測失敗: {e}")

    path = save_temp_file(pdf_data, suffix=".pdf")

    fields_dict = [f.to_dict() for f in result.fields]
    fingerprint = compute_form_fingerprint(fields_dict)
    matched_tmpl = FormTemplateModel.get_by_fingerprint(user_id, fingerprint)

    matched_tmpl_info = None
    if matched_tmpl:
        matched_tmpl_info = {
            "id": matched_tmpl["id"],
            "name": matched_tmpl["name"]
        }
        enriched_fields_dict, _ = match_new_fields_with_template(
            fields_dict, matched_tmpl["fields"], matched_tmpl["values"]
        )
        result.fields = [_field_from_dict(f) for f in enriched_fields_dict]

    filename = "scanned_form.pdf"
    if session.ai_result and session.ai_result.get("filename"):
        filename = session.ai_result["filename"]
        if not filename.endswith(".pdf"):
            filename += ".pdf"

    return {
        "session_token": path.name,
        "filename": filename,
        "result": result.to_dict(),
        "matched_template": matched_tmpl_info,
    }


@router.post("/suggest")
async def api_suggest_values(request: Request, payload: dict):
    """對欄位清單套用 semantic mapping，回傳建議值 + 標註後的 fields。
    若有匹配之模板特徵，將優先覆寫為上次填寫的值。

    Request:
        {
            "contact_id": 3,             # optional
            "fields": [ {...FormField...}, ... ]
        }
    """
    fields_raw = payload.get("fields") or []
    fields = [_field_from_dict(f) for f in fields_raw]

    user_id = get_user_id(request)
    sender = SenderModel.get_or_default(user_id)

    contact = None
    contact_id = payload.get("contact_id")
    if contact_id is not None:
        contact = ContactModel.get_by_id(int(contact_id))

    # suggest_values 會 in-place 設定 semantic_key 與 suggested_value
    values = suggest_values(fields, sender, contact)

    # 檢查是否有匹配模板
    fields_dict = [f.to_dict() for f in fields]
    fingerprint = compute_form_fingerprint(fields_dict)
    matched_tmpl = FormTemplateModel.get_by_fingerprint(user_id, fingerprint)

    if matched_tmpl:
        # 套用模板欄位 bbox 調整與上次填寫的建議值
        enriched_fields_dict, tmpl_values = match_new_fields_with_template(
            fields_dict, matched_tmpl["fields"], matched_tmpl["values"]
        )
        values.update(tmpl_values)
        fields = [_field_from_dict(f) for f in enriched_fields_dict]

    return {
        "values": values,
        "fields": [f.to_dict() for f in fields],
        "matched": len(values),
        "total": len(fields),
        "matched_template": {
            "id": matched_tmpl["id"],
            "name": matched_tmpl["name"]
        } if matched_tmpl else None
    }


@router.post("/fill")
async def api_fill_form(payload: dict):
    """根據欄位值填寫 PDF（背景任務）"""
    token = payload.get("session_token")
    if not token or not isinstance(token, str):
        raise HTTPException(status_code=400, detail="缺少 session_token")
    path = get_temp_path(token)
    if not path:
        raise HTTPException(status_code=404, detail="session 已過期或無效，請重新上傳")

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


@router.post("/task/{task_id}/send", dependencies=[Depends(sensitive_rate_limit)])
async def api_task_send_email(
    request: Request,
    task_id: str,
    payload: FormBatchSendRequest,
):
    """將背景任務中填寫好的 PDF 表單寄送給指定聯絡人"""
    user_id = get_user_id(request)
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任務不存在")
    if task.status.value != "completed":
        raise HTTPException(status_code=400, detail=f"任務狀態: {task.status.value}")

    pdf_bytes = task.result
    if not pdf_bytes or not isinstance(pdf_bytes, bytes):
        raise HTTPException(status_code=500, detail="任務結果無效")

    if not payload.contact_ids:
        raise HTTPException(status_code=400, detail="請選擇至少一位收件人")

    sender = SenderModel.get_or_default(user_id)
    subject = payload.subject or "自動填寫表單"
    email_body = payload.body or "附件為自動填寫之表單，請查收。"
    filename = payload.filename or f"filled_{task_id}.pdf"
    if not filename.endswith(".pdf"):
        filename += ".pdf"

    results = []
    for cid in payload.contact_ids:
        contact = ContactModel.get_by_id(cid)
        if not contact:
            results.append({"contact_id": cid, "success": False, "message": "聯絡人不存在"})
            continue

        result = await send_email(
            sender_email=sender.get("email", "") or sender.get("smtp_user", ""),
            sender_name=sender.get("name", ""),
            recipient_email=contact["email"],
            recipient_name=contact["name"],
            subject=subject,
            body=email_body,
            pdf_bytes=pdf_bytes,
            filename=filename,
            sender_title=sender.get("title", ""),
            sender_dept=sender.get("department", ""),
            sender_org=sender.get("organization", "國立勤益科技大學"),
        )

        results.append({
            "contact_id": cid,
            "name": contact["name"],
            "email": contact["email"],
            "success": result["success"],
            "message": result["message"],
        })

        if result["success"]:
            # 建立歷史紀錄
            HistoryModel.create(
                user_id=user_id,
                recipient_email=contact["email"],
                recipient_name=contact["name"],
                subject=subject,
                body=email_body,
                doc_type="form",
                filename=filename,
                ai_confidence=1.0,
                file_size=len(pdf_bytes),
            )
            ContactModel.increment_frequency(cid)

    success_count = sum(1 for r in results if r["success"])
    total = len(results)

    return {
        "success": success_count > 0,
        "total": total,
        "success_count": success_count,
        "fail_count": total - success_count,
        "results": results,
    }


# ── 模板管理 API ──

@router.get("/templates")
async def list_form_templates(request: Request):
    """取得使用者的所有自訂表單模板"""
    user_id = get_user_id(request)
    templates = FormTemplateModel.list_by_user(user_id)
    return {"templates": templates}


@router.post("/templates")
async def save_form_template(request: Request, payload: FormTemplateSaveRequest):
    """新增或更新自訂表單模板"""
    user_id = get_user_id(request)
    template_id = FormTemplateModel.upsert(
        user_id=user_id,
        name=payload.name,
        fields=payload.fields,
        values=payload.values
    )
    return {"success": True, "template_id": template_id}


@router.post("/templates/{template_id}/apply")
async def apply_form_template(request: Request, template_id: int, payload: FormTemplateApplyRequest):
    """手動套用指定自訂表單模板到目前欄位"""
    template = FormTemplateModel.get_by_id(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")

    enriched_fields, suggested_vals = match_new_fields_with_template(
        payload.fields, template["fields"], template["values"]
    )
    return {
        "fields": enriched_fields,
        "values": suggested_vals,
        "template_name": template["name"]
    }


@router.delete("/templates/{template_id}")
async def delete_form_template(request: Request, template_id: int):
    """刪除指定表單模板"""
    user_id = get_user_id(request)
    template = FormTemplateModel.get_by_id(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")
    if template["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="無權刪除此模板")

    FormTemplateModel.delete(template_id)
    return {"success": True}


# ── Helpers ──

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
