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
1. 中文描述_年月日.pdf
2. 避免空格，使用底線
3. 包含可辨識的關鍵字
4. 範例：材力_期中考卷_20260324.pdf

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


def get_fallback_result() -> dict:
    """AI 辨識失敗時的 Fallback 結果"""
    date_str = datetime.now().strftime("%Y%m%d")
    return {
        "doc_type": "other",
        "doc_type_label": "文件",
        "confidence": 0.0,
        "subject": f"掃描文件 — {datetime.now().strftime('%Y/%m/%d')}",
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

        # 呼叫 Gemini Vision
        response = client.models.generate_content(
            model=settings.AI_MODEL,
            contents=[image_part, user_prompt],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=settings.AI_TEMPERATURE,
                max_output_tokens=settings.AI_MAX_TOKENS,
            ),
        )
        response_text = response.text.strip()

        # 嘗試解析 JSON（可能被包在 markdown code block 裡）
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            # 移除第一行 (```json) 和最後一行 (```)
            response_text = "\n".join(
                line for line in lines
                if not line.strip().startswith("```")
            )

        result = json.loads(response_text)

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
        logger.error("Gemini API 錯誤: %s", e)
        return get_fallback_result()
