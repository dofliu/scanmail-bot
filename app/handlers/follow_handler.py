"""加入好友事件處理"""
import logging
from linebot.v3.messaging import (
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
)
from app.models.session import SessionModel

logger = logging.getLogger(__name__)

WELCOME_MESSAGE = """🎉 歡迎使用 ScanMail Bot！

📷 拍照或上傳文件圖片
🤖 AI 自動辨識文件內容
📧 一鍵寄出專業郵件

【使用方式】
1️⃣ 拍照或上傳文件照片
2️⃣ 選擇或輸入收件人
3️⃣ 確認 AI 產生的郵件內容
4️⃣ 點擊「確認寄出」

【常用指令】
📋 輸入「聯絡人」管理收件人
📊 輸入「歷史」查看寄件記錄
⚙️ 輸入「設定」設定寄件人資訊
❓ 輸入「說明」查看詳細說明

現在就試試看吧！直接拍一張文件照片給我 📷"""


async def handle_follow(event, line_api: MessagingApi):
    """處理加入好友事件"""
    user_id = event.source.user_id
    logger.info("新使用者加入: %s", user_id)

    # 建立 session
    SessionModel.get_or_create(user_id)

    line_api.reply_message(
        ReplyMessageRequest(
            reply_token=event.reply_token,
            messages=[TextMessage(text=WELCOME_MESSAGE)],
        )
    )
