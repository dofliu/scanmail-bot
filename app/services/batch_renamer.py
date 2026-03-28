"""批次改名 — 前綴/後綴/編號/取代規則

純邏輯運算，不實際修改檔案。
前端上傳檔案名稱列表 → 回傳改名預覽 → 確認後打包 ZIP。
"""
import io
import logging
import re
import zipfile
from pathlib import Path

from app.core.tasks import update_task_progress

logger = logging.getLogger(__name__)


def preview_rename(filenames: list[str],
                   prefix: str = "",
                   suffix: str = "",
                   find: str = "",
                   replace: str = "",
                   numbering: bool = False,
                   numbering_start: int = 1,
                   numbering_digits: int = 3,
                   numbering_position: str = "prefix") -> list[dict]:
    """預覽改名結果（不實際改檔案）

    Args:
        filenames: 原始檔名列表
        prefix: 前綴文字
        suffix: 後綴文字（加在副檔名之前）
        find: 搜尋文字
        replace: 取代文字
        numbering: 是否加編號
        numbering_start: 編號起始值
        numbering_digits: 編號位數（零填充）
        numbering_position: "prefix" 或 "suffix"

    Returns:
        [{"original": "a.jpg", "renamed": "001_a.jpg"}, ...]
    """
    results = []
    for i, name in enumerate(filenames):
        stem = Path(name).stem
        ext = Path(name).suffix

        new_stem = stem

        # 1. 搜尋取代
        if find:
            new_stem = new_stem.replace(find, replace)

        # 2. 前綴/後綴
        if prefix:
            new_stem = prefix + new_stem
        if suffix:
            new_stem = new_stem + suffix

        # 3. 編號
        if numbering:
            num = str(numbering_start + i).zfill(numbering_digits)
            if numbering_position == "prefix":
                new_stem = f"{num}_{new_stem}"
            else:
                new_stem = f"{new_stem}_{num}"

        new_name = new_stem + ext
        results.append({
            "original": name,
            "renamed": new_name,
            "changed": name != new_name,
        })

    return results


def apply_rename(task_id: str,
                 files: list[tuple[str, bytes]],
                 rename_map: list[dict]) -> bytes:
    """將檔案以新名稱打包成 ZIP

    Args:
        files: [(original_name, bytes), ...]
        rename_map: preview_rename 的結果
    """
    total = len(files)
    name_lookup = {item["original"]: item["renamed"] for item in rename_map}

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, (name, data) in enumerate(files):
            update_task_progress(task_id, int((i / total) * 95),
                                 f"打包中 ({i+1}/{total})")
            new_name = name_lookup.get(name, name)
            zf.writestr(new_name, data)

    update_task_progress(task_id, 98, "完成打包")
    return zip_buf.getvalue()
