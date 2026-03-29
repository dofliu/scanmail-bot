"""郵件模板 CRUD"""
from app.database import get_connection

# 各文件類型的預設模板
DEFAULT_TEMPLATES = {
    "exam": {
        "name": "考卷預設模板",
        "subject": "【考卷】{summary}",
        "body": "老師您好，\n\n附件為{summary}，請查收。\n\n如有任何問題，請隨時與我聯繫。",
    },
    "official": {
        "name": "公文預設模板",
        "subject": "【公文】{summary}",
        "body": "您好，\n\n檢附{summary}如附件，敬請核示。\n\n謹此。",
    },
    "receipt": {
        "name": "收據預設模板",
        "subject": "【報銷】{summary}",
        "body": "您好，\n\n附件為{summary}之相關單據，煩請協助辦理核銷。\n\n感謝。",
    },
    "contract": {
        "name": "合約預設模板",
        "subject": "【合約】{summary}",
        "body": "您好，\n\n附件為{summary}，敬請檢閱。如有修訂意見，請不吝告知。",
    },
    "report": {
        "name": "報告預設模板",
        "subject": "【報告】{summary}",
        "body": "您好，\n\n附件為{summary}，請查閱。如有疑問歡迎討論。",
    },
    "letter": {
        "name": "信函預設模板",
        "subject": "{summary}",
        "body": "您好，\n\n附件為{summary}，請查收。",
    },
    "form": {
        "name": "表單預設模板",
        "subject": "【表單】{summary}",
        "body": "您好，\n\n附件為{summary}，煩請填寫後回覆。\n\n謝謝。",
    },
    "other": {
        "name": "通用預設模板",
        "subject": "{summary}",
        "body": "您好，\n\n附件為掃描文件，請查收。",
    },
}


class TemplateModel:

    @staticmethod
    def get_default(doc_type: str) -> dict:
        """取得某文件類型的預設模板"""
        t = DEFAULT_TEMPLATES.get(doc_type, DEFAULT_TEMPLATES["other"])
        return {
            "id": None,
            "doc_type": doc_type,
            "name": t["name"],
            "subject_template": t["subject"],
            "body_template": t["body"],
            "is_default": True,
        }

    @staticmethod
    def list_by_user(user_id: str) -> list[dict]:
        """列出使用者自訂模板 + 所有預設模板"""
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM email_templates WHERE user_id = ? ORDER BY doc_type, name",
                (user_id,),
            ).fetchall()
            custom = [dict(r) for r in rows]
        finally:
            conn.close()

        # 合併預設模板（沒有自訂的 doc_type 用預設）
        custom_types = {t["doc_type"] for t in custom}
        result = list(custom)
        for dt, tmpl in DEFAULT_TEMPLATES.items():
            if dt not in custom_types:
                result.append(TemplateModel.get_default(dt))
        return result

    @staticmethod
    def get_for_doc_type(user_id: str, doc_type: str) -> dict:
        """取得某文件類型的模板（優先自訂，否則預設）"""
        conn = get_connection()
        try:
            row = conn.execute(
                """SELECT * FROM email_templates
                   WHERE user_id = ? AND doc_type = ?
                   ORDER BY is_default ASC LIMIT 1""",
                (user_id, doc_type),
            ).fetchone()
            if row:
                return dict(row)
        finally:
            conn.close()
        return TemplateModel.get_default(doc_type)

    @staticmethod
    def create(user_id: str, doc_type: str, name: str,
               subject_template: str, body_template: str) -> int:
        conn = get_connection()
        try:
            cur = conn.execute(
                """INSERT INTO email_templates
                   (user_id, doc_type, name, subject_template, body_template)
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, doc_type, name, subject_template, body_template),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    @staticmethod
    def update(template_id: int, name: str, subject_template: str, body_template: str):
        conn = get_connection()
        try:
            conn.execute(
                """UPDATE email_templates
                   SET name=?, subject_template=?, body_template=?
                   WHERE id=?""",
                (name, subject_template, body_template, template_id),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def delete(template_id: int):
        conn = get_connection()
        try:
            conn.execute("DELETE FROM email_templates WHERE id=?", (template_id,))
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def apply_template(template: dict, ai_result: dict) -> dict:
        """將模板套用到 AI 辨識結果，回傳 subject + body"""
        summary = ai_result.get("extracted_text_summary", "掃描文件")
        doc_label = ai_result.get("doc_type_label", "文件")

        subject = template["subject_template"].replace("{summary}", summary).replace("{doc_type}", doc_label)
        body = template["body_template"].replace("{summary}", summary).replace("{doc_type}", doc_label)

        return {"subject": subject, "body": body}
