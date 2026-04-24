#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
封裝 AI 檔名重命名為可重用服務（供 UI / API 呼叫）。

預設行為符合需求：
- 僅處理「低資訊檔名」；僅掃描資料夾本層；影像可 OCR；以 Gemini 生成中文檔名並加民國日期前綴。
"""

from __future__ import annotations

import dataclasses
import os
from pathlib import Path
from typing import List, Optional, Set, Dict

from .ai_rename_gemini import (
    GeminiConfig,
    looks_low_info,
    extract_text_snippet,
    suggest_filename_with_gemini,
    roc_yyyMMdd_from_mtime,
    sanitize_filename,
    dedupe_path,
    _compile_patterns,  # type: ignore
)


@dataclasses.dataclass
class RenameSuggestion:
    src_path: str
    src_name: str
    dst_name: Optional[str]
    reason: str
    can_rename: bool
    message: Optional[str] = None


def preview_ai_renames(
    directory: str,
    *,
    only_exts: Optional[Set[str]] = None,
    include_pattern: Optional[str] = None,
    exclude_pattern: Optional[str] = None,
    google_api_key: Optional[str] = None,
    model: Optional[str] = None,
    debug: bool = False,
) -> List[RenameSuggestion]:
    """預覽 AI 重命名建議（不實際改名）。"""
    root = Path(directory).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"資料夾不存在：{root}")

    incl = _compile_patterns(include_pattern)
    excl = _compile_patterns(exclude_pattern)
    if only_exts:
        only_exts = {("." + s.strip().lower().lstrip(".")) for s in only_exts}

    cfg = GeminiConfig(
        api_key=(google_api_key or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY") or ""),
        model=(model or os.environ.get("GEMINI_MODEL", os.environ.get("GOOGLE_MODEL", "gemini-3-flash-preview"))),
    )
    if not cfg.api_key:
        raise RuntimeError("缺少 Google API Key（環境變數 GOOGLE_API_KEY/GEMINI_API_KEY 或參數）")

    files = [p for p in root.glob("*") if p.is_file()]
    out: List[RenameSuggestion] = []
    for src in files:
        if only_exts and src.suffix.lower() not in only_exts:
            if debug:
                out.append(RenameSuggestion(str(src), src.name, None, "skip-ext", False, message=f"{src.suffix.lower()} 不在 {sorted(only_exts)}"))
            continue
        if not looks_low_info(src.stem, include=incl, exclude=excl):
            if debug:
                out.append(RenameSuggestion(str(src), src.name, None, "not-low", False, message="檔名看起來已有語義"))
            continue

        snippet = extract_text_snippet(src)
        if not snippet:
            out.append(RenameSuggestion(str(src), src.name, None, "no-content:low-info", False, message="抽不到內容（需 OCR/解析）"))
            continue

        try:
            base = suggest_filename_with_gemini(snippet, cfg)
        except Exception as e:
            out.append(RenameSuggestion(str(src), src.name, None, "llm-fail:low-info", False, message=str(e)))
            continue

        prefix = roc_yyyMMdd_from_mtime(src)
        new_stem = f"{prefix}-{base}"
        new_name = sanitize_filename(new_stem) + src.suffix
        out.append(RenameSuggestion(str(src), src.name, new_name, "ok", True, None))
    return out


def apply_ai_renames(suggestions: List[RenameSuggestion]) -> List[Dict[str, str]]:
    """依據建議清單執行改名，回傳結果列（src->dst/錯誤）。"""
    results: List[Dict[str, str]] = []
    for s in suggestions:
        if not s.can_rename or not s.dst_name:
            results.append({"src": s.src_name, "result": "skipped", "reason": s.reason})
            continue
        src = Path(s.src_path)
        if not src.exists() or not src.is_file():
            results.append({"src": s.src_name, "result": "error", "error": "source-missing"})
            continue
        dst = dedupe_path(src.with_name(s.dst_name))
        try:
            os.replace(src, dst)
            results.append({"src": s.src_name, "dst": dst.name, "result": "renamed"})
        except Exception as e:
            results.append({"src": s.src_name, "dst": dst.name, "result": "error", "error": str(e)})
    return results

