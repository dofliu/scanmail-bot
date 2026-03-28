"""影片處理 — 合併、影片轉 GIF、壓縮

從 myPicasa VideoMergeWorker / VideoToGifWorker 移植。
使用 moviepy 封裝 ffmpeg。
"""
import io
import logging
import tempfile
from pathlib import Path
from typing import Optional

from app.core.tasks import update_task_progress
from app.core.file_manager import TEMP_DIR

logger = logging.getLogger(__name__)

# 支援的影片格式
SUPPORTED_VIDEO_FORMATS = {"mp4", "avi", "mov", "mkv", "webm", "flv"}


def merge_videos(task_id: str, videos: list[tuple[str, bytes]],
                 output_format: str = "mp4") -> bytes:
    """合併多個影片

    Args:
        videos: [(filename, bytes), ...]
        output_format: 輸出格式

    Returns:
        合併後的影片 bytes
    """
    from moviepy import VideoFileClip, concatenate_videoclips

    if len(videos) < 2:
        raise ValueError("至少需要 2 個影片")

    total = len(videos)
    temp_files = []
    clips = []

    try:
        # 先寫入暫存檔（moviepy 需要檔案路徑）
        for i, (name, data) in enumerate(videos):
            update_task_progress(task_id, int((i / total) * 30),
                                 f"載入 ({i+1}/{total}): {name}")
            ext = Path(name).suffix or ".mp4"
            tmp = tempfile.NamedTemporaryFile(suffix=ext, dir=str(TEMP_DIR), delete=False)
            tmp.write(data)
            tmp.close()
            temp_files.append(tmp.name)
            clips.append(VideoFileClip(tmp.name))

        update_task_progress(task_id, 40, "正在合併...")

        final = concatenate_videoclips(clips, method="compose")

        output_path = str(TEMP_DIR / f"merged_{task_id}.{output_format}")
        final.write_videofile(
            output_path,
            codec="libx264",
            audio_codec="aac",
            logger=None,
        )
        final.close()

        update_task_progress(task_id, 95, "讀取結果...")
        result = Path(output_path).read_bytes()
        Path(output_path).unlink(missing_ok=True)

        logger.info("影片合併完成: %d 個, %d bytes", total, len(result))
        return result

    finally:
        for c in clips:
            try:
                c.close()
            except Exception:
                pass
        for f in temp_files:
            Path(f).unlink(missing_ok=True)


def video_to_gif(task_id: str, video_data: bytes,
                 fps: int = 10, width: int = 0,
                 start_time: float = 0, end_time: float = 0) -> bytes:
    """影片轉 GIF

    Args:
        fps: GIF 幀率
        width: 輸出寬度（0 = 原始寬度的一半）
        start_time/end_time: 截取範圍（秒，0 = 全部）
    """
    from moviepy import VideoFileClip

    # 寫入暫存
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", dir=str(TEMP_DIR), delete=False)
    tmp.write(video_data)
    tmp.close()

    try:
        update_task_progress(task_id, 10, "載入影片...")
        clip = VideoFileClip(tmp.name)

        # 截取範圍
        if start_time > 0 or end_time > 0:
            end = end_time if end_time > start_time else clip.duration
            clip = clip.subclipped(start_time, min(end, clip.duration))

        # 縮放
        target_w = width if width > 0 else clip.w // 2
        if target_w != clip.w:
            clip = clip.resized(width=target_w)

        update_task_progress(task_id, 30, "轉換中...")

        output_path = str(TEMP_DIR / f"gif_{task_id}.gif")
        clip.write_gif(output_path, fps=fps, logger=None)
        clip.close()

        update_task_progress(task_id, 95, "讀取結果...")
        result = Path(output_path).read_bytes()
        Path(output_path).unlink(missing_ok=True)

        logger.info("影片→GIF 完成: %d bytes", len(result))
        return result

    finally:
        Path(tmp.name).unlink(missing_ok=True)


def compress_video(task_id: str, video_data: bytes,
                   target_resolution: str = "",
                   crf: int = 28) -> bytes:
    """壓縮影片

    Args:
        target_resolution: "720p", "480p", "360p" 或 空字串（維持原解析度）
        crf: 品質參數（18=高品質, 28=中等, 35=低品質）
    """
    from moviepy import VideoFileClip

    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", dir=str(TEMP_DIR), delete=False)
    tmp.write(video_data)
    tmp.close()

    try:
        update_task_progress(task_id, 10, "載入影片...")
        clip = VideoFileClip(tmp.name)

        # 調整解析度
        res_map = {"720p": 720, "480p": 480, "360p": 360}
        target_h = res_map.get(target_resolution, 0)
        if target_h > 0 and clip.h > target_h:
            clip = clip.resized(height=target_h)

        update_task_progress(task_id, 30, "壓縮中...")

        output_path = str(TEMP_DIR / f"compressed_{task_id}.mp4")
        clip.write_videofile(
            output_path,
            codec="libx264",
            audio_codec="aac",
            ffmpeg_params=["-crf", str(crf)],
            logger=None,
        )
        clip.close()

        update_task_progress(task_id, 95, "讀取結果...")
        result = Path(output_path).read_bytes()
        Path(output_path).unlink(missing_ok=True)

        logger.info("影片壓縮完成: %d bytes (CRF=%d)", len(result), crf)
        return result

    finally:
        Path(tmp.name).unlink(missing_ok=True)
