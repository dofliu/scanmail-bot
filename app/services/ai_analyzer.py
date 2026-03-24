"""Gemini Vision API — 文件辨識與郵件內容產生"""
import json
import base64
import logging
from datetime import datetime
from typing import Optional
from app.config import get_settings

logger = logging.getLogger(__name__)

# System Prompt
SYSTEM_PROMPT = """你是一個專業的文件辨識與郵件撰寫助手，服務對象是台灣大學教職員。

## 任務
分析使用者拍攝的文件照片，產生適合寄送的電子郵件內容。

## 輸出格式（嚴格 JSON）
{
  "doc_type": "exam|official|receipt|contract|report|letter|form|other",
  "doc_type_label": "考卷|公文|收據|合約|報告|信函|表單|其他",
  "confidence": 0.95,
  "subject": "郵件標題 — 簡潔明確，包含文件類型和關鍵資訊",
  "body": "郵件正文 — 2-3句，正式但不過於生硬，說明附件內容",
  "filename": "有意義的檔名_日期.pdf",
  "extracted_text_summary": "文件內容摘要（50字內）",
  "detected_language": "zh-TW|en|mixed",
  "suggested_recipients": ["可能的收件對象描述"]
}

## 標題格式規則
1. [文件類型] + 主題 + 時間/學期（如適用）
   好：「材料力學期中考卷 — 114學年第2學期」
   好：「差旅費報銷單 — 2026/03 WindEurope 出差」
   差：「掃描文件」「Document」

## 正文語氣規則
1. 正式中文書信用語
   開頭：「檢附/附件為...」或「茲附上...」
   結尾：「請查收」「敬請核示」「如有疑問請隨時聯繫」
2. 根據收件人職級調整正式程度：
   - 上級/主管 → 「敬請核示」「惠請指教」
   - 同儕 → 「請查收」「請參考」
   - 行政人員 → 「煩請協助」「感謝處理」

## 檔名規則
1. 格式：[文件類型簡稱]_[關鍵內容摘要]_[年月日_時分].pdf
2. 避免空格，使用底線
3. 包含可辨識的關鍵字，讓收件者一目了然
4. 範例：公文_離岸風電審查會議改期_20260324_2104.pdf
5. 範例：考卷_材料力學期中考_20260324_0930.pdf
6. 範例：收據_差旅費報銷_20260320_1445.pdf

## 文件類型判斷依據
- 考卷(exam)：題目、配分、學號欄位、答案卷
- 公文(official)：發文字號、主旨、說明、辦法
- 收據(receipt)：金額、品項、日期、統一編號
- 合約(contract)：甲乙方、條款、簽章欄
- 報告(report)：章節結構、圖表、參考文獻
- 信函(letter)：稱謂、敬啟、署名
- 表單(form)：欄位、勾選、填寫區域

## 多語言處理
- 中文文件 → 中文郵件
- 英文文件 → 中文郵件（subject 可中英混合）
- 混合語言 → 以中文為主

## 安全規則
- 不在摘要中包含身分證字號、銀行帳號等敏感資訊
- 收據金額可提及但不列出完整帳號
- 若辨識到敏感資訊，在 body 中提醒使用者注意

只輸出 JSON，不要有其他文字。"""


USER_PROMPT_TEMPLATE = """請分析這張文件照片，產生適合寄送的電子郵件內容。

寄件人資訊：
- 姓名：{sender_name}
- 職稱：{sender_title}
- 單位：{sender_dept}

收件人資訊：
- 姓名：{recipient_name}
- 單位：{recipient_dept}
- Email：{recipient_email}

請根據文件內容和收件人身份，調整郵件的正式程度和用語。"""


import re

def _parse_json_response(text: str) -> dict:
    """從 AI 回應中穩健地提取 JSON（處理各種格式問題）"""

    # 策略 1：直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 策略 2：移除 markdown code block
    cleaned = re.sub(r'^```(?:json)?\s*\n?', '', text, flags=re.MULTILINE)
    cleaned = re.sub(r'\n?```\s*$', '', cleaned, flags=re.MULTILINE)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 策略 3：用正則找出最大的 {...} 區塊
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # 策略 4：修復常見問題（尾端逗號、未結束字串）
    if match:
        fixed = match.group()
        # 移除尾端逗號
        fixed = re.sub(r',\s*([}\]])', r'\1', fixed)
        try:
            return json.loads(fixed)
        except json.JSONDecodeError:
            pass

    # 策略 5：處理被截斷的 JSON（MAX_TOKENS 導致）
    # 找到以 { 開頭的文字，嘗試逐步修復
    brace_start = text.find('{')
    if brace_start >= 0:
        truncated = text[brace_start:]
        # 嘗試找到最後一個完整的 "key": "value" 或 "key": value
        # 先截斷到最後一個逗號或完整值之後
        last_complete = truncated
        # 移除尾端不完整的部分（最後一個未閉合的字串值）
        last_complete = re.sub(r',\s*"[^"]*"\s*:\s*"[^"]*$', '', last_complete)
        last_complete = re.sub(r',\s*"[^"]*"\s*:\s*\[[^\]]*$', '', last_complete)
        last_complete = re.sub(r',\s*"[^"]*"\s*:\s*$', '', last_complete)
        last_complete = re.sub(r',\s*"[^"]*$', '', last_complete)
        # 移除尾端逗號
        last_complete = re.sub(r',\s*$', '', last_complete)
        # 補上缺少的閉合括號
        open_braces = last_complete.count('{') - last_complete.count('}')
        open_brackets = last_complete.count('[') - last_complete.count(']')
        last_complete += ']' * max(0, open_brackets) + '}' * max(0, open_braces)
        try:
            result = json.loads(last_complete)
            logger.info("策略5：成功修復截斷的 JSON")
            return result
        except json.JSONDecodeError:
            pass

    # 全部失敗
    raise json.JSONDecodeError("無法從 AI 回應中提取有效 JSON", text, 0)


