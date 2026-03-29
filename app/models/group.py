"""收件人群組 CRUD"""
from app.database import get_connection


class GroupModel:

    @staticmethod
    def create(user_id: str, name: str, description: str = "") -> int:
        conn = get_connection()
        try:
            cur = conn.execute(
                "INSERT INTO contact_groups (user_id, name, description) VALUES (?, ?, ?)",
                (user_id, name, description),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    @staticmethod
    def list_by_user(user_id: str) -> list[dict]:
        conn = get_connection()
        try:
            rows = conn.execute(
                """SELECT g.*, COUNT(gm.contact_id) AS member_count
                   FROM contact_groups g
                   LEFT JOIN group_members gm ON g.id = gm.group_id
                   WHERE g.user_id = ?
                   GROUP BY g.id
                   ORDER BY g.name""",
                (user_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(group_id: int) -> dict | None:
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM contact_groups WHERE id = ?", (group_id,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def delete(group_id: int):
        conn = get_connection()
        try:
            conn.execute("DELETE FROM contact_groups WHERE id = ?", (group_id,))
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def set_members(group_id: int, contact_ids: list[int]):
        conn = get_connection()
        try:
            conn.execute("DELETE FROM group_members WHERE group_id = ?", (group_id,))
            for cid in contact_ids:
                conn.execute(
                    "INSERT OR IGNORE INTO group_members (group_id, contact_id) VALUES (?, ?)",
                    (group_id, cid),
                )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def get_members(group_id: int) -> list[dict]:
        conn = get_connection()
        try:
            rows = conn.execute(
                """SELECT c.* FROM contacts c
                   JOIN group_members gm ON c.id = gm.contact_id
                   WHERE gm.group_id = ?
                   ORDER BY c.name""",
                (group_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()
