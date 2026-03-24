#!/usr/bin/env python3
"""SMTP 連線測試"""
import sys
import os
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import aiosmtplib
from app.config import get_settings


async def test_connection():
    """測試 SMTP 連線"""
    settings = get_settings()
    print(f"測試 SMTP 連線: {settings.SMTP_HOST}:{settings.SMTP_PORT}")
    print(f"使用者: {settings.SMTP_USER}")

    try:
        smtp = aiosmtplib.SMTP(
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            start_tls=True,
        )
        await smtp.connect()
        print("✅ 連線成功")

        await smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        print("✅ 認證成功")

        await smtp.quit()
        print("✅ SMTP 測試通過！")

    except aiosmtplib.SMTPAuthenticationError as e:
        print(f"❌ 認證失敗: {e}")
    except Exception as e:
        print(f"❌ 連線失敗: {e}")


if __name__ == "__main__":
    asyncio.run(test_connection())
