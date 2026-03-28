"""ScanMail Bot — FastAPI Web App 主程式入口"""
import io
import logging
from contextlib import asynccontextmanager
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import get_settings
from app.database import init_db
from app.models.contact import ContactModel
from app.models.history import HistoryModel
from app.models.sender import SenderModel
from app.services.ai_analyzer import analyze_document
from app.services.image_processor import image_to_pdf, images_to_pdf, validate_image
from app.services.email_sender import send_email
from app.services.doc_scanner import detect_document_edges, perspective_transform, apply_filter, scan_document, rotate_image

# 設定 logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# 路徑設定
BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"


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


# ── 工作階段管理（記憶體版，生產環境可改 Redis）──

class SessionData:
    def __init__(self):
        self.image_data: Optional[bytes] = None
        self.image_original: Optional[bytes] = None  # 保留原始圖片（切換濾鏡用）
        self.image_media_type: str = "image/jpeg"
        self.ai_result: Optional[dict] = None
        self.selected_contact_id: Optional[int] = None
        self.detected_corners: Optional[list] = None  # 偵測到的邊界角點
        # 多頁掃描
        self.pages: list[bytes] = []  # 已確認的頁面列表（處理後的 JPEG bytes）

_sessions: dict[str, SessionData] = {}

def get_user_id(request: Request) -> str:
    return request.headers.get("X-User-Id", "default_user") or "default_user"

def get_session(user_id: str) -> SessionData:
    if user_id not in _sessions:
        _sessions[user_id] = SessionData()
    return _sessions[user_id]


# ── 應用程式生命週期 ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("ScanMail Bot 啟動中...")
    init_db()
    logger.info("資料庫初始化完成")
    yield
    logger.info("ScanMail Bot 關閉")


# ── FastAPI App ──

app = FastAPI(
    title="ScanMail Bot",
    description="智慧掃描郵寄 Web 應用",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ── 前端 + 健康檢查 ──

@app.get("/")
async def serve_frontend():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file), media_type="text/html")
    return {"message": "ScanMail Bot API — 請建立 static/index.html"}

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ScanMail Bot", "version": "2.0.0"}


# ── 上傳圖片 ──

@app.post("/api/upload")
async def upload_image(request: Request, file: UploadFile = File(...)):
    user_id = get_user_id(request)
    session = get_session(user_id)

    content = await file.read()

    # 驗證圖片
    is_valid, error_msg = validate_image(content)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    # 判斷 media type
    media_type = file.content_type or "image/jpeg"
    if media_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        media_type = "image/jpeg"

    session.image_data = content
    session.image_original = content  # 保留原始圖片
    session.image_media_type = media_type
    session.ai_result = None  # 重置舊的分析結果
    session.detected_corners = None
    # 不清除 pages — 上傳新頁面時保留既有頁面（多頁模式）

    return {
        "success": True,
        "filename": file.filename,
        "size": len(content),
        "content_type": media_type,
    }


# ── 文件掃描後處理 ──

class ScanRequest(BaseModel):
    corners: Optional[list[list[int]]] = None
    filter_name: str = "auto"
    auto_detect: bool = True

class RotateRequest(BaseModel):
    angle: int = 90  # 90, 180, 270, -90

class PageReorderRequest(BaseModel):
    order: list[int]  # 新的頁面順序索引，例如 [2, 0, 1]


@app.post("/api/scan/detect")
async def detect_edges(request: Request):
    """偵測文件邊界，回傳四個角點與原圖尺寸"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    corners = detect_document_edges(session.image_data)

    # 回傳原圖尺寸（前端 canvas 需要）
    from app.services.image_processor import get_image_info
    info = get_image_info(session.image_data)

    return {
        "success": True,
        "corners": corners,
        "detected": corners is not None,
        "image_width": info.get("width", 0),
        "image_height": info.get("height", 0),
    }


@app.post("/api/scan/process")
async def process_scan(request: Request, body: ScanRequest):
    """執行完整掃描處理（邊界校正 + 濾鏡）"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    result = scan_document(
        image_data=session.image_data,
        corners=body.corners,
        filter_name=body.filter_name,
        auto_detect=body.auto_detect,
    )

    # 更新 session 中的圖片為處理後的版本
    session.image_data = result["image"]
    session.image_media_type = "image/jpeg"
    if result["corners"]:
        session.detected_corners = result["corners"]

    # 回傳處理後的圖片（base64）
    import base64
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


@app.post("/api/scan/filter")
async def apply_scan_filter(request: Request, body: ScanRequest):
    """切換濾鏡（從原始圖或已校正圖重新套用）"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    # 如果有邊界角點 → 從原始圖重新校正+套濾鏡
    # 否則從原始圖直接套濾鏡
    source = session.image_original or session.image_data
    if session.detected_corners:
        source = perspective_transform(source, session.detected_corners)

    processed = apply_filter(source, body.filter_name)

    # 更新 session
    session.image_data = processed
    session.image_media_type = "image/jpeg"

    import base64
    img_b64 = base64.b64encode(processed).decode("utf-8")

    return {
        "success": True,
        "image_base64": img_b64,
        "filter_applied": body.filter_name,
    }


# ── 圖片旋轉 ──

@app.post("/api/scan/rotate")
async def rotate_scan(request: Request, body: RotateRequest):
    """旋轉目前圖片（90° 的整數倍）"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    # 旋轉原始圖片和處理後圖片
    session.image_original = rotate_image(
        session.image_original or session.image_data, body.angle
    )
    session.image_data = rotate_image(session.image_data, body.angle)
    session.detected_corners = None  # 旋轉後角點失效

    import base64
    img_b64 = base64.b64encode(session.image_data).decode("utf-8")

    # 回傳新尺寸
    from app.services.image_processor import get_image_info
    info = get_image_info(session.image_data)

    return {
        "success": True,
        "image_base64": img_b64,
        "image_width": info.get("width", 0),
        "image_height": info.get("height", 0),
        "angle": body.angle,
    }


