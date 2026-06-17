"""資料模型"""
from app.models.contact import ContactModel
from app.models.history import HistoryModel
from app.models.session import SessionModel
from app.models.sender import SenderModel
from app.models.form_template import FormTemplateModel
from app.models.user import UserModel

__all__ = [
    "ContactModel",
    "HistoryModel",
    "SessionModel",
    "SenderModel",
    "FormTemplateModel",
    "UserModel",
]
