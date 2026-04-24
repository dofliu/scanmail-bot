"""AI 智慧改名 — 本機路徑模式

為什麼：這支服務在使用者本機跑；server = client = 同一台電腦，可以直接對
目標資料夾做 preview / rename，不必走「上傳→ZIP 下載」。
既有 `tools.ai_rename_service` 本就是路徑導向，這裡薄薄一層橋接把
pydantic-settings 的 API Key 注入進去並序列化結果。
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from app.config import get_settings
from tools.ai_rename_service import (
    RenameSuggestion,
    preview_ai_renames,
)
from tools.ai_rename_gemini import dedupe_path

logger = logging.getLogger(__name__)


def _resolve_gemini_creds() -> tuple[str, str]:
    """為什麼：pydantic-settings 載入 .env 時不會注入 os.environ，
    所以必須明示把 API Key 與模型傳給 tools 層。"""
    s = get_settings()
    key = s.GEMINI_API_KEY or ""
    model = s.AI_MODEL or "gemini-2.0-flash"
    return key, model


def _parse_only_exts(spec: Optional[str]) -> Optional[set[str]]:
    if not spec:
        return None
    parts = [s.strip().lower().lstrip(".") for s in spec.replace(";", ",").split(",") if s.strip()]
    return {"." + s for s in parts} if parts else None


def scan_directory(directory: str, only_exts: Optional[str] = None) -> list[dict]:
    """掃描本機資料夾，回傳 AI 改名建議（純預覽，不動檔案）。"""
    exts = _parse_only_exts(only_exts)
    key, model = _resolve_gemini_creds()

    suggestions: list[RenameSuggestion] = preview_ai_renames(
        directory,
        only_exts=exts,
        google_api_key=key,
        model=model,
        debug=True,  # 略過原因一併回傳，UI 可顯示
    )

    results: list[dict] = []
    for s in suggestions:
        results.append({
            "src_path": s.src_path,
            "original": s.src_name,
            "renamed": s.dst_name or s.src_name,
            "changed": bool(s.can_rename and s.dst_name and s.dst_name != s.src_name),
            "can_rename": s.can_rename,
            "reason": s.reason,
            "message": s.message or "",
        })
    return results


def apply_renames(items: list[dict]) -> list[dict]:
    """依使用者確認後的清單直接改名。

    items: [{'src_path': 絕對路徑, 'dst_name': 新檔名（含副檔名）}, ...]
    """
    out: list[dict] = []
    for it in items:
        src_str = it.get("src_path") or ""
        dst_name = it.get("dst_name") or ""
        src = Path(src_str)
        if not dst_name or not src_str:
            out.append({"original": src.name, "result": "error", "error": "missing-fields"})
            continue
        if not src.exists() or not src.is_file():
            out.append({"original": src.name, "result": "error", "error": "source-missing"})
            continue
        if dst_name == src.name:
            out.append({"original": src.name, "result": "skipped", "reason": "same-name"})
            continue
        dst = dedupe_path(src.with_name(dst_name))
        try:
            os.replace(src, dst)
            out.append({"original": src.name, "renamed": dst.name, "result": "renamed"})
        except Exception as e:
            out.append({"original": src.name, "renamed": dst.name, "result": "error", "error": str(e)})
    return out
