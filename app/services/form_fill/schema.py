"""Form Fill 共用資料結構"""
from dataclasses import dataclass, field, asdict
from typing import Optional


class Backend:
    """Backend 名稱常數，避免字串散落各處"""
    ACROFORM = "acroform"
    PDFPLUMBER = "pdfplumber"
    PADDLE = "paddle"
    GEMINI = "gemini"


@dataclass
class FormField:
    name: str
    label: str
    field_type: str = "text"  # text | date | checkbox | signature | number
    bbox: Optional[tuple] = None  # (x0, y0, x1, y1) in PDF points, origin bottom-left
    page: int = 0
    backend: str = ""
    confidence: float = 1.0
    suggested_value: Optional[str] = None
    semantic_key: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        if self.bbox is not None:
            d["bbox"] = list(self.bbox)
        return d


@dataclass
class DetectionResult:
    backend_used: str
    page_count: int
    fields: list[FormField] = field(default_factory=list)
    needs_review: bool = False
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "backend_used": self.backend_used,
            "page_count": self.page_count,
            "needs_review": self.needs_review,
            "notes": self.notes,
            "fields": [f.to_dict() for f in self.fields],
        }


class UnsupportedFormat(Exception):
    """輸入檔案格式不被支援"""
