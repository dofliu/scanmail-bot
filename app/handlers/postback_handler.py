"""按鈕回應（Postback）處理器"""
import logging
from urllib.parse import parse_qs
from linebot.v3.messaging import (
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
    FlexMessage,
    FlexContainer,
    QuickReply,
)
from app.models.session import SessionModel
from app.models.contact import ContactModel
from app.services.flex_builder import (
    build_preview_flex,
    build_edit_quick_reply,
)

logger = logging.getLogger(__name__)


async def handle_postback(event, line_api: MessagingApi):
    """處理 Postback 事件"""
    user_id = event.source.user_id
    data = parse_qs(event.postback.data)
    session = SessionModel.get_or_create(user_id)

    # 選擇聯絡人
    if "select_contact" in data:
        contact_id = int(data["select_contact"][0])
        await _select_contact(event, line_api, user_id, contact_id)

    # 確認寄出
    elif data.get("action", [None])[0] == "confirm_send":
        await _confirm_send(event, line_api, user_id, session)

    # 編輯
    elif data.get("action", [None])[0] == "edit":
        quick_reply = build_edit_quick_reply()
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[
                    TextMessage(
                        text="請選擇要編輯的項目：",
                        quick_reply=QuickReply.from_dict(quick_reply),
                    )
                ],
            )
        )

    # 選擇編輯欄位
    elif "edit_field" in data:
        field = data["edit_field"][0]
        SessionModel.set_edit_field(user_id, field)
        SessionModel.transition(user_id, "editing")
        field_label = {"subject": "標題", "body": "正文", "filename": "檔名"}.get(field, field)
        current_value = ""
        ai_result = session.get("ai_result", {})
        if ai_result:
            current_value = ai_result.get(field, "")
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[
                    TextMessage(
                        text=f"✏️ 請輸入新的{field_label}：\n\n"
                             f"目前內容：\n{current_value}"
                    )
                ],
            )
        )

    # 返回預覽
    elif data.get("action", [None])[0] == "back_to_preview":
        SessionModel.transition(user_id, "awaiting_confirm")
        ai_result = session.get("ai_result", {})
        contact = ContactModel.get_by_id(session.get("selected_contact_id", 0))
        if ai_result and contact:
            flex = build_preview_flex(ai_result, contact["name"], contact["email"])
            line_api.reply_message(
                ReplyMessageRequest(
                    reply_token=event.reply_token,
                    messages=[
                        FlexMessage(
                            alt_text=f"📧 郵件預覽",
                            contents=FlexContainer.from_dict(flex["contents"]),
                        )
                    ],
                )
            )

    # 取消
    elif data.get("action", [None])[0] == "cancel":
        SessionModel.reset(user_id)
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text="已取消 ✖️\n\n請重新拍照或上傳文件開始新的掃描。")],
            )
        )


async def _select_contact(event, line_api, user_id: str, contact_id: int):
    """選擇聯絡人並啟動 AI 分析"""
    contact = ContactModel.get_by_id(contact_id)
    if not contact:
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text="聯絡人不存在，請重新選擇。")],
            )
        )
        return

    SessionModel.set_contact(user_id, contact_id)
    SessionModel.transition(user_id, "processing")
    ContactModel.increment_frequency(contact_id)

    line_api.reply_message(
        ReplyMessageRequest(
            reply_token=event.reply_token,
            messages=[
                TextMessage(
                    text=f"收件人：{contact['name']} ({contact['email']})\n\n"
                         "🤖 AI 辨識中，請稍候..."
                )
            ],
        )
    )

    # 觸發 AI 分析
    import asyncio
    from app.handlers.message_handler import _process_ai_analysis
    asyncio.create_task(_process_ai_analysis(user_id, contact_id, line_api))


async def _confirm_send(event, line_api, user_id: str, session: dict):
    """確認寄出郵件"""
    ai_result = session.get("ai_result", {})
    contact = ContactModel.get_by_id(session.get("selected_contact_id", 0))

    if not ai_result or not contact:
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text="資料不完整，請重新開始。")],
            )
        )
        SessionModel.reset(user_id)
        return

    SessionModel.transition(user_id, "sending")

    # 圖片轉 PDF
    from app.services.image_processor import image_to_pdf
    pdf_bytes = image_to_pdf(session["image_data"])

    # 寄送郵件
    from app.services.email_sender import send_email
    from app.models.sender import SenderModel
    sender = SenderModel.get_or_default(user_id)

    result = await send_email(
        sender_email=sender.get("email", ""),
        sender_name=sender.get("name", ""),
        recipient_email=contact["email"],
        recipient_name=contact["name"],
        subject=ai_result.get("subject", "掃描文件"),
        body=ai_result.get("body", ""),
        pdf_bytes=pdf_bytes,
        filename=ai_result.get("filename", "document.pdf"),
        sender_title=sender.get("title", ""),
        sender_dept=sender.get("department", ""),
        sender_org=sender.get("organization", "國立勤益科技大學"),
    )

    if result["success"]:
        # 記錄歷史
        from app.models.history import HistoryModel
        HistoryModel.create(
            user_id=user_id,
            recipient_email=contact["email"],
            recipient_name=contact["name"],
            subject=ai_result.get("subject", ""),
            body=ai_result.get("body", ""),
            doc_type=ai_result.get("doc_type", ""),
            filename=ai_result.get("filename", ""),
            ai_confidence=ai_result.get("confidence", 0),
            file_size=len(pdf_bytes),
        )

        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[
                    TextMessage(
                        text=f"✅ 郵件已寄出！\n\n"
                             f"📧 {ai_result.get('subject', '')}\n"
                             f"📎 {ai_result.get('filename', '')}\n"
                             f"➡️ {contact['name']} ({contact['email']})"
                    )
                ],
            )
        )
    else:
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=f"❌ {result['message']}")],
            )
        )

    # 重置 session
    SessionModel.reset(user_id)
