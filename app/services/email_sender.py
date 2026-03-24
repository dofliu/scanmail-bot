"""SMTP 郵件寄送服務"""
import logging
import asyncio
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


# SMTP 連線策略（依序嘗試）
def _get_smtp_strategies(host: str, port: int, user: str, password: str):
    """根據設定產生多種 SMTP 連線策略"""
    strategies = []

    # 策略 1：使用者指定的 port + STARTTLS（587 的標準做法）
    if port == 587:
        strategies.append({
            "name": f"STARTTLS on port {port}",
            "hostname": host, "port": port,
            "start_tls": True, "use_tls": False,
            "username": user, "password": password,
        })

    # 策略 2：使用者指定的 port + SSL（465 的標準做法）
    if port == 465:
        strategies.append({
            "name": f"SSL/TLS on port {port}",
            "hostname": host, "port": port,
            "start_tls": False, "use_tls": True,
            "username": user, "password": password,
        })

    # 策略 3：使用者指定的 port 不是 587/465，直接試
    if port not in (587, 465, 25):
        strategies.append({
            "name": f"STARTTLS on port {port}",
            "hostname": host, "port": port,
            "start_tls": True, "use_tls": False,
            "username": user, "password": password,
        })

    # 策略 4：學校 SMTP relay（勤益科大專用）
    if "ncut.edu.tw" in host or "ncut.edu.tw" in (user or ""):
        for ncut_host in ["spam.ncut.edu.tw", "mail.ncut.edu.tw"]:
            if ncut_host != host:  # 避免重複
                # 校內 relay port 25 無認證
                strategies.append({
                    "name": f"NCUT relay {ncut_host}:25 (no auth)",
                    "hostname": ncut_host, "port": 25,
                    "start_tls": False, "use_tls": False,
                    "username": None, "password": None,
                })
                # 校內 relay port 25 + 認證
                strategies.append({
                    "name": f"NCUT relay {ncut_host}:25 (auth)",
                    "hostname": ncut_host, "port": 25,
                    "start_tls": False, "use_tls": False,
                    "username": user, "password": password,
                })

    # 策略 5：port 25 無認證（校內常見）
    strategies.append({
        "name": "Plain on port 25 (no auth)",
        "hostname": host, "port": 25,
        "start_tls": False, "use_tls": False,
        "username": None, "password": None,
    })

    # 策略 6：port 25 + STARTTLS + 認證
    if port != 25:
        strategies.append({
            "name": "STARTTLS on port 25",
            "hostname": host, "port": 25,
            "start_tls": True, "use_tls": False,
            "username": user, "password": password,
        })

    # 策略 7：port 465 SSL（如果使用者沒指定 465）
    if port != 465:
        strategies.append({
            "name": "SSL/TLS on port 465",
            "hostname": host, "port": 465,
            "start_tls": False, "use_tls": True,
            "username": user, "password": password,
        })

    # 策略 7：port 587（如果使用者沒指定 587）
    if port != 587:
        strategies.append({
            "name": "STARTTLS on port 587",
            "hostname": host, "port": 587,
            "start_tls": True, "use_tls": False,
            "username": user, "password": password,
        })

    return strategies


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

    # 確保 sender_email 有值
    if not sender_email:
        # 用 SMTP_USER 組合 email
        smtp_user = settings.SMTP_USER
        smtp_host = settings.SMTP_HOST
        if smtp_user and "@" in smtp_user:
            sender_email = smtp_user
        elif smtp_user:
            # 取 domain：mail.ncut.edu.tw → gm.ncut.edu.tw（常見校內格式）
            domain = smtp_host.replace("mail.", "gm.", 1) if smtp_host.startswith("mail.") else smtp_host
            sender_email = f"{smtp_user}@{domain}"
        else:
            sender_email = "scanmail@localhost"
        logger.info("sender_email 未設定，自動使用: %s", sender_email)

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

    # SMTP 寄送 — 嘗試多種連線策略
    strategies = _get_smtp_strategies(
        host=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        user=settings.SMTP_USER,
        password=settings.SMTP_PASSWORD,
    )

    errors = []
    for strategy in strategies:
        name = strategy.pop("name")
        logger.info("嘗試 SMTP 策略: %s (%s:%d)",
                     name, strategy["hostname"], strategy["port"])
        try:
            send_kwargs = {
                "hostname": strategy["hostname"],
                "port": strategy["port"],
                "timeout": 15,
            }
            if strategy["use_tls"]:
                send_kwargs["use_tls"] = True
            if strategy["start_tls"]:
                send_kwargs["start_tls"] = True
            if strategy["username"] and strategy["password"]:
                send_kwargs["username"] = strategy["username"]
                send_kwargs["password"] = strategy["password"]

            await aiosmtplib.send(msg, **send_kwargs)

            logger.info("郵件寄送成功 [%s]: %s -> %s [%s]",
                        name, sender_email, recipient_email, subject)
            return {"success": True, "message": f"寄送成功（{name}）"}

        except aiosmtplib.SMTPAuthenticationError as e:
            logger.warning("SMTP 認證失敗 [%s]: %s", name, e)
            errors.append(f"{name}: 認證失敗")
            # 認證失敗不用重試其他有認證的策略（密碼就是錯的）
            # 但繼續試無認證的策略
            continue

        except Exception as e:
            logger.warning("SMTP 失敗 [%s]: %s", name, e)
            errors.append(f"{name}: {e}")
            continue

    # 全部策略都失敗
    all_errors = "; ".join(errors)
    logger.error("所有 SMTP 策略都失敗: %s", all_errors)
    return {
        "success": False,
        "message": f"郵件寄送失敗，已嘗試所有連線方式。\n錯誤：{all_errors}"
    }
