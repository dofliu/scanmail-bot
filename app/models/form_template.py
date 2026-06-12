"""表單模板 CRUD"""
import json
import hashlib
from typing import Optional
from app.database import get_connection


def compute_form_fingerprint(fields: list[dict]) -> str:
    """計算表單特徵指紋（依據非空欄位標籤排序之 Hash）"""
    # 萃取所有非空 label
    labels = []
    for f in fields:
        label = f.get("label") or f.get("name") or ""
        label = label.strip()
        if label:
            labels.append(label)
    
    # 排序並連接
    fingerprint_str = ",".join(sorted(list(set(labels))))
    return hashlib.sha256(fingerprint_str.encode("utf-8")).hexdigest()


class FormTemplateModel:

    @staticmethod
    def get_by_id(template_id: int) -> Optional[dict]:
        """依 ID 取得表單模板"""
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM form_templates WHERE id = ?",
                (template_id,)
            ).fetchone()
            if row:
                res = dict(row)
                res["fields"] = json.loads(res["fields_json"])
                res["values"] = json.loads(res["values_json"])
                return res
        finally:
            conn.close()
        return None

    @staticmethod
    def get_by_fingerprint(user_id: str, fingerprint: str) -> Optional[dict]:
        """依特徵指紋取得匹配的表單模板"""
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM form_templates WHERE user_id = ? AND fingerprint = ? ORDER BY created_at DESC LIMIT 1",
                (user_id, fingerprint)
            ).fetchone()
            if row:
                res = dict(row)
                res["fields"] = json.loads(res["fields_json"])
                res["values"] = json.loads(res["values_json"])
                return res
        finally:
            conn.close()
        return None

    @staticmethod
    def list_by_user(user_id: str) -> list[dict]:
        """列出使用者的所有自訂表單模板"""
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT id, user_id, name, fingerprint, created_at FROM form_templates WHERE user_id = ? ORDER BY name",
                (user_id,)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def upsert(user_id: str, name: str, fields: list[dict], values: dict) -> int:
        """新增或更新表單模板（基於名稱 unique constraint）"""
        fingerprint = compute_form_fingerprint(fields)
        fields_json = json.dumps(fields, ensure_ascii=False)
        values_json = json.dumps(values, ensure_ascii=False)

        conn = get_connection()
        try:
            cur = conn.execute(
                """
                INSERT INTO form_templates (user_id, name, fingerprint, fields_json, values_json)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, name) DO UPDATE SET
                    fingerprint=excluded.fingerprint,
                    fields_json=excluded.fields_json,
                    values_json=excluded.values_json,
                    created_at=CURRENT_TIMESTAMP
                """,
                (user_id, name, fingerprint, fields_json, values_json)
            )
            conn.commit()
            
            # 如果是 insert，cur.lastrowid 有值。如果是 update，則手動查詢其 id。
            if cur.lastrowid:
                return cur.lastrowid
            
            row = conn.execute(
                "SELECT id FROM form_templates WHERE user_id = ? AND name = ?",
                (user_id, name)
            ).fetchone()
            return row["id"] if row else 0
        finally:
            conn.close()

    @staticmethod
    def delete(template_id: int):
        """刪除指定表單模板"""
        conn = get_connection()
        try:
            conn.execute("DELETE FROM form_templates WHERE id = ?", (template_id,))
            conn.commit()
        finally:
            conn.close()
