import pandas as pd

import carga
from carga import apply_schema, build_menu, build_sales_rows


class RecordingCursor:
    def __init__(self):
        self.statements = []

    def execute(self, sql):
        self.statements.append(sql)


def test_schema_comments_with_semicolons_are_not_executed(tmp_path, monkeypatch):
    schema = tmp_path / "schema.sql"
    schema.write_text("-- one; two\nCREATE TABLE a (x INT);\n-- tail\nCREATE TABLE b (y INT);\n")
    monkeypatch.setattr(carga, "SCHEMA_FILE", schema)
    cursor = RecordingCursor()
    apply_schema(cursor)
    assert cursor.statements == ["CREATE TABLE a (x INT)", "CREATE TABLE b (y INT)"]

CLEAN = pd.DataFrame({
    "transaction_id": ["TXN_1", "TXN_2", "TXN_3"],
    "item": ["Coffee", "Coffee", "Tea"],
    "quantity": [2, 1, 3],
    "price_per_unit": [2.0, 2.0, 1.5],
    "total_spent": [4.0, 2.0, 4.5],
    "payment_method": ["Cash", "Unknown", "Cash"],
    "location": ["In-store", "Takeaway", "Unknown"],
    "transaction_date": ["2023-01-01", "2023-01-02", "2023-01-03"],
})


def test_menu_has_one_price_per_item():
    assert build_menu(CLEAN) == {"Coffee": 2.0, "Tea": 1.5}


def test_sales_rows_use_foreign_keys_in_insert_order():
    rows = build_sales_rows(
        CLEAN,
        item_ids={"Coffee": 1, "Tea": 2},
        payment_ids={"Cash": 10, "Unknown": 11},
        location_ids={"In-store": 20, "Takeaway": 21, "Unknown": 22},
    )
    assert rows[0] == ("TXN_1", "2023-01-01", 1, 2, 2.0, 4.0, 10, 20)
    assert rows[2] == ("TXN_3", "2023-01-03", 2, 3, 1.5, 4.5, 10, 22)
    assert len(rows) == 3
