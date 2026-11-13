"""Shared MariaDB / MySQL connection settings for carga.py and api.py.

Settings come from environment variables, or from the .env file at the repo
root (shared with the Node and Go APIs): DB_HOST, DB_PORT, DB_USER,
DB_PASSWORD, DB_NAME.
"""

import os
from pathlib import Path

import pymysql
from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def connect(**options) -> pymysql.connections.Connection:
    load_dotenv(ENV_FILE)
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
        charset="utf8mb4",
        connect_timeout=5,
        **options,
    )
