"""celestrak GP 数据客户端：拉取并解析 TLE。

celestrak 按 IP + GROUP 限流，每 2 小时才允许重新下载同一 GROUP。
被限流时会返回一段提示文本（"GP data has not updated since ..."）而非 TLE 数据，
此时应跳过本次抓取、保留数据库中原有数据。
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Iterable

import requests

from .config import settings

_BLOCK_MARKER = "has not updated"
_USER_AGENT = "SatelliteRealTimeViewer/1.0 (educational)"


def _parse_epoch(line1: str) -> str | None:
    """从 TLE 第一行解析 epoch 为 ISO 时间字符串（UTC）。"""
    try:
        epoch_yy = int(line1[18:20])
        epoch_doy = float(line1[20:32])
    except (IndexError, ValueError):
        return None
    year = 2000 + epoch_yy if epoch_yy < 57 else 1900 + epoch_yy
    base = datetime(year, 1, 1, tzinfo=timezone.utc)
    # doy 从 1 开始；减去 1 天得到偏移
    dt = base + timedelta(days=epoch_doy - 1)
    return dt.isoformat()


def parse_tle(text: str) -> list[dict]:
    """解析 FORMAT=tle 的三行一组文本。返回记录列表。"""
    lines = [ln.rstrip("\r") for ln in text.splitlines() if ln.strip()]
    records: list[dict] = []
    for i in range(0, len(lines) - 2, 3):
        name, l1, l2 = lines[i], lines[i + 1], lines[i + 2]
        if not (l1.startswith("1 ") and l2.startswith("2 ")):
            continue
        norad_raw = l1[2:7].strip()
        try:
            norad_id = int(norad_raw)
        except ValueError:
            continue
        records.append(
            {
                "norad_id": norad_id,
                "name": name.strip(),
                "line1": l1,
                "line2": l2,
                "epoch": _parse_epoch(l1),
            }
        )
    return records


def fetch_group(group: str) -> tuple[str, list[dict], str]:
    """抓取单个 GROUP。

    返回 (status, records, note)，status ∈ {ok, blocked, empty, error}。
    """
    url = f"{settings.CELESTRAK_BASE}?GROUP={group}&FORMAT=tle"
    try:
        resp = requests.get(
            url,
            timeout=settings.FETCH_TIMEOUT,
            headers={"User-Agent": _USER_AGENT},
        )
    except requests.RequestException as exc:
        return "error", [], f"请求异常: {exc}"

    if resp.status_code != 200:
        return "error", [], f"HTTP {resp.status_code}"

    text = resp.text
    if _BLOCK_MARKER in text:
        return "blocked", [], "celestrak 限流（2 小时窗口内已下载过该 GROUP）"

    records = parse_tle(text)
    if not records:
        return "empty", [], "返回内容为空或无法解析"

    return "ok", records, f"抓取 {len(records)} 条"


def refresh_all(groups: Iterable[str] | None = None) -> list[dict]:
    """依次抓取所有 GROUP，写入数据库（被限流的保留旧数据），返回摘要。"""
    from . import db

    groups = list(groups if groups is not None else settings.SAT_GROUPS)
    summary: list[dict] = []
    for group in groups:
        status, records, note = fetch_group(group)
        if status == "ok":
            n = db.upsert_group(group, records, status="ok")
            summary.append({"group": group, "status": "ok", "count": n, "note": note})
        else:
            # 非 ok：保留数据库中已有数据，仅记录状态（不删除旧数据）
            db.log_fetch_only(group, status=status, count=0)
            existing = db.last_success(group)
            summary.append(
                {
                    "group": group,
                    "status": status,
                    "count": 0,
                    "note": note + (f"（保留旧数据，上次成功: {existing})" if existing else "（无历史数据）"),
                }
            )
    return summary


if __name__ == "__main__":
    # 直接运行可手动触发一次抓取
    db.init_db()
    for item in refresh_all():
        print(item)
