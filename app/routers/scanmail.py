"""ScanMail 掃描郵寄路由 — 原有的完整掃描+Email 流程"""
import base64
import logging
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.core.sessions import get_user_id, get_session
from app.core.file_manager import make_thumbnail
from app.models.contact import ContactModel
from app.models.history import HistoryModel
from app.models.sender import SenderModel
from app.services.ai_analyzer import analyze_document
from app.services.image_processor import (
    image_to_pdf, images_to_pdf, validate_image, get_image_info,
)
from app.services.email_sender import send_email
from app.services.doc_scanner import (
    detect_document_edges, perspective_transform, apply_filter,
    scan_document, rotate_image,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Pydantic 請求模型 ──

class ContactCreateRequest(BaseModel):
    name: str
    email: str
    department: str = ""
    title: str = ""

class AnalyzeRequest(BaseModel):
    contact_id: int

class SendRequest(BaseModel):
    contact_id: int
    subject: Optional[str] = None
    body: Optional[str] = None
    filename: Optional[str] = None

class SenderProfileRequest(BaseModel):
    name: str
    email: str
    title: str = ""
    department: str = ""
    organization: str = "國立勤益科技大學"

class ScanRequest(BaseModel):
    corners: Optional[list[list[int]]] = None
    filter_name: str = "auto"
    auto_detect: bool = True

class RotateRequest(BaseModel):
    angle: int = 90

class PageReorderRequest(BaseModel):
    order: list[int]


# ── 上傳圖片 ──

@router.post("/upload")
async def upload_image(request: Request, file: UploadFile = File(...)):
    user_id = get_user_id(request)
    session = get_session(user_id)

    content = await file.read()

    is_valid, error_msg = validate_image(content)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    media_type = file.content_type or "image/jpeg"
    if media_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        media_type = "image/jpeg"

    session.image_data = content
    session.image_original = content
    session.image_media_type = media_type
    session.ai_result = None
    session.detected_corners = None

    return {
        "success": True,
        "filename": file.filename,
        "size": len(content),
        "content_type": media_type,
    }


# ── 文件掃描後處理 ──

@router.post("/scan/detect")
async def detect_edges(request: Request):
    """偵測文件邊界，回傳四個角點與原圖尺寸"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    corners = detect_document_edges(session.image_data)
    info = get_image_info(session.image_data)

    return {
        "success": True,
        "corners": corners,
        "detected": corners is not None,
        "image_width": info.get("width", 0),
        "image_height": info.get("height", 0),
    }


@router.post("/scan/process")
async def process_scan(request: Request, body: ScanRequest):
    """執行完整掃描處理（邊界校正 + 濾鏡）"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    try:
        result = scan_document(
            image_data=session.image_data,
            corners=body.corners,
            filter_name=body.filter_name,
            auto_detect=body.auto_detect,
        )
    except Exception as e:
        logger.error("掃描處理失敗: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"掃描處理失敗: {e}")

    session.image_data = result["image"]
    session.image_media_type = "image/jpeg"
    if result["corners"]:
        session.detected_corners = result["corners"]

    img_b64 = base64.b64encode(result["image"]).decode("utf-8")

    return {
        "success": True,
        "image_base64": img_b64,
        "corners": result["corners"],
        "auto_detected": result["auto_detected"],
        "filter_applied": result["filter_applied"],
        "original_size": result["original_size"],
        "processed_size": result["processed_size"],
        "distortion": result.get("distortion"),
    }


@router.post("/scan/filter")
async def apply_scan_filter(request: Request, body: ScanRequest):
    """切換濾鏡（從原始圖或已校正圖重新套用）"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    source = session.image_original or session.image_data
    if session.detected_corners:
        source = perspective_transform(source, session.detected_corners)

    processed = apply_filter(source, body.filter_name)

    session.image_data = processed
    session.image_media_type = "image/jpeg"

    img_b64 = base64.b64encode(processed).decode("utf-8")

    return {
        "success": True,
        "image_base64": img_b64,
        "filter_applied": body.filter_name,
    }


# ── 圖片旋轉 ──

@router.post("/scan/rotate")
async def rotate_scan(request: Request, body: RotateRequest):
    """旋轉目前圖片（90° 的整數倍）"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    session.image_original = rotate_image(
        session.image_original or session.image_data, body.angle
    )
    session.image_data = rotate_image(session.image_data, body.angle)
    session.detected_corners = None

    img_b64 = base64.b64encode(session.image_data).decode("utf-8")
    info = get_image_info(session.image_data)

    return {
        "success": True,
        "image_base64": img_b64,
        "image_width": info.get("width", 0),
        "image_height": info.get("height", 0),
        "angle": body.angle,
    }


# ── 多頁掃描管理 ──

@router.post("/pages/add")
async def add_page(request: Request):
    """將目前處理後的圖片加入頁面列表"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="沒有可新增的頁面")

    session.pages.append(session.image_data)
    page_index = len(session.pages) - 1

    return {
        "success": True,
        "page_index": page_index,
        "total_pages": len(session.pages),
    }


@router.get("/pages")
async def list_pages(request: Request):
    """取得目前所有頁面列表（含縮圖）"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    pages_info = []
    for i, page_data in enumerate(session.pages):
        info = get_image_info(page_data)
        thumb = make_thumbnail(page_data, max_dim=200)
        thumb_b64 = base64.b64encode(thumb).decode("utf-8")
        pages_info.append({
            "index": i,
            "width": info.get("width", 0),
            "height": info.get("height", 0),
            "size": len(page_data),
            "thumbnail": thumb_b64,
        })

    return {
        "success": True,
        "pages": pages_info,
        "total_pages": len(session.pages),
    }


@router.delete("/pages/{page_index}")
async def remove_page(request: Request, page_index: int):
    """移除指定頁面"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if page_index < 0 or page_index >= len(session.pages):
        raise HTTPException(status_code=400, detail="頁面索引無效")

    session.pages.pop(page_index)
    return {
        "success": True,
        "total_pages": len(session.pages),
    }


@router.post("/pages/reorder")
async def reorder_pages(request: Request, body: PageReorderRequest):
    """重新排序頁面"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if sorted(body.order) != list(range(len(session.pages))):
        raise HTTPException(status_code=400, detail="排序索引無效")

    session.pages = [session.pages[i] for i in body.order]
    return {
        "success": True,
        "total_pages": len(session.pages),
    }


@router.post("/pages/clear")
async def clear_pages(request: Request):
    """清除所有頁面"""
    user_id = get_user_id(request)
    session = get_session(user_id)
    session.pages.clear()
    return {"success": True, "total_pages": 0}


# ── AI 分析 ──

@router.post("/analyze")
async def analyze_image(request: Request, body: AnalyzeRequest):
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    contact = ContactModel.get_by_id(body.contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="聯絡人不存在")

    session.selected_contact_id = body.contact_id

    sender = SenderModel.get_or_default(user_id)

    try:
        result = await analyze_document(
            image_data=session.image_data,
            media_type=session.image_media_type,
            sender_info={
                "name": sender.get("name", ""),
                "title": sender.get("title", ""),
                "department": sender.get("department", ""),
            },
            recipient_info={
                "name": contact.get("name", ""),
                "department": contact.get("department", ""),
                "email": contact.get("email", ""),
            },
        )
    except Exception as e:
        logger.error("AI 分析錯誤: %s", e, exc_info=True)
        from app.services.ai_analyzer import get_fallback_result
        result = get_fallback_result()
        result["_error"] = str(e)

    session.ai_result = result
    ContactModel.increment_frequency(body.contact_id)

    return {"success": True, "result": result}


# ── 寄送郵件 ──

@router.post("/send")
async def send_email_api(request: Request, body: SendRequest):
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")
    if not session.ai_result:
        raise HTTPException(status_code=400, detail="請先執行 AI 分析")

    contact = ContactModel.get_by_id(body.contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="聯絡人不存在")

    sender = SenderModel.get_or_default(user_id)
    ai = session.ai_result

    subject = body.subject or ai.get("subject", "掃描文件")
    email_body = body.body or ai.get("body", "附件為掃描文件，請查收。")
    filename = body.filename or ai.get("filename", "document.pdf")
    if not filename.endswith(".pdf"):
        filename += ".pdf"

    try:
        if session.pages:
            pdf_bytes = images_to_pdf(session.pages)
        else:
            pdf_bytes = image_to_pdf(session.image_data)
    except Exception as e:
        logger.error("圖片轉 PDF 失敗: %s", e)
        raise HTTPException(status_code=500, detail="圖片轉 PDF 失敗")

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

    if result["success"]:
        HistoryModel.create(
            user_id=user_id,
            recipient_email=contact["email"],
            recipient_name=contact["name"],
            subject=subject,
            body=email_body,
            doc_type=ai.get("doc_type", "other"),
            filename=filename,
            ai_confidence=ai.get("confidence", 0),
            file_size=len(pdf_bytes),
        )
        session.image_data = None
        session.image_original = None
        session.ai_result = None
        session.selected_contact_id = None
        session.detected_corners = None
        session.pages.clear()

    return {
        "success": result["success"],
        "message": result["message"],
        "subject": subject,
        "recipient": contact["name"],
        "recipient_email": contact["email"],
        "filename": filename,
    }


# ── 聯絡人 API ──

@router.get("/contacts")
async def list_contacts(request: Request):
    user_id = get_user_id(request)
    return ContactModel.list_by_user(user_id, limit=50)

@router.post("/contacts")
async def create_contact(request: Request, body: ContactCreateRequest):
    user_id = get_user_id(request)
    contact_id = ContactModel.create(
        user_id=user_id, name=body.name, email=body.email,
        department=body.department, title=body.title,
    )
    return {"id": contact_id, "name": body.name, "email": body.email}

@router.delete("/contacts/{contact_id}")
async def delete_contact(request: Request, contact_id: int):
    user_id = get_user_id(request)
    contact = ContactModel.get_by_id(contact_id)
    if not contact or contact.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="聯絡人不存在")
    ContactModel.delete(contact_id)
    return {"success": True}


# ── 歷史 + 統計 ──

@router.get("/history")
async def get_history(request: Request):
    user_id = get_user_id(request)
    return HistoryModel.list_by_user(user_id)

@router.get("/stats")
async def get_stats(request: Request):
    user_id = get_user_id(request)
    return HistoryModel.get_stats(user_id)


# ── 寄件人設定 ──

@router.get("/settings")
async def get_sender_settings(request: Request):
    user_id = get_user_id(request)
    return SenderModel.get_or_default(user_id)

@router.post("/settings")
async def update_sender_settings(request: Request, body: SenderProfileRequest):
    user_id = get_user_id(request)
    SenderModel.upsert(
        user_id=user_id, name=body.name, email=body.email,
        title=body.title, department=body.department,
        organization=body.organization,
    )
    return {"success": True}


# ── 開發用 ──

@router.get("/test-prompt")
async def test_prompt():
    from app.services.ai_analyzer import SYSTEM_PROMPT
    return {"prompt": SYSTEM_PROMPT}
