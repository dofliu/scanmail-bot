"""ScanMail+ — 智慧文件處理平台 (FastAPI App Factory)"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.core.file_manager import cleanup_temp_files
from app.routers import scanmail
from app.routers import image_tools
from app.routers import pdf_tools
from app.routers import doc_convert
from app.routers import gif_tools
from app.routers import video_tools
from app.routers import batch_rename

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
    yield
    cleanup_temp_files()
    logger.info("ScanMail+ 關閉")


app = FastAPI(
    title="ScanMail+",
    description="智慧文件處理平台 — 掃描郵寄 + 多媒體工具",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 頁面路由（必須在 mount 之前）──

@app.get("/")
async def serve_frontend():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file), media_type="text/html")
    return {"message": "ScanMail+ API — 請建立 static/index.html"}


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ScanMail+", "version": "3.1.0"}


# ── API 路由掛載 ──

app.include_router(scanmail.router, prefix="/api", tags=["scanmail"])
app.include_router(image_tools.router, prefix="/api/tools/image", tags=["image-tools"])
app.include_router(pdf_tools.router, prefix="/api/tools/pdf", tags=["pdf-tools"])
app.include_router(doc_convert.router, prefix="/api/tools/convert", tags=["doc-convert"])
app.include_router(gif_tools.router, prefix="/api/tools/gif", tags=["gif-tools"])
app.include_router(video_tools.router, prefix="/api/tools/video", tags=["video-tools"])
app.include_router(batch_rename.router, prefix="/api/tools/rename", tags=["batch-rename"])


# ── 靜態檔案（必須放最後，否則會攔截其他路由）──

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
