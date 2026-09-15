"""配置加载：从环境变量 / .env 读取运行参数。"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# 项目根目录（backend/），.env 放在 backend/ 下
_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_DIR / ".env")


def _csv_list(value: str, default: list[str]) -> list[str]:
    if not value:
        return default
    return [v.strip() for v in value.split(",") if v.strip()]


def _origins(value: str, default: list[str]) -> list[str]:
    return _csv_list(value, default)


class Settings:
    """全局配置。所有可调项均可通过环境变量覆盖。"""

    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    # TLE 刷新周期（秒），默认 7200
    TLE_REFRESH_PERIOD: int = int(os.getenv("TLE_REFRESH_PERIOD", "7200"))

    # 需要抓取的星座群
    SAT_GROUPS: list[str] = _csv_list(
        os.getenv("SAT_GROUPS", ""),
        [
            "starlink",
            "oneweb",
            "iridium-NEXT",
            "globalstar",
            "orbcomm",
            "gps-ops",
            "galileo",
            "beidou",
            "glonass",
            "ses",
            "intelsat",
        ],
    )

    CELESTRAK_BASE: str = os.getenv(
        "CELESTRAK_BASE", "https://celestrak.org/NORAD/elements/gp.php"
    )

    # 数据库路径：相对路径以 backend/ 为基准解析
    _raw_db = os.getenv("DATABASE_PATH", "../data/satellites.db")
    DATABASE_PATH: Path = (
        Path(_raw_db) if Path(_raw_db).is_absolute() else (_BACKEND_DIR / _raw_db)
    ).resolve()

    CORS_ORIGINS: list[str] = _origins(
        os.getenv("CORS_ORIGINS", ""),
        [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8080",
        ],
    )

    # 单次抓取超时（秒）
    FETCH_TIMEOUT: int = int(os.getenv("FETCH_TIMEOUT", "60"))


settings = Settings()
