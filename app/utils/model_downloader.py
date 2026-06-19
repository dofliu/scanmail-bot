"""模型下載與雜湊驗證工具"""
import hashlib
import logging
import time
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

MODELS_DIR = Path("data/models")


def download_file(url: str, dest_path: Path, expected_sha256: str = None, retries: int = 3) -> bool:
    """下載檔案並驗證 SHA256 雜湊值
    
    支援重試機制。若本地已存在且雜湊值符合，則直接跳過下載。
    """
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    # 1. 檢查本地檔案是否已存在且完整
    if dest_path.exists():
        if expected_sha256:
            logger.info("檔案 %s 已存在，正在驗證雜湊值...", dest_path.name)
            if verify_sha256(dest_path, expected_sha256):
                logger.info("檔案 %s 雜湊驗證通過，跳過下載", dest_path.name)
                return True
            else:
                logger.warning("檔案 %s 雜湊值不符，將重新下載", dest_path.name)
                dest_path.unlink(missing_ok=True)
        else:
            logger.info("檔案 %s 已存在，跳過下載（未指定雜湊校驗）", dest_path.name)
            return True

    # 2. 開始下載（帶重試機制）
    for attempt in range(1, retries + 1):
        logger.info("開始下載 %s (嘗試 %d/%d)...", url, attempt, retries)
        try:
            # 建立帶 User-Agent header 的請求以避免被伺服器阻擋
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "ScanMailBot/3.3 (Python/urllib)"}
            )
            
            with urllib.request.urlopen(req, timeout=15) as response:
                content_length = response.getheader("Content-Length")
                total_size = int(content_length) if content_length else 0
                
                # 建立暫存檔
                temp_path = dest_path.with_suffix(".tmp")
                temp_path.unlink(missing_ok=True)
                
                downloaded = 0
                block_size = 1024 * 1024  # 1 MB
                last_log_time = time.time()
                
                with open(temp_path, "wb") as f:
                    while True:
                        block = response.read(block_size)
                        if not block:
                            break
                        f.write(block)
                        downloaded += len(block)
                        
                        # 每隔 2 秒或下載完成時輸出進度
                        now = time.time()
                        if now - last_log_time > 2.0 or downloaded == total_size:
                            if total_size > 0:
                                percent = (downloaded / total_size) * 100
                                logger.info(
                                    "下載進度 %s: %.1f%% (%d/%d MB)",
                                    dest_path.name,
                                    percent,
                                    downloaded // (1024 * 1024),
                                    total_size // (1024 * 1024)
                                )
                            else:
                                logger.info(
                                    "已下載 %s: %d KB",
                                    dest_path.name,
                                    downloaded // 1024
                                )
                            last_log_time = now
                            
                # 移動暫存檔至正式路徑
                temp_path.rename(dest_path)
                logger.info("檔案 %s 下載完成", dest_path.name)
                
                # 3. 驗證雜湊值
                if expected_sha256:
                    if verify_sha256(dest_path, expected_sha256):
                        logger.info("檔案 %s 下載後雜湊驗證成功", dest_path.name)
                        return True
                    else:
                        logger.error("檔案 %s 下載後雜湊驗證失敗！將移除損壞檔案", dest_path.name)
                        dest_path.unlink(missing_ok=True)
                else:
                    return True
                    
        except Exception as e:
            logger.error("下載 %s 失敗 (嘗試 %d/%d): %s", dest_path.name, attempt, retries, e)
            if attempt < retries:
                time.sleep(2)
                
    return False


def verify_sha256(file_path: Path, expected_sha256: str) -> bool:
    """計算檔案的 SHA256 並與預期值比對"""
    sha256_hash = hashlib.sha256()
    try:
        with open(file_path, "rb") as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        actual_sha256 = sha256_hash.hexdigest().lower()
        return actual_sha256 == expected_sha256.lower()
    except Exception as e:
        logger.error("計算檔案 %s 雜湊值時發生錯誤: %s", file_path, e)
        return False
