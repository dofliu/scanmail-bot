"""LINE Flex Message 模板產生器"""
from typing import Optional

# 文件類型色彩對照
DOC_TYPE_COLORS = {
    "exam": {"color": "#1D9E75", "icon": "📝", "label": "考卷"},
    "official": {"color": "#534AB7", "icon": "📋", "label": "公文"},
    "receipt": {"color": "#D85A30", "icon": "🧾", "label": "收據"},
    "contract": {"color": "#185FA5", "icon": "📄", "label": "合約"},
    "report": {"color": "#993556", "icon": "📊", "label": "報告"},
    "letter": {"color": "#3B6D11", "icon": "✉️", "label": "信函"},
    "form": {"color": "#854F0B", "icon": "📑", "label": "表單"},
    "other": {"color": "#5F5E5A", "icon": "📎", "label": "其他"},
}


def build_preview_flex(
    ai_result: dict,
    recipient_name: str,
    recipient_email: str,
    session_id: str = "",
) -> dict:
    """產生預覽 Flex Message

    Args:
        ai_result: AI 辨識結果
        recipient_name: 收件人姓名
        recipient_email: 收件人 Email
        session_id: 用於 postback 識別

    Returns:
        Flex Message dict
    """
    doc_type = ai_result.get("doc_type", "other")
    type_info = DOC_TYPE_COLORS.get(doc_type, DOC_TYPE_COLORS["other"])
    confidence = ai_result.get("confidence", 0)
    confidence_pct = f"{int(confidence * 100)}%"

    # 低信心度警告
    low_confidence = confidence < 0.3
    warning_text = "⚠️ AI 辨識信心度較低，建議確認內容後再寄出" if low_confidence else ""

    flex_message = {
        "type": "flex",
        "altText": f"📧 郵件預覽 — {ai_result.get('subject', '掃描文件')}",
        "contents": {
            "type": "bubble",
            "size": "giga",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": type_info["color"],
                "paddingAll": "15px",
                "contents": [
                    {
                        "type": "text",
                        "text": f"{type_info['icon']} AI 辨識結果 — {type_info['label']}",
                        "color": "#FFFFFF",
                        "size": "sm",
                        "weight": "bold",
                    },
                    {
                        "type": "text",
                        "text": ai_result.get("subject", "掃描文件"),
                        "color": "#FFFFFF",
                        "size": "lg",
                        "weight": "bold",
                        "wrap": True,
                        "margin": "sm",
                    },
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "paddingAll": "15px",
                "contents": [
                    # 收件人
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {"type": "text", "text": "To:", "size": "sm",
                             "color": "#888888", "flex": 1},
                            {"type": "text",
                             "text": f"{recipient_name} {recipient_email}",
                             "size": "sm", "color": "#333333",
                             "flex": 5, "wrap": True},
                        ],
                    },
                    {"type": "separator", "margin": "md"},
                    # 正文
                    {
                        "type": "text",
                        "text": ai_result.get("body", ""),
                        "size": "sm",
                        "color": "#333333",
                        "wrap": True,
                    },
                    # 附件
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "backgroundColor": "#F5F5F5",
                        "cornerRadius": "md",
                        "paddingAll": "10px",
                        "margin": "md",
                        "contents": [
                            {"type": "text",
                             "text": f"📎 {ai_result.get('filename', 'document.pdf')}",
                             "size": "sm", "color": "#555555"},
                        ],
                    },
                    # AI 信心度
                    {
                        "type": "text",
                        "text": f"AI 信心度：{confidence_pct}",
                        "size": "xs",
                        "color": "#AAAAAA",
                        "align": "end",
                        "margin": "md",
                    },
                ],
            },
            "footer": {
                "type": "box",
                "layout": "horizontal",
                "spacing": "sm",
                "contents": [
                    {
                        "type": "button",
                        "action": {
                            "type": "postback",
                            "label": "取消",
                            "data": "action=cancel",
                            "displayText": "取消寄送",
                        },
                        "style": "secondary",
                        "height": "sm",
                        "flex": 2,
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "postback",
                            "label": "編輯",
                            "data": "action=edit",
                            "displayText": "編輯郵件內容",
                        },
                        "style": "secondary",
                        "height": "sm",
                        "flex": 2,
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "postback",
                            "label": "確認寄出 ✓",
                            "data": "action=confirm_send",
                            "displayText": "確認寄出",
                        },
                        "style": "primary",
                        "color": type_info["color"],
                        "height": "sm",
                        "flex": 3,
                    },
                ],
            },
        },
    }

    # 加入低信心度警告
    if warning_text:
        flex_message["contents"]["body"]["contents"].insert(0, {
            "type": "text",
            "text": warning_text,
            "size": "xs",
            "color": "#E74C3C",
            "wrap": True,
        })

    return flex_message


