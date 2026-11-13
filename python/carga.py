"""Step 2 of the pipeline: load the clean CSV into MariaDB / MySQL.

Reads data/clean/cafe_sales_clean.csv, creates the schema (sql/schema.sql)
if needed, fills the lookup tables and upserts every sale. Re-running it is
safe: existing rows are updated instead of duplicated.

Connection settings: see db.py.
"""

from pathlib import Path

import pandas as pd

from db import connect

ROOT = Path(__file__).resolve().parent.parent  # repo root: data/ and sql/ are shared
CLEAN_FILE = ROOT / "data/clean/cafe_sales_clean.csv"
SCHEMA_FILE = ROOT / "sql/schema.sql"


def build_menu(df: pd.DataFrame) -> dict[str, float]:
    """Menu price of each item = its most frequent unit price."""
    menu = df.groupby("item")["price_per_unit"].agg(lambda s: s.mode().iloc[0])
    return {str(item): float(price) for item, price in menu.items()}


def build_sales_rows(
    df: pd.DataFrame,
    item_ids: dict[str, int],
    payment_ids: dict[str, int],
    location_ids: dict[str, int],
) -> list[tuple]:
    """Turn clean rows into `sales` tuples, replacing names with foreign keys."""
    return [
        (
            str(r.transaction_id),
            str(r.transaction_date),
            item_ids[r.item],
            int(r.quantity),
            float(r.price_per_unit),
            float(r.total_spent),
            payment_ids[r.payment_method],
            location_ids[r.location],
        )
        for r in df.itertuples(index=False)
    ]


def apply_schema(cursor) -> None:
    # Drop comment lines first: a ';' inside a comment must not split a statement.
    lines = SCHEMA_FILE.read_text(encoding="utf-8").splitlines()
    script = "\n".join(ln for ln in lines if not ln.strip().startswith("--"))
    for statement in script.split(";"):
        sql = statement.strip()
        if sql:
            cursor.execute(sql)


def upsert_lookup(cursor, table: str, id_column: str, names) -> dict[str, int]:
    cursor.executemany(f"INSERT IGNORE INTO {table} (name) VALUES (%s)", [(n,) for n in sorted(names)])
    cursor.execute(f"SELECT name, {id_column} FROM {table}")
    return dict(cursor.fetchall())


def upsert_items(cursor, menu: dict[str, float]) -> dict[str, int]:
    cursor.executemany(
        "INSERT INTO items (name, menu_price) VALUES (%s, %s) "
        "ON DUPLICATE KEY UPDATE menu_price = VALUES(menu_price)",
        sorted(menu.items()),
    )
    cursor.execute("SELECT name, item_id FROM items")
    return dict(cursor.fetchall())


def load(df: pd.DataFrame, conn) -> int:
    """Load everything in one transaction; return the row count in `sales`."""
    try:
        with conn.cursor() as cursor:
            apply_schema(cursor)
            item_ids = upsert_items(cursor, build_menu(df))
            payment_ids = upsert_lookup(cursor, "payment_methods", "payment_method_id", df["payment_method"].unique())
            location_ids = upsert_lookup(cursor, "locations", "location_id", df["location"].unique())

            cursor.executemany(
                """
                INSERT INTO sales (
                    transaction_id, transaction_date, item_id, quantity,
                    price_per_unit, total_spent, payment_method_id, location_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    transaction_date = VALUES(transaction_date),
                    item_id = VALUES(item_id),
                    quantity = VALUES(quantity),
                    price_per_unit = VALUES(price_per_unit),
                    total_spent = VALUES(total_spent),
                    payment_method_id = VALUES(payment_method_id),
                    location_id = VALUES(location_id)
                """,
                build_sales_rows(df, item_ids, payment_ids, location_ids),
            )
            cursor.execute("SELECT COUNT(*) FROM sales")
            total = cursor.fetchone()[0]
        conn.commit()
        return total
    except Exception:
        conn.rollback()
        raise


def main() -> None:
    df = pd.read_csv(CLEAN_FILE, dtype={"transaction_id": str, "transaction_date": str})
    conn = connect(autocommit=False)
    try:
        total = load(df, conn)
    finally:
        conn.close()
    print(f"Rows in clean file: {len(df)}")
    print(f"Rows in sales table: {total}")


if __name__ == "__main__":
    main()
