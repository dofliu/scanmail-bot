#!/usr/bin/env python3
"""匯入預設聯絡人"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import init_db
from app.models.contact import ContactModel

# 預設聯絡人（範例）
DEFAULT_CONTACTS = [
    {
        "name": "系辦公室",
        "email": "aie@ncut.edu.tw",
        "department": "智慧自動化工程系",
        "title": "",
    },
]


def seed(user_id: str):
    """匯入預設聯絡人"""
    init_db()
    for contact in DEFAULT_CONTACTS:
        cid = ContactModel.create(
            user_id=user_id,
            name=contact["name"],
            email=contact["email"],
            department=contact["department"],
            title=contact["title"],
        )
        print(f"  ✅ {contact['name']} ({contact['email']}) → id={cid}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python seed_contacts.py <LINE_USER_ID>")
        sys.exit(1)
    uid = sys.argv[1]
    print(f"匯入預設聯絡人 (user: {uid})...")
    seed(uid)
    print("完成！")