def build_contact_quick_reply(contacts: list[dict]) -> dict:
    """產生聯絡人 Quick Reply"""
    items = []
    for contact in contacts[:10]:  # Quick Reply 最多 13 個
        label = contact["name"]
        if contact.get("title"):
            label += f" {contact['title']}"
        # Quick Reply label 最長 20 字
        if len(label) > 20:
            label = label[:17] + "..."

        items.append({
            "type": "action",
            "action": {
                "type": "postback",
                "label": label,
                "data": f"select_contact={contact['id']}",
                "displayText": f"寄給 {contact['name']}",
            },
        })

    # 新增收件人按鈕
    items.append({
        "type": "action",
        "action": {
            "type": "message",
            "label": "➕ 新增收件人",
            "text": "新增收件人",
        },
    })

    return {"items": items}


def build_edit_quick_reply() -> dict:
    """產生編輯選項 Quick Reply"""
    return {
        "items": [
            {
                "type": "action",
                "action": {
                    "type": "postback",
                    "label": "✏️ 修改標題",
                    "data": "edit_field=subject",
                    "displayText": "修改郵件標題",
                },
            },
            {
                "type": "action",
                "action": {
                    "type": "postback",
                    "label": "✏️ 修改正文",
                    "data": "edit_field=body",
                    "displayText": "修改郵件正文",
                },
            },
            {
                "type": "action",
                "action": {
                    "type": "postback",
                    "label": "✏️ 修改檔名",
                    "data": "edit_field=filename",
                    "displayText": "修改附件檔名",
                },
            },
            {
                "type": "action",
                "action": {
                    "type": "postback",
                    "label": "◀️ 返回預覽",
                    "data": "action=back_to_preview",
                    "displayText": "返回預覽",
                },
            },
        ],
    }


def build_history_carousel(history_items: list[dict]) -> dict:
    """產生寄件歷史 Carousel"""
    bubbles = []
    for item in history_items[:10]:
        doc_type = item.get("doc_type", "other")
        type_info = DOC_TYPE_COLORS.get(doc_type, DOC_TYPE_COLORS["other"])

        bubble = {
            "type": "bubble",
            "size": "kilo",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": type_info["color"],
                "paddingAll": "10px",
                "contents": [
                    {
                        "type": "text",
                        "text": f"{type_info['icon']} {type_info['label']}",
                        "color": "#FFFFFF",
                        "size": "xs",
                    },
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "sm",
                "paddingAll": "10px",
                "contents": [
                    {
                        "type": "text",
                        "text": item.get("subject", "—"),
                        "size": "sm",
                        "weight": "bold",
                        "wrap": True,
                        "maxLines": 2,
                    },
                    {
                        "type": "text",
                        "text": f"To: {item.get('recipient_name', '')}",
                        "size": "xs",
                        "color": "#888888",
                    },
                    {
                        "type": "text",
                        "text": item.get("sent_at", "")[:16],
                        "size": "xs",
                        "color": "#AAAAAA",
                    },
                ],
            },
        }
        bubbles.append(bubble)

    if not bubbles:
        return {
            "type": "text",
            "text": "目前沒有寄件記錄 📭",
        }

    return {
        "type": "flex",
        "altText": "寄件歷史",
        "contents": {
            "type": "carousel",
            "contents": bubbles,
        },
    }
