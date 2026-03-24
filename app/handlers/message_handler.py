"""圖片與文字訊息處理器"""
import re
import logging
from linebot.v3.messaging import (
    ApiClient,
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
    FlexMessage,
    FlexContainer,
    QuickReply,
)
from app.models.session import SessionModel
from app.models.contact import ContactModel
from app.services.flex_builder import build_contact_quick_reply
from app.utils.validators import validate_email

logger = logging.getLogger(__name__)


async def handle_image_message(event, line_api: MessagingApi, line_api_blob):
    """處理圖片訊息"""
    user_id = event.source.user_id
    message_id = event.message.id

    # 取得或建立 session
    session = SessionModel.get_or_create(user_id)

    # 下載圖片
    try:
        response = line_api_blob.get_message_content(message_id)
        image_data = response
    except Exception as e:
        logger.error("圖片下載失敗: %s", e)
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text="圖片下載失敗，請重新傳送 📷")],
            )
        )
        return

    # 驗證圖片大小
    from app.services.image_processor import validate_image
    is_valid, error_msg = validate_image(image_data)
    if not is_valid:
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=error_msg)],
            )
        )
        return

    # 儲存圖片到 session
    SessionModel.get_or_create(user_id)
    SessionModel.set_image(user_id, image_data)
    SessionModel.transition(user_id, "awaiting_contact")

    # 取得聯絡人列表
    contacts = ContactModel.list_by_user(user_id)

    if contacts:
        quick_reply = build_contact_quick_reply(contacts)
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[
                    TextMessage(
                        text="📷 圖片收到！請選擇收件人：",
                        quick_reply=QuickReply.from_dict(quick_reply),
                    )
                ],
            )
        )
    else:
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[
                    TextMessage(
                        text="📷 圖片收到！\n\n"
                             "您尚未建立聯絡人，請直接輸入收件人資訊：\n"
                             "格式：姓名 email\n"
                             "範例：王大明 wang@ncut.edu.tw",
                    )
                ],
            )
        )


async def handle_text_message(event, line_api: MessagingApi):
    """處理文字訊息（依 session 狀態路由）"""
    user_id = event.source.user_id
    text = event.message.text.strip()
    session = SessionModel.get_or_create(user_id)
    state = session["state"]

    # 全域指令（任何狀態都可觸發）
    from app.handlers.command_handler import handle_command
    if await handle_command(event, line_api, text):
        return

    # 依狀態路由
    if state == "awaiting_contact":
        await _handle_contact_input(event, line_api, text, user_id)
    elif state == "editing":
        await _handle_edit_input(event, line_api, text, user_id, session)
    elif state == "idle":
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[
                    TextMessage(
                        text="請拍照或上傳文件圖片開始掃描 📷\n"
                             "或輸入「說明」查看使用方式。"
                    )
                ],
            )
        )
    else:
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text="處理中，請稍候... ⏳")],
            )
        )


async def _handle_contact_input(event, line_api, text: str, user_id: str):
    """處理聯絡人輸入（awaiting_contact 狀態）"""
    # 解析格式: "姓名 email" 或 "姓名 email 單位 職稱"
    parts = text.split()
    if len(parts) >= 2 and validate_email(parts[1]):
        name = parts[0]
        email = parts[1]
        department = parts[2] if len(parts) > 2 else ""
        title = parts[3] if len(parts) > 3 else ""

        contact_id = ContactModel.create(
            user_id, name, email, department, title
        )
        SessionModel.set_contact(user_id, contact_id)
        SessionModel.transition(user_id, "processing")

        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=f"收件人：{name} ({email})\n\n🤖 AI 辨識中，請稍候...")],
            )
        )

        # 觸發 AI 分析（非同步）
        import asyncio
        asyncio.create_task(_process_ai_analysis(user_id, contact_id, line_api))
    else:
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[
                    TextMessage(
                        text="格式不正確 😅\n"
                             "請輸入：姓名 email\n"
                             "範例：王大明 wang@ncut.edu.tw"
                    )
                ],
            )
        )


async def _handle_edit_input(event, line_api, text: str, user_id: str, session: dict):
    """處理編輯輸入（editing 狀態）"""
    edit_field = session.get("edit_field")
    ai_result = session.get("ai_result", {})

    if not ai_result or not edit_field:
        SessionModel.transition(user_id, "idle")
        return

    # 更新對應欄位
    if edit_field == "subject":
        ai_result["subject"] = text
    elif edit_field == "body":
        ai_result["body"] = text
    elif edit_field == "filename":
        if not text.endswith(".pdf"):
            text += ".pdf"
        ai_result["filename"] = text

    SessionModel.set_ai_result(user_id, ai_result)
    SessionModel.transition(user_id, "awaiting_confirm")

    # 重新推送預覽卡片
    contact = ContactModel.get_by_id(session.get("selected_contact_id", 0))
    if contact:
        from app.services.flex_builder import build_preview_flex
        flex = build_preview_flex(
            ai_result, contact["name"], contact["email"]
        )
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[
                    TextMessage(text=f"✅ 已更新{_field_label(edit_field)}"),
                    FlexMessage(
                        alt_text=f"📧 郵件預覽 — {ai_result.get('subject', '')}",
                        contents=FlexContainer.from_dict(flex["contents"]),
                    ),
                ],
            )
        )


async def _process_ai_analysis(user_id: str, contact_id: int, line_api: MessagingApi):
    """執行 AI 分析並推送結果"""
    from app.services.ai_analyzer import analyze_document
    from app.services.flex_builder import build_preview_flex
    from app.models.sender import SenderModel
    from linebot.v3.messaging import PushMessageRequest

    session = SessionModel.get(user_id)
    contact = ContactModel.get_by_id(contact_id)
    sender = SenderModel.get_or_default(user_id)

    if not session or not contact:
        return

    result = await analyze_document(
        image_data=session["image_data"],
        media_type=session.get("image_media_type", "image/jpeg"),
        sender_info=sender,
        recipient_info=contact,
    )

    SessionModel.set_ai_result(user_id, result)
    SessionModel.transition(user_id, "awaiting_confirm")

    # 推送預覽卡片
    flex = build_preview_flex(result, contact["name"], contact["email"])
    try:
        line_api.push_message(
            PushMessageRequest(
                to=user_id,
                messages=[
                    FlexMessage(
                        alt_text=f"📧 郵件預覽 — {result.get('subject', '')}",
                        contents=FlexContainer.from_dict(flex["contents"]),
                    ),
                ],
            )
        )
    except Exception as e:
        logger.error("推送預覽卡片失敗: %s", e)


def _field_label(field: str) -> str:
    """欄位名稱對照"""
    return {"subject": "標題", "body": "正文", "filename": "檔名"}.get(field, field)
