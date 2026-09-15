"""FastAPI 应用入口。

职责（按需求“后端唯一功能是建立 sqlite 数据库和映射 api，用于持久化数据”）：
1. 启动时建库，并启动后台定时任务按周期从 celestrak 拉取 TLE 写入 sqlite。
2. 提供映射 API，把 sqlite 中的 TLE / 元信息以 JSON 暴露给前端。
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .celestrak import refresh_all
from .config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("sat-backend")

# 最近一次抓取摘要（供 /api/status 返回）
_last_refresh: dict = {
    "last_run": None,
    "next_run": None,
    "period_seconds": settings.TLE_REFRESH_PERIOD,
    "summary": [],
}


async def _refresh_loop() -> None:
    """后台刷新循环：立即跑一次，之后每 period 秒跑一次。"""
    loop = asyncio.get_event_loop()
    period = settings.TLE_REFRESH_PERIOD
    while True:
        try:
            logger.info("开始刷新 TLE（周期 %ss）…", period)
            summary = await loop.run_in_executor(None, refresh_all)
            ok = sum(1 for s in summary if s["status"] == "ok")
            logger.info("刷新完成：%d/%d 个 GROUP 成功", ok, len(summary))
            _last_refresh["last_run"] = datetime.now(timezone.utc).isoformat()
            _last_refresh["summary"] = summary
            _last_refresh["next_run"] = datetime.now(timezone.utc).isoformat()
        except Exception as exc:  # noqa: BLE001
            logger.exception("刷新任务异常: %s", exc)

        # 计算下次运行时间
        _last_refresh["period_seconds"] = period
        await asyncio.sleep(period)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    logger.info("数据库已初始化：%s", settings.DATABASE_PATH)
    task = asyncio.create_task(_refresh_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Satellite TLE Persistence API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "total_satellites": db.count_all(),
        "groups": len(db.get_groups()),
        "refresh_period_seconds": settings.TLE_REFRESH_PERIOD,
    }


@app.get("/api/config")
def get_config() -> dict:
    return {
        "refresh_period_seconds": settings.TLE_REFRESH_PERIOD,
        "groups": settings.SAT_GROUPS,
        "celestrak_base": settings.CELESTRAK_BASE,
    }


@app.get("/api/groups")
def groups() -> dict:
    return {"groups": db.get_groups()}


@app.get("/api/tle")
def tle(group: str = Query(..., description="星座 / 卫星群名称")) -> dict:
    rows = db.get_tle(group)
    if not rows:
        raise HTTPException(status_code=404, detail=f"group '{group}' 无数据（可能尚未抓取成功）")
    return {"group": group, "count": len(rows), "satellites": rows}


@app.get("/api/satellites")
def satellites(
    group: Optional[str] = Query(None, description="指定 group；不传则返回全部"),
) -> dict:
    if group:
        rows = db.get_tle(group)
        if not rows:
            raise HTTPException(status_code=404, detail=f"group '{group}' 无数据")
        return {"group": group, "count": len(rows), "satellites": rows}
    rows = db.get_all_tle()
    return {"group": None, "count": len(rows), "satellites": rows}


@app.get("/api/status")
def status() -> dict:
    return _last_refresh


@app.post("/api/refresh")
async def trigger_refresh() -> dict:
    """手动触发一次刷新（用于调试 / 即时更新）。"""
    loop = asyncio.get_event_loop()
    summary = await loop.run_in_executor(None, refresh_all)
    _last_refresh["last_run"] = datetime.now(timezone.utc).isoformat()
    _last_refresh["summary"] = summary
    return {"ok": True, "summary": summary}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=False)
