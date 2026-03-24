"""指令處理器（全域文字指令）"""
import logging
from linebot.v3.messaging import (
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
    FlexMessage,
    FlexContainer,
)
from app.models.session import SessionModel
from app.models.contact import ContactModel
from app.models.history import HistoryModel
from app.models.sender import SenderModel

logger = logging.getLogger(__name__)

# 指令對照表
COMMAND_MAP = {
    "開始": "welcome",
    "你好": "welcome",
    "hi": "welcome",
    "hello": "welcome",
    "說明": "help",
    "help": "help",
    "聯絡人": "contacts",
    "歷史": "history",
    "設定": "settings",
    "統計": "stats",
    "取消": "cancel",
    "新增收件人": "add_contact",
}

HELP_TEXT = """📖 ScanMail Bot 使用說明

【基本流程】
1️⃣ 拍照/上傳文件圖片
2️⃣ 選擇或新增收件人
3️⃣ 檢查 AI 產生的郵件內容
4️⃣ 確認寄出或編輯修改

【聯絡人格式】
輸入「新增收件人」後：
姓名 email
姓名 email 單位 職稱

範例：
王大明 wang@ncut.edu.tw
王大明 wang@ncut.edu.tw 資工系 教授

【編輯郵件】
在預覽畫面點「編輯」後：
- 選擇「修改標題」→ 輸入新標題
- 選擇「修改正文」→ 輸入新正文
- 選擇「修改檔名」→ 輸入新檔名

【指令列表】
📷 拍照/上傳 → 開始掃描
📋 聯絡人 → 管理常用聯絡人
📊 歷史 → 查看寄件記錄
⚙️ 設定 → 寄件人資訊設定
📈 統計 → 使用統計
❌ 取消 → 取消當前操作"""


async def handle_command(event, line_api: MessagingApi, text: str) -> bool:
    """處理文字指令，回傳是否已處理"""
    user_id = event.source.user_id
    cmd = COMMAND_MAP.get(text.lower())

    if not cmd:
        return False

    if cmd == "welcome":
        from app.handlers.follow_handler import WELCOME_MESSAGE
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=WELCOME_MESSAGE)],
            )
        )

    elif cmd == "help":
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=HELP_TEXT)],
            )
        )

    elif cmd == "cancel":
        SessionModel.reset(user_id)
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text="已取消 ✖️\n\n請重新拍照或上傳文件開始新的掃描。")],
            )
        )

    elif cmd == "contacts":
        contacts = ContactModel.list_by_user(user_id)
        if contacts:
            lines = ["📋 您的常用聯絡人：\n"]
            for i, c in enumerate(contacts, 1):
                line = f"{i}. {c['name']}"
                if c.get("title"):
                    line += f" {c['title']}"
                line += f"\n   {c['email']}"
                if c.get("department"):
                    line += f" ({c['department']})"
                lines.append(line)
            text_msg = "\n".join(lines)
        else:
            text_msg = "您尚未建立聯絡人 📭\n\n輸入「新增收件人」開始建立。"
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=text_msg)],
            )
        )

    elif cmd == "history":
        items = HistoryModel.list_by_user(user_id, limit=10)
        if items:
            from app.services.flex_builder import build_history_carousel
            carousel = build_history_carousel(items)
            if carousel.get("type") == "flex":
                line_api.reply_message(
                    ReplyMessageRequest(
                        reply_token=event.reply_token,
                        messages=[
                            FlexMessage(
                                alt_text="寄件歷史",
                                contents=FlexContainer.from_dict(carousel["contents"]),
                            )
                        ],
                    )
                )
            else:
                line_api.reply_message(
                    ReplyMessageRequest(
                        reply_token=event.reply_token,
                        messages=[TextMessage(text=carousel.get("text", "無記錄"))],
                    )
                )
        else:
            line_api.reply_message(
                ReplyMessageRequest(
                    reply_token=event.reply_token,
                    messages=[TextMessage(text="目前沒有寄件記錄 📭")],
                )
            )

    elif cmd == "stats":
        stats = HistoryModel.get_stats(user_id)
        text_msg = (
            f"📈 您的使用統計\n\n"
            f"總寄件數：{stats['total']} 封\n"
            f"本月寄件：{stats['monthly']} 封\n"
        )
        if stats["by_type"]:
            text_msg += "\n文件類型分布：\n"
            for t in stats["by_type"]:
                text_msg += f"  • {t['doc_type'] or '其他'}：{t['cnt']} 封\n"
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=text_msg)],
            )
        )

    elif cmd == "settings":
        profile = SenderModel.get_or_default(user_id)
        text_msg = (
            f"⚙️ 寄件人設定\n\n"
            f"姓名：{profile.get('name', '未設定')}\n"
            f"Email：{profile.get('email', '未設定')}\n"
            f"職稱：{profile.get('title', '未設定')}\n"
            f"單位：{profile.get('department', '未設定')}\n"
            f"機構：{profile.get('organization', '未設定')}\n\n"
            f"如需修改，請輸入：\n"
            f"設定 姓名 Email 職稱 單位"
        )
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=text_msg)],
            )
        )

    elif cmd == "add_contact":
        session = SessionModel.get_or_create(user_id)
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[
                    TextMessage(
                        text="請輸入收件人資訊：\n"
                             "格式：姓名 email\n"
                             "範例：王大明 wang@ncut.edu.tw\n\n"
                             "也可加上單位和職稱：\n"
                             "王大明 wang@ncut.edu.tw 資工系 教授"
                    )
                ],
            )
        )

    return True
