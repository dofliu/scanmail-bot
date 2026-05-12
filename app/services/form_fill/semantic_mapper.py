"""Semantic Mapper — 把表單欄位 label 對應到使用者既有資料

策略：
1. Rule-based fast path：關鍵字/regex 命中即返回（涵蓋 80% 常見表單）
2. LLM-assisted fallback：奇怪命名才丟給 Gemini（TODO，M5 階段）
"""
import re
import logging
from datetime import date
from typing import Optional

from app.services.form_fill.schema import FormField

logger = logging.getLogger(__name__)


# Label 關鍵字 → semantic_key
# 順序很重要：越具體的規則放越前面
_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"電子郵件|E[\-_ ]?mail|電郵|信箱", re.IGNORECASE), "sender.email"),
    (re.compile(r"職稱|頭銜|Title", re.IGNORECASE), "sender.title"),
    (re.compile(r"單位|部門|系所|Department|Dept", re.IGNORECASE), "sender.department"),
    (re.compile(r"學校|機關|組織|Organization|Institution", re.IGNORECASE), "sender.organization"),
    (re.compile(r"姓名|申請人|填表人|Name(?!.*Group)", re.IGNORECASE), "sender.name"),
    (re.compile(r"日期|填表日|Date", re.IGNORECASE), "today"),
    (re.compile(r"電話|手機|聯絡|Phone|Tel|Mobile", re.IGNORECASE), "contact.phone"),
    (re.compile(r"地址|Address", re.IGNORECASE), "contact.address"),
]


def suggest_values(
    fields: list[FormField],
    sender_profile: dict,
    contact: Optional[dict] = None,
) -> dict:
    """對欄位清單套用 semantic mapping，回傳建議值

    Args:
        fields: 偵測到的欄位
        sender_profile: 寄件人資料（來自 SenderModel.get_or_default）
        contact: 選用的聯絡人資料

    Returns:
        {field_name: suggested_value}
    """
    out: dict = {}
    today_str = date.today().isoformat()

    for f in fields:
        key = _match_semantic_key(f.label)
        if not key:
            continue
        value = _resolve_value(key, sender_profile, contact, today_str)
        if value:
            out[f.name] = value
            f.semantic_key = key
            f.suggested_value = value

    logger.info("Semantic mapping: %d / %d fields matched", len(out), len(fields))
    return out


def _match_semantic_key(label: str) -> Optional[str]:
    for pattern, key in _RULES:
        if pattern.search(label):
            return key
    return None


def _resolve_value(
    key: str,
    sender: dict,
    contact: Optional[dict],
    today_str: str,
) -> Optional[str]:
    if key == "today":
        return today_str
    if key.startswith("sender."):
        return sender.get(key.split(".", 1)[1]) or None
    if key.startswith("contact.") and contact:
        return contact.get(key.split(".", 1)[1]) or None
    return None
