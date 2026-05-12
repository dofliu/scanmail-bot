"""穩健地從 LLM 回應中抽出 JSON。

LLM（特別是 Gemini / Claude）有時會：
- 包在 ```json``` markdown 區塊裡
- 多印幾句說明文字
- 因 MAX_TOKENS 截斷
- 用尾端逗號或單引號等不嚴格 JSON

這個工具用多重策略嘗試把 JSON 拉出來，全部失敗才拋 JSONDecodeError。

Usage:
    from app.services.common.json_parsing import parse_llm_json
    data = parse_llm_json(response_text)
"""
import json
import logging
import re

logger = logging.getLogger(__name__)


def parse_llm_json(text: str) -> dict:
    """從 LLM 回應中解析 JSON dict。

    依序嘗試 5 種策略，失敗才 raise JSONDecodeError。
    """
    if not text:
        raise json.JSONDecodeError("空字串", text, 0)

    # 策略 1：直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 策略 2：移除 markdown code block
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", text, flags=re.MULTILINE)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned, flags=re.MULTILINE)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 策略 3：用正則找出最大的 {...} 區塊
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

        # 策略 4：修復尾端逗號
        fixed = re.sub(r",\s*([}\]])", r"\1", match.group())
        try:
            return json.loads(fixed)
        except json.JSONDecodeError:
            pass

    # 策略 5：處理被截斷的 JSON（MAX_TOKENS 導致）
    brace_start = text.find("{")
    if brace_start >= 0:
        truncated = text[brace_start:]
        last_complete = truncated
        # 移除尾端不完整的 key:value 或 字串
        last_complete = re.sub(r',\s*"[^"]*"\s*:\s*"[^"]*$', "", last_complete)
        last_complete = re.sub(r',\s*"[^"]*"\s*:\s*\[[^\]]*$', "", last_complete)
        last_complete = re.sub(r',\s*"[^"]*"\s*:\s*$', "", last_complete)
        last_complete = re.sub(r',\s*"[^"]*$', "", last_complete)
        last_complete = re.sub(r",\s*$", "", last_complete)
        # 補上缺少的閉合括號
        open_braces = last_complete.count("{") - last_complete.count("}")
        open_brackets = last_complete.count("[") - last_complete.count("]")
        last_complete += "]" * max(0, open_brackets) + "}" * max(0, open_braces)
        try:
            result = json.loads(last_complete)
            logger.info("parse_llm_json 策略 5：成功修復截斷的 JSON")
            return result
        except json.JSONDecodeError:
            pass

    raise json.JSONDecodeError("無法從 LLM 回應中提取有效 JSON", text, 0)


def safe_parse_llm_json(text: str, default: dict | None = None) -> dict:
    """不會 raise 的版本 — 失敗時回傳 default（預設空 dict）並記 warning"""
    try:
        return parse_llm_json(text)
    except json.JSONDecodeError:
        preview = (text or "")[:200]
        logger.warning("LLM JSON 解析失敗，回傳 default。前 200 字：%s", preview)
        return default if default is not None else {}
