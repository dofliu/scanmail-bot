"""文件轉檔路由 — Word⟷PDF、Markdown⟷PDF/Word"""
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response

from app.services.doc_converter import (
    word_to_pdf, pdf_to_word,
    markdown_to_pdf, markdown_to_word, word_to_markdown,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/word-to-pdf")
async def api_word_to_pdf(file: UploadFile = File(...)):
    """Word → PDF"""
    data = await file.read()
    try:
        result = word_to_pdf(data)
    except Exception as e:
        logger.error("Word → PDF 失敗: %s", e)
        raise HTTPException(status_code=500, detail=f"轉換失敗: {e}")
    return Response(content=result, media_type="application/pdf",
                    headers={"Content-Disposition": "attachment; filename=converted.pdf"})


@router.post("/pdf-to-word")
async def api_pdf_to_word(file: UploadFile = File(...)):
    """PDF → Word"""
    data = await file.read()
    try:
        result = pdf_to_word(data)
    except Exception as e:
        logger.error("PDF → Word 失敗: %s", e)
        raise HTTPException(status_code=500, detail=f"轉換失敗: {e}")
    return Response(content=result,
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": "attachment; filename=converted.docx"})


@router.post("/md-to-pdf")
async def api_md_to_pdf(file: UploadFile = File(...)):
    """Markdown → PDF"""
    data = await file.read()
    md_text = data.decode("utf-8", errors="replace")
    try:
        result = markdown_to_pdf(md_text)
    except Exception as e:
        logger.error("Markdown → PDF 失敗: %s", e)
        raise HTTPException(status_code=500, detail=f"轉換失敗: {e}")
    return Response(content=result, media_type="application/pdf",
                    headers={"Content-Disposition": "attachment; filename=converted.pdf"})


@router.post("/md-to-word")
async def api_md_to_word(file: UploadFile = File(...)):
    """Markdown → Word"""
    data = await file.read()
    md_text = data.decode("utf-8", errors="replace")
    try:
        result = markdown_to_word(md_text)
    except Exception as e:
        logger.error("Markdown → Word 失敗: %s", e)
        raise HTTPException(status_code=500, detail=f"轉換失敗: {e}")
    return Response(content=result,
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": "attachment; filename=converted.docx"})


@router.post("/word-to-md")
async def api_word_to_md(file: UploadFile = File(...)):
    """Word → Markdown"""
    data = await file.read()
    try:
        result = word_to_markdown(data)
    except Exception as e:
        logger.error("Word → Markdown 失敗: %s", e)
        raise HTTPException(status_code=500, detail=f"轉換失敗: {e}")
    return Response(content=result.encode("utf-8"), media_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=converted.md"})
