"""背景任務管理器 — ThreadPoolExecutor + SSE 進度推送

提供 CPU 密集型任務（圖片/影片/PDF 處理）的背景執行能力。
每個任務有 UUID，可透過 SSE 端點即時取得進度。
"""
import asyncio
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# 任務執行緒池（限制 CPU 密集型任務並行數）
_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="task-worker")


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TaskInfo:
    task_id: str
    status: TaskStatus = TaskStatus.PENDING
    progress: int = 0       # 0-100
    message: str = ""
    result: Any = None      # 完成後的結果（通常是檔案路徑）
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)


# 所有任務的全域存放區
_tasks: dict[str, TaskInfo] = {}

# 任務結果存活時間（秒）
TASK_TTL = 30 * 60  # 30 分鐘


def submit_task(func: Callable, *args, **kwargs) -> str:
    """提交一個背景任務

    Args:
        func: 要執行的函式。函式簽名需為 func(task_id, *args, **kwargs)，
              並透過 update_task_progress() 回報進度。

    Returns:
        task_id
    """
    task_id = uuid.uuid4().hex[:12]
    task = TaskInfo(task_id=task_id)
    _tasks[task_id] = task

    def _run():
        task.status = TaskStatus.RUNNING
        try:
            result = func(task_id, *args, **kwargs)
            task.result = result
            task.status = TaskStatus.COMPLETED
            task.progress = 100
            task.message = "完成"
        except Exception as e:
            logger.error("任務 %s 失敗: %s", task_id, e, exc_info=True)
            task.error = str(e)
            task.status = TaskStatus.FAILED
            task.message = f"失敗: {e}"

    _executor.submit(_run)
    logger.info("提交背景任務: %s", task_id)
    return task_id


def update_task_progress(task_id: str, progress: int, message: str = ""):
    """更新任務進度（在工作執行緒中呼叫）"""
    task = _tasks.get(task_id)
    if task:
        task.progress = min(progress, 100)
        if message:
            task.message = message


def get_task(task_id: str) -> Optional[TaskInfo]:
    """取得任務資訊"""
    return _tasks.get(task_id)


async def task_progress_stream(task_id: str):
    """SSE 進度串流產生器

    Usage in FastAPI:
        return StreamingResponse(task_progress_stream(task_id),
                                 media_type="text/event-stream")
    """
    task = _tasks.get(task_id)
    if not task:
        yield f"data: {{\"error\": \"任務不存在\"}}\n\n"
        return

    last_progress = -1
    while True:
        if task.progress != last_progress or task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
            data = {
                "task_id": task.task_id,
                "status": task.status.value,
                "progress": task.progress,
                "message": task.message,
            }
            if task.status == TaskStatus.COMPLETED and task.result:
                data["result"] = task.result if isinstance(task.result, (str, dict, list)) else str(task.result)
            if task.error:
                data["error"] = task.error

            import json
            yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
            last_progress = task.progress

            if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
                break

        await asyncio.sleep(0.3)


def cleanup_old_tasks():
    """清理過期任務"""
    now = time.time()
    expired = [
        tid for tid, t in _tasks.items()
        if (now - t.created_at) > TASK_TTL
        and t.status in (TaskStatus.COMPLETED, TaskStatus.FAILED)
    ]
    for tid in expired:
        del _tasks[tid]
    if expired:
        logger.info("已清理 %d 個過期任務", len(expired))
