"""暫存檔案管理 — 上傳/下載/自動清理"""
import io
import logging
import re
import time
import uuid
from pathlib import Path
from typing import Optional

from PIL import Image

logger = logging.getLogger(__name__)

# 暫存目錄
TEMP_DIR = Path(__file__).parent.parent.parent / "temp"
TEMP_DIR.mkdir(exist_ok=True)

# 檔案存活時間（秒）
FILE_TTL = 30 * 60  # 30 分鐘

# 安全 filename pattern：save_temp_file 產生的 uuid4().hex + 副檔名
# 用於防止 get_temp_path 接到使用者輸入時被路徑穿越攻擊
_SAFE_FILENAME = re.compile(r"^[a-f0-9]{32}(\.[a-z0-9]{1,8})?$")


def save_temp_file(data: bytes, suffix: str = ".bin") -> Path:
    """儲存暫存檔案，回傳路徑"""
    filename = f"{uuid.uuid4().hex}{suffix}"
    path = TEMP_DIR / filename
    path.write_bytes(data)
    logger.info("暫存檔案已建立: %s (%d bytes)", filename, len(data))
    return path


def get_temp_path(filename: str) -> Optional[Path]:
    """取得暫存檔案路徑（驗證檔案存在且位於 TEMP_DIR 內）

    防禦：拒絕不符合 save_temp_file 命名格式的 filename，
    並驗證 resolve 後仍位於 TEMP_DIR 之下（防路徑穿越）。
    """
    if not filename or not _SAFE_FILENAME.match(filename):
        logger.warning("get_temp_path 拒絕不安全的 filename: %r", filename)
        return None

    path = TEMP_DIR / filename
    try:
        resolved = path.resolve()
        resolved.relative_to(TEMP_DIR.resolve())
    except (ValueError, OSError):
        logger.warning("get_temp_path 拒絕逃出 TEMP_DIR 的路徑: %s", filename)
        return None

    if resolved.exists() and resolved.is_file():
        return resolved
    return None


def cleanup_temp_files():
    """清理過期暫存檔案"""
    now = time.time()
    count = 0
    for f in TEMP_DIR.iterdir():
        if f.is_file() and (now - f.stat().st_mtime) > FILE_TTL:
            f.unlink(missing_ok=True)
            count += 1
    if count:
        logger.info("已清理 %d 個過期暫存檔案", count)


def make_thumbnail(image_data: bytes, max_dim: int = 200) -> bytes:
    """產生小縮圖"""
    img = Image.open(io.BytesIO(image_data))
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()
