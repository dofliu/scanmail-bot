"""SMTP 郵件寄送服務"""
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from email.utils import formataddr
import aiosmtplib
from app.config import get_settings

logger = logging.getLogger(__name__)

# HTML 郵件模板
HTML_TEMPLATE = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Microsoft JhengHei', 'PingFang TC', sans-serif;
             color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
  <div style="padding: 20px;">
    {body_html}
    <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
    <div style="color: #888; font-size: 13px;">
      <p style="margin: 2px 0;">{sender_name}</p>
      <p style="margin: 2px 0;">{sender_title}</p>
      <p style="margin: 2px 0;">{sender_dept}</p>
      <p style="margin: 2px 0;">{sender_org}</p>
      <p style="margin: 8px 0; font-size: 11px; color: #aaa;">
        此郵件由 ScanMail Bot 輔助產生
      </p>
    </div>
  </div>
</body>
</html>"""


async def send_email(
    sender_email: str,
    sender_name: str,
    recipient_email: str,
    recipient_name: str,
    subject: str,
    body: str,
    pdf_bytes: bytes,
    filename: str,
    sender_title: str = "",
    sender_dept: str = "",
    sender_org: str = "國立勤益科技大學",
) -> dict:
    """寄送含 PDF 附件的郵件

    Returns:
        {"success": bool, "message": str}
    """
    settings = get_settings()

    # 建立郵件
    msg = MIMEMultipart("mixed")
    msg["From"] = formataddr((sender_name, sender_email))
    msg["To"] = formataddr((recipient_name, recipient_email))
    msg["Subject"] = subject
    msg["X-Mailer"] = "ScanMail Bot v1.0"

    # 正文（HTML + 純文字）
    body_paragraphs = body.replace("\n", "<br>")
    body_html = f"<p>{body_paragraphs}</p>"

    html_content = HTML_TEMPLATE.format(
        body_html=body_html,
        sender_name=sender_name,
        sender_title=sender_title,
        sender_dept=sender_dept,
        sender_org=sender_org,
    )

    alt_part = MIMEMultipart("alternative")
    alt_part.attach(MIMEText(body, "plain", "utf-8"))
    alt_part.attach(MIMEText(html_content, "html", "utf-8"))
    msg.attach(alt_part)

    # PDF 附件
    pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
    pdf_part.add_header(
        "Content-Disposition", "attachment", filename=filename
    )
    msg.attach(pdf_part)

    # SMTP 寄送（含重試）
    max_retries = 2
    for attempt in range(max_retries + 1):
        try:
            await aiosmtplib.send(
                msg,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                start_tls=True,
                username=settings.SMTP_USER,
                password=settings.SMTP_PASSWORD,
                timeout=30,
            )
            logger.info("郵件寄送成功: %s -> %s [%s]",
                        sender_email, recipient_email, subject)
            return {"success": True, "message": "寄送成功"}

        except aiosmtplib.SMTPAuthenticationError as e:
            logger.error("SMTP 認證失敗: %s", e)
            return {"success": False, "message": f"郵件伺服器認證失敗，請到設定中檢查帳號密碼。"}

        except Exception as e:
            if attempt < max_retries:
                logger.warning("SMTP 寄送失敗 (第 %d 次重試): %s", attempt + 1, e)
                import asyncio
                await asyncio.sleep(3)
            else:
                logger.error("SMTP 寄送失敗（已重試 %d 次）: %s", max_retries, e)
                return {"success": False, "message": f"寄送失敗，請稍後再試。錯誤：{e}"}

    return {"success": False, "message": "寄送失敗"}
