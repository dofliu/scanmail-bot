"""驗證工具函式"""
import re


def validate_email(email: str) -> bool:
    """驗證 Email 格式"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def validate_image_size(data: bytes, max_mb: int = 10) -> bool:
    """驗證圖片大小"""
    return len(data) <= max_mb * 1024 * 1024


def sanitize_filename(filename: str) -> str:
    """清理檔案名稱"""
    # 移除不安全字元
    safe = re.sub(r'[<>:"/\\|?*]', '_', filename)
    # 確保 .pdf 結尾
    if not safe.endswith('.pdf'):
        safe += '.pdf'
    return safe
