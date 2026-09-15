"""SQLite 持久化层：建立库表、TLE 的写入与查询。"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .config import settings


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_dir() -> None:
    settings.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    _ensure_dir()
    conn = sqlite3.connect(str(settings.DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db() -> None:
    """建表（幂等）。"""
    _ensure_dir()
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS satellites (
                norad_id   INTEGER NOT NULL,
                group_name TEXT   NOT NULL,
                name       TEXT   NOT NULL,
                line1      TEXT   NOT NULL,
                line2      TEXT   NOT NULL,
                epoch      TEXT,
                updated_at TEXT  NOT NULL,
                PRIMARY KEY (norad_id, group_name)
            );

            CREATE INDEX IF NOT EXISTS idx_sat_group ON satellites(group_name);

            CREATE TABLE IF NOT EXISTS fetch_log (
                group_name   TEXT PRIMARY KEY,
                last_attempt TEXT NOT NULL,
                last_success TEXT,
                status       TEXT NOT NULL,
                count        INTEGER NOT NULL DEFAULT 0
            );
            """
        )


@contextmanager
def _txn():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def upsert_group(
    group: str,
    records: Iterable[dict],
    *,
    status: str = "ok",
) -> int:
    """用新抓取的 TLE 替换某个 group 的全部记录，并记录抓取日志。

    records: iterable of {norad_id, name, line1, line2, epoch}
    返回写入的记录数。
    """
    now = _now_iso()
    rows = []
    for r in records:
        rows.append(
            (
                int(r["norad_id"]),
                group,
                r["name"],
                r["line1"],
                r["line2"],
                r.get("epoch"),
                now,
            )
        )
    with _txn() as conn:
        conn.execute("DELETE FROM satellites WHERE group_name = ?", (group,))
        if rows:
            conn.executemany(
                """
                INSERT INTO satellites
                    (norad_id, group_name, name, line1, line2, epoch, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
        conn.execute(
            """
            INSERT INTO fetch_log
                (group_name, last_attempt, last_success, status, count)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(group_name) DO UPDATE SET
                last_attempt = excluded.last_attempt,
                last_success = excluded.last_success,
                status       = excluded.status,
                count        = excluded.count
            """,
            (group, now, now if status == "ok" else None, status, len(rows)),
        )
    return len(rows)


def log_fetch_only(group: str, *, status: str, count: int = 0) -> None:
    """仅更新抓取日志，不触碰 satellites 表（用于被限流 / 空数据时保留旧数据）。"""
    now = _now_iso()
    with _txn() as conn:
        conn.execute(
            """
            INSERT INTO fetch_log
                (group_name, last_attempt, last_success, status, count)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(group_name) DO UPDATE SET
                last_attempt = excluded.last_attempt,
                status       = excluded.status,
                count        = excluded.count
            """,
            (group, now, now if status == "ok" else None, status, count),
        )


def get_groups() -> list[dict]:
    """返回所有 group 的概况（名称、卫星数、最近抓取状态/时间）。"""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT s.group_name            AS group_name,
                   COUNT(*)                AS satellite_count,
                   MAX(s.updated_at)       AS updated_at,
                   f.status                AS last_status,
                   f.last_success          AS last_success,
                   f.last_attempt          AS last_attempt
            FROM satellites s
            LEFT JOIN fetch_log f ON f.group_name = s.group_name
            GROUP BY s.group_name
            ORDER BY s.group_name
            """
        ).fetchall()
        return [dict(r) for r in rows]


def get_tle(group: str) -> list[dict]:
    """返回指定 group 的最新 TLE 列表。"""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT norad_id, group_name, name, line1, line2, epoch, updated_at
            FROM satellites
            WHERE group_name = ?
            ORDER BY norad_id
            """,
            (group,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_all_tle() -> list[dict]:
    """返回所有 group 的 TLE（全卫星视图用）。"""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT norad_id, group_name, name, line1, line2, epoch, updated_at
            FROM satellites
            ORDER BY group_name, norad_id
            """
        ).fetchall()
        return [dict(r) for r in rows]


def count_all() -> int:
    with get_connection() as conn:
        return conn.execute("SELECT COUNT(*) FROM satellites").fetchone()[0]


def last_success(group: str) -> str | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT last_success FROM fetch_log WHERE group_name = ?", (group,)
        ).fetchone()
        return row["last_success"] if row else None
