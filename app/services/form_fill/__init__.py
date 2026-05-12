"""Auto Form Fill — 表單欄位偵測與自動填寫

公開介面：
    detect_fields(data, mime, hint=None) -> DetectionResult
    fill_form(data, fields, values) -> bytes
    suggest_values(fields, sender_profile, contact=None) -> dict[name -> value]

詳細設計見 docs/AUTO_FORM_FILL.md。
"""
from app.services.form_fill.schema import FormField, DetectionResult
from app.services.form_fill.dispatcher import detect_fields, normalize_to_pdf
from app.services.form_fill.filler import fill_form
from app.services.form_fill.semantic_mapper import suggest_values

__all__ = [
    "FormField",
    "DetectionResult",
    "detect_fields",
    "normalize_to_pdf",
    "fill_form",
    "suggest_values",
]