def get_fallback_result() -> dict:
    """AI 辨識失敗時的 Fallback 結果"""
    now = datetime.now()
    date_str = now.strftime("%Y%m%d_%H%M")
    return {
        "doc_type": "other",
        "doc_type_label": "文件",
        "confidence": 0.0,
        "subject": f"掃描文件 — {now.strftime('%Y/%m/%d')}",
        "body": "附件為掃描文件乙份，請查收。",
        "filename": f"掃描文件_{date_str}.pdf",
        "extracted_text_summary": "（AI 辨識失敗，請手動確認）",
        "detected_language": "zh-TW",
        "suggested_recipients": [],
    }


async def analyze_document(
    image_data: bytes,
    media_type: str,
    sender_info: dict,
    recipient_info: dict,
) -> dict:
    """使用 Gemini Vision API 分析文件圖片

    Args:
        image_data: 圖片二進位資料
        media_type: 圖片 MIME type (image/jpeg, image/png, etc.)
        sender_info: 寄件人資訊 dict (name, title, dept)
        recipient_info: 收件人資訊 dict (name, dept, email)

    Returns:
        AI 辨識結果 dict
    """
    settings = get_settings()

    if not settings.GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY 未設定")
        return get_fallback_result()

    # 組合 User Prompt
    user_prompt = USER_PROMPT_TEMPLATE.format(
        sender_name=sender_info.get("name", ""),
        sender_title=sender_info.get("title", ""),
        sender_dept=sender_info.get("department", ""),
        recipient_name=recipient_info.get("name", ""),
        recipient_dept=recipient_info.get("department", ""),
        recipient_email=recipient_info.get("email", ""),
    )

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)

        # 準備圖片
        image_part = types.Part.from_bytes(
            data=image_data,
            mime_type=media_type,
        )

        # ── 第一次嘗試：帶 response_mime_type ──
        response_text = ""
        try:
            response = client.models.generate_content(
                model=settings.AI_MODEL,
                contents=[image_part, user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=settings.AI_TEMPERATURE,
                    max_output_tokens=settings.AI_MAX_TOKENS,
                    response_mime_type="application/json",
                ),
            )
            # 診斷：記錄完整回應結構
            logger.info("AI response candidates 數量: %s",
                        len(response.candidates) if response.candidates else 0)
            if response.candidates:
                c = response.candidates[0]
                logger.info("AI finish_reason: %s", getattr(c, 'finish_reason', 'N/A'))
                if hasattr(c, 'safety_ratings') and c.safety_ratings:
                    for sr in c.safety_ratings:
                        logger.info("AI safety: %s = %s",
                                    getattr(sr, 'category', '?'),
                                    getattr(sr, 'probability', '?'))
            if hasattr(response, 'prompt_feedback') and response.prompt_feedback:
                logger.warning("AI prompt_feedback: %s", response.prompt_feedback)

            # 取得文字
            try:
                response_text = response.text or ""
            except Exception:
                # response.text 可能在被 block 時拋例外
                response_text = ""
                if response.candidates and response.candidates[0].content:
                    parts = response.candidates[0].content.parts
                    if parts:
                        response_text = parts[0].text or ""

            response_text = response_text.strip()
            logger.info("AI 原始回應 (前300字): [%s]", response_text[:300])

        except Exception as e1:
            logger.warning("帶 response_mime_type 呼叫失敗: %s，改用不帶 JSON mode", e1)
            response_text = ""

        # ── 第二次嘗試：不帶 response_mime_type（某些模型不支援）──
        if not response_text:
            logger.info("第一次回應為空，嘗試不使用 response_mime_type...")
            response = client.models.generate_content(
                model=settings.AI_MODEL,
                contents=[image_part, user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=settings.AI_TEMPERATURE,
                    max_output_tokens=settings.AI_MAX_TOKENS,
                ),
            )
            # 診斷
            logger.info("(retry) candidates 數量: %s",
                        len(response.candidates) if response.candidates else 0)
            if response.candidates:
                c = response.candidates[0]
                logger.info("(retry) finish_reason: %s", getattr(c, 'finish_reason', 'N/A'))

            try:
                response_text = response.text or ""
            except Exception:
                response_text = ""
                if response.candidates and response.candidates[0].content:
                    parts = response.candidates[0].content.parts
                    if parts:
                        response_text = parts[0].text or ""

            response_text = response_text.strip()
            logger.info("(retry) AI 原始回應 (前300字): [%s]", response_text[:300])

        if not response_text:
            logger.error("Gemini 兩次嘗試都返回空回應")
            return get_fallback_result()

        # 多重策略解析 JSON
        result = _parse_json_response(response_text)

        # 驗證必要欄位
        required_fields = ["doc_type", "subject", "body", "filename"]
        for field in required_fields:
            if field not in result:
                logger.warning("AI 回應缺少欄位: %s", field)
                return get_fallback_result()

        # 信心度過低警告
        if result.get("confidence", 0) < 0.3:
            logger.warning("AI 辨識信心度過低: %.2f", result["confidence"])
            result["_low_confidence_warning"] = True

        logger.info("AI 辨識完成: type=%s, confidence=%.2f",
                     result.get("doc_type"), result.get("confidence", 0))
        return result

    except json.JSONDecodeError as e:
        logger.error("AI 回應 JSON 解析失敗: %s", e)
        return get_fallback_result()
    except Exception as e:
        logger.error("Gemini API 錯誤: %s — %s", type(e).__name__, e)
        import traceback
        logger.error("Traceback: %s", traceback.format_exc())
        return get_fallback_result()