# ── 多頁掃描管理 ──

@app.post("/api/pages/add")
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


@app.get("/api/pages")
async def list_pages(request: Request):
    """取得目前所有頁面列表（含縮圖）"""
    user_id = get_user_id(request)
    session = get_session(user_id)

    import base64
    pages_info = []
    for i, page_data in enumerate(session.pages):
        from app.services.image_processor import get_image_info
        info = get_image_info(page_data)
        # 產生小縮圖
        thumb = _make_thumbnail(page_data, max_dim=200)
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


@app.delete("/api/pages/{page_index}")
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


@app.post("/api/pages/reorder")
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


@app.post("/api/pages/clear")
async def clear_pages(request: Request):
    """清除所有頁面"""
    user_id = get_user_id(request)
    session = get_session(user_id)
    session.pages.clear()
    return {"success": True, "total_pages": 0}


def _make_thumbnail(image_data: bytes, max_dim: int = 200) -> bytes:
    """產生小縮圖"""
    from PIL import Image
    img = Image.open(io.BytesIO(image_data))
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


# ── AI 分析 ──

@app.post("/api/analyze")
async def analyze_image(request: Request, body: AnalyzeRequest):
    user_id = get_user_id(request)
    session = get_session(user_id)

    if not session.image_data:
        raise HTTPException(status_code=400, detail="請先上傳圖片")

    # 取得聯絡人
    contact = ContactModel.get_by_id(body.contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="聯絡人不存在")

    session.selected_contact_id = body.contact_id

    # 取得寄件人設定
    sender = SenderModel.get_or_default(user_id)

    # 呼叫 AI 分析（失敗時自動 fallback，不會拋例外）
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
        # 即使出錯也用 fallback，讓使用者可以手動編輯後寄出
        from app.services.ai_analyzer import get_fallback_result
        result = get_fallback_result()
        result["_error"] = str(e)

    session.ai_result = result
    ContactModel.increment_frequency(body.contact_id)

    return {"success": True, "result": result}


# ── 寄送郵件 ──

@app.post("/api/send")
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

    # 允許使用者覆寫 AI 產生的內容
    subject = body.subject or ai.get("subject", "掃描文件")
    email_body = body.body or ai.get("body", "附件為掃描文件，請查收。")
    filename = body.filename or ai.get("filename", "document.pdf")
    if not filename.endswith(".pdf"):
        filename += ".pdf"

    # 圖片轉 PDF（多頁優先）
    try:
        if session.pages:
            pdf_bytes = images_to_pdf(session.pages)
        else:
            pdf_bytes = image_to_pdf(session.image_data)
    except Exception as e:
        logger.error("圖片轉 PDF 失敗: %s", e)
        raise HTTPException(status_code=500, detail="圖片轉 PDF 失敗")

    # SMTP 寄送
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
        # 記錄歷史
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
        # 重置 session
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

@app.get("/api/contacts")
async def list_contacts(request: Request):
    user_id = get_user_id(request)
    return ContactModel.list_by_user(user_id, limit=50)

@app.post("/api/contacts")
async def create_contact(request: Request, body: ContactCreateRequest):
    user_id = get_user_id(request)
    contact_id = ContactModel.create(
        user_id=user_id, name=body.name, email=body.email,
        department=body.department, title=body.title,
    )
    return {"id": contact_id, "name": body.name, "email": body.email}

@app.delete("/api/contacts/{contact_id}")
async def delete_contact(request: Request, contact_id: int):
    user_id = get_user_id(request)
    contact = ContactModel.get_by_id(contact_id)
    if not contact or contact.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="聯絡人不存在")
    ContactModel.delete(contact_id)
    return {"success": True}


# ── 歷史 + 統計 ──

@app.get("/api/history")
async def get_history(request: Request):
    user_id = get_user_id(request)
    return HistoryModel.list_by_user(user_id)

@app.get("/api/stats")
async def get_stats(request: Request):
    user_id = get_user_id(request)
    return HistoryModel.get_stats(user_id)


# ── 寄件人設定 ──

@app.get("/api/settings")
async def get_sender_settings(request: Request):
    user_id = get_user_id(request)
    return SenderModel.get_or_default(user_id)

@app.post("/api/settings")
async def update_sender_settings(request: Request, body: SenderProfileRequest):
    user_id = get_user_id(request)
    SenderModel.upsert(
        user_id=user_id, name=body.name, email=body.email,
        title=body.title, department=body.department,
        organization=body.organization,
    )
    return {"success": True}


# ── 開發用 ──

@app.get("/api/test-prompt")
async def test_prompt():
    from app.services.ai_analyzer import SYSTEM_PROMPT
    return {"prompt": SYSTEM_PROMPT}
