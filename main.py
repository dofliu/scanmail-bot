"""ScanMail+ — 智慧文件處理平台 (FastAPI App Factory)"""
import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

# Explicitly register mime types to avoid Windows Registry overrides (.js served as text/plain)
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

from fastapi import FastAPI, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db
from app.core.file_manager import cleanup_temp_files
from app.utils.crypto import is_default_key, startup_secret_error
from app.core.rate_limiter import rate_limit
from app.core.auth import get_current_user
from app.routers import scanmail
from app.routers import image_tools
from app.routers import pdf_tools
from app.routers import doc_convert
from app.routers import gif_tools
from app.routers import video_tools
from app.routers import batch_rename
from app.routers import form_tools
from app.routers import auth

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("ScanMail+ 啟動中...")
    init_db()
    logger.info("資料庫初始化完成")
    # 開了認證卻還用公開的預設金鑰 → 直接不讓服務起來。
    # 那不是「不太理想」而是「認證等於不存在」，警告會被日誌淹掉。
    fatal = startup_secret_error()
    if fatal:
        logger.critical(fatal)
        raise RuntimeError(fatal)

    # 註冊窗口還開著就講出來 —— 這是一段「第一個註冊的人就是主人」的時間，
    # 知道它開著才有機會馬上把它用掉，或改設 REGISTRATION_TOKEN 關掉。
    if get_settings().ENABLE_AUTH:
        from app.models.user import UserModel
        if not get_settings().REGISTRATION_TOKEN and UserModel.count() == 0:
            logger.warning(
                "目前還沒有任何帳號 —— /api/auth/register 對第一個註冊的人開放。"
                "請盡快建立自己的帳號，或在 .env 設定 REGISTRATION_TOKEN 改用邀請碼。"
            )

    if is_default_key():
        logger.warning(
            "ENCRYPTION_KEY 仍為公開預設值 — SMTP 密碼等同未加密，"
            "而且一旦把 ENABLE_AUTH 打開，身分 Token 也會是可偽造的。"
            "正式部署請在 .env 設定獨立的 ENCRYPTION_KEY。"
        )

    # 離線 OCR 後端熱機
    try:
        from app.services.form_fill.backends import paddle_structure
        if paddle_structure.is_available():
            logger.info("檢測到本地 PaddleOCR，進行模型初始化熱機...")
            import numpy as np
            dummy_img = np.ones((10, 10, 3), dtype=np.uint8) * 255
            engine = paddle_structure.get_engine()
            engine(dummy_img)
            logger.info("PaddleOCR 模型熱機完成")
    except Exception as e:
        logger.warning("PaddleOCR 熱機失敗: %s", e)

    # 離線 HED 邊緣檢測模型下載與熱機
    try:
        from app.services.doc_scanner import _get_hed_net, ensure_hed_model
        logger.info("檢查並預載入 HED 邊緣檢測模型...")
        ensure_hed_model()
        net = _get_hed_net()
        if net is not None:
            logger.info("HED 邊緣檢測網路載入完成")
    except Exception as e:
        logger.warning("HED 邊緣檢測模型下載或熱機失敗: %s", e)

    # 離線 U-Net 語意分割模型下載與熱機
    try:
        from app.services.doc_scanner import _get_unet_net, ensure_unet_model
        logger.info("檢查並預載入 U-Net 語意分割模型...")
        ensure_unet_model()
        net = _get_unet_net()
        if net is not None:
            logger.info("U-Net 語意分割網路載入完成")
    except Exception as e:
        logger.warning("U-Net 語意分割模型下載或熱機失敗: %s", e)

    yield
    cleanup_temp_files()
    logger.info("ScanMail+ 關閉")


app = FastAPI(
    title="ScanMail+",
    description="智慧文件處理平台 — 掃描郵寄 + 多媒體工具",
    version="3.27.0",
    lifespan=lifespan,
)

# getattr fallback：測試會以僅含 DATABASE_PATH 的精簡 stub 取代 get_settings
_cors_origins = getattr(get_settings(), "cors_origins", ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # 以 X-User-Id header（非 cookie）識別，故 wildcard 來源時不啟用 credentials
    # （瀏覽器本就拒絕 "*" + credentials 的組合）
    allow_credentials=_cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 頁面路由（必須在 mount 之前）──

# Index will be served automatically by the root StaticFiles mount below.

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ScanMail+", "version": app.version}


# ── API 路由掛載 ──

# 身分驗證路由為公開存取（不需要 Token —— 它就是拿 Token 的地方），
# 但**不是不限流**：/register 與 /login 另外掛了只認來源 IP 的 auth_rate_limit
# （見 app/core/rate_limiter.py），這裡的 rate_limit 是給 /status、/logout 用的。
app.include_router(auth.router, prefix="/api/auth", tags=["auth"],
                   dependencies=[Depends(rate_limit)])

# 功能性路由均需驗證 Token (當 ENABLE_AUTH=True 時)
app.include_router(scanmail.router, prefix="/api", tags=["scanmail"], dependencies=[Depends(rate_limit), Depends(get_current_user)])
app.include_router(image_tools.router, prefix="/api/tools/image", tags=["image-tools"], dependencies=[Depends(rate_limit), Depends(get_current_user)])
app.include_router(pdf_tools.router, prefix="/api/tools/pdf", tags=["pdf-tools"], dependencies=[Depends(rate_limit), Depends(get_current_user)])
app.include_router(doc_convert.router, prefix="/api/tools/convert", tags=["doc-convert"], dependencies=[Depends(rate_limit), Depends(get_current_user)])
app.include_router(gif_tools.router, prefix="/api/tools/gif", tags=["gif-tools"], dependencies=[Depends(rate_limit), Depends(get_current_user)])
app.include_router(video_tools.router, prefix="/api/tools/video", tags=["video-tools"], dependencies=[Depends(rate_limit), Depends(get_current_user)])
app.include_router(batch_rename.router, prefix="/api/tools/rename", tags=["batch-rename"], dependencies=[Depends(rate_limit), Depends(get_current_user)])
app.include_router(form_tools.router, prefix="/api/tools/form", tags=["form-tools"], dependencies=[Depends(rate_limit), Depends(get_current_user)])


# ── 靜態檔案（必須放最後，否則會攔截其他路由）──

if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
