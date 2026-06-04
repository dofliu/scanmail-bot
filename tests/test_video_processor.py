"""
tests/test_video_processor.py
單元測試 — video_processor 模組（mock moviepy 避免 ffmpeg 依賴）
"""
import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _fake_video_bytes(label: str = "v") -> bytes:
    """產生假的影片 bytes（內容不重要，moviepy 被 mock）"""
    return f"FAKEVIDEO_{label}".encode()


def _make_mock_clip(duration: float = 5.0, size: tuple = (1920, 1080),
                    fps: int = 30):
    """建立一個 mock VideoFileClip 物件"""
    clip = MagicMock()
    clip.duration = duration
    clip.size = size
    clip.fps = fps
    clip.w, clip.h = size
    clip.resize.return_value = clip
    clip.resized.return_value = clip
    clip.subclipped.return_value = clip
    clip.close = MagicMock()

    # write_videofile / write_gif：寫入假資料到目標路徑
    def fake_write_videofile(path, **kwargs):
        with open(path, "wb") as f:
            f.write(b"MERGED_VIDEO_DATA")

    def fake_write_gif(path, **kwargs):
        with open(path, "wb") as f:
            f.write(b"GIF89a_FAKE")

    clip.write_videofile = MagicMock(side_effect=fake_write_videofile)
    clip.write_gif = MagicMock(side_effect=fake_write_gif)
    return clip


# ===========================================================================
class TestMergeVideos:
    """video_processor.merge_videos"""

    @patch("app.services.video_processor.update_task_progress")
    def test_merge_two_videos(self, mock_progress):
        mock_clip = _make_mock_clip()
        mock_concat = MagicMock(return_value=mock_clip)

        # patch moviepy 模組層級（因為 lazy import 在函式內）
        with patch.dict("sys.modules", {
            "moviepy": MagicMock(
                VideoFileClip=MagicMock(return_value=mock_clip),
                concatenate_videoclips=mock_concat,
            )
        }):
            # 重新 import 以使用 patched moviepy
            from app.services.video_processor import merge_videos
            videos = [("a.mp4", _fake_video_bytes("a")),
                      ("b.mp4", _fake_video_bytes("b"))]
            result = merge_videos("task-1", videos, output_format="mp4")

        assert isinstance(result, bytes)
        assert len(result) > 0
        assert mock_concat.called
        mock_progress.assert_called()

    def test_merge_less_than_two_raises(self):
        from app.services.video_processor import merge_videos
        with pytest.raises(ValueError, match="至少需要 2 個影片"):
            merge_videos("task-err", [("a.mp4", b"data")])

    @patch("app.services.video_processor.update_task_progress")
    def test_merge_three_videos(self, mock_progress):
        mock_clip = _make_mock_clip()
        mock_concat = MagicMock(return_value=mock_clip)

        with patch.dict("sys.modules", {
            "moviepy": MagicMock(
                VideoFileClip=MagicMock(return_value=mock_clip),
                concatenate_videoclips=mock_concat,
            )
        }):
            from app.services.video_processor import merge_videos
            videos = [("a.mp4", b"a"), ("b.mp4", b"b"), ("c.mp4", b"c")]
            result = merge_videos("task-3", videos)

        assert isinstance(result, bytes)
        assert mock_concat.called


class TestVideoToGif:
    """video_processor.video_to_gif"""

    @patch("app.services.video_processor.update_task_progress")
    def test_basic_conversion(self, mock_progress):
        mock_clip = _make_mock_clip(duration=10.0)

        with patch.dict("sys.modules", {
            "moviepy": MagicMock(
                VideoFileClip=MagicMock(return_value=mock_clip),
            )
        }):
            from app.services.video_processor import video_to_gif
            result = video_to_gif("task-gif", _fake_video_bytes(), fps=10)

        assert isinstance(result, bytes)
        assert len(result) > 0

    @patch("app.services.video_processor.update_task_progress")
    def test_with_time_range(self, mock_progress):
        mock_clip = _make_mock_clip(duration=30.0)

        with patch.dict("sys.modules", {
            "moviepy": MagicMock(
                VideoFileClip=MagicMock(return_value=mock_clip),
            )
        }):
            from app.services.video_processor import video_to_gif
            result = video_to_gif("task-gif2", _fake_video_bytes(),
                                  start_time=5.0, end_time=15.0)

        assert isinstance(result, bytes)
        mock_clip.subclipped.assert_called()


class TestCompressVideo:
    """video_processor.compress_video"""

    @patch("app.services.video_processor.update_task_progress")
    def test_default_compression(self, mock_progress):
        mock_clip = _make_mock_clip()

        with patch.dict("sys.modules", {
            "moviepy": MagicMock(
                VideoFileClip=MagicMock(return_value=mock_clip),
            )
        }):
            from app.services.video_processor import compress_video
            result = compress_video("task-cmp", _fake_video_bytes())

        assert isinstance(result, bytes)
        assert len(result) > 0

    @patch("app.services.video_processor.update_task_progress")
    def test_720p_resolution(self, mock_progress):
        mock_clip = _make_mock_clip(size=(1920, 1080))
        mock_clip.h = 1080

        with patch.dict("sys.modules", {
            "moviepy": MagicMock(
                VideoFileClip=MagicMock(return_value=mock_clip),
            )
        }):
            from app.services.video_processor import compress_video
            result = compress_video("task-720", _fake_video_bytes(),
                                    target_resolution="720p")

        assert isinstance(result, bytes)
        mock_clip.resized.assert_called()
