import pandas as pd

from limpieza import clean

COLUMNS = [
    "Transaction ID", "Item", "Quantity", "Price Per Unit",
    "Total Spent", "Payment Method", "Location", "Transaction Date",
]

# Reference rows: they define the menu (Coffee=2.0, Tea=1.5, Juice=3.0, Cake=3.0).
BASE = [
    ["TXN_1", "Coffee", "2", "2.0", "4.0", "Cash", "In-store", "2023-01-01"],
    ["TXN_2", "Tea", "1", "1.5", "1.5", "Cash", "In-store", "2023-01-01"],
    ["TXN_3", "Juice", "1", "3.0", "3.0", "Cash", "In-store", "2023-01-01"],
    ["TXN_4", "Cake", "1", "3.0", "3.0", "Cash", "In-store", "2023-01-01"],
]


def run(*rows):
    raw = pd.DataFrame(BASE + [list(r) for r in rows], columns=COLUMNS, dtype=str)
    return clean(raw)


def row(df, txn):
    return df.set_index("transaction_id").loc[txn]


def test_sentinels_in_categorical_columns_become_unknown():
    df, _ = run(["TXN_9", "Coffee", "1", "2.0", "2.0", "ERROR", "", "2023-02-01"])
    assert row(df, "TXN_9")["payment_method"] == "Unknown"
    assert row(df, "TXN_9")["location"] == "Unknown"


def test_price_is_rebuilt_from_menu():
    df, _ = run(["TXN_9", "Tea", "2", "UNKNOWN", "ERROR", "Cash", "Takeaway", "2023-02-01"])
    assert row(df, "TXN_9")["price_per_unit"] == 1.5
    assert row(df, "TXN_9")["total_spent"] == 3.0


def test_item_is_rebuilt_from_unique_price():
    df, _ = run(["TXN_9", "ERROR", "3", "2.0", "6.0", "Cash", "Takeaway", "2023-02-01"])
    assert row(df, "TXN_9")["item"] == "Coffee"


def test_ambiguous_price_cannot_rebuild_item_and_row_is_dropped():
    df, report = run(["TXN_9", "", "1", "3.0", "3.0", "Cash", "Takeaway", "2023-02-01"])
    assert "TXN_9" not in df["transaction_id"].values
    assert report["dropped_unrecoverable"] == 1


def test_quantity_is_rebuilt_from_total_and_price():
    df, _ = run(["TXN_9", "Coffee", "", "2.0", "10.0", "Cash", "Takeaway", "2023-02-01"])
    assert row(df, "TXN_9")["quantity"] == 5


def test_invalid_date_drops_row():
    df, report = run(["TXN_9", "Coffee", "1", "2.0", "2.0", "Cash", "Takeaway", "ERROR"])
    assert "TXN_9" not in df["transaction_id"].values
    assert report["dropped_invalid_date"] == 1


def test_duplicated_transaction_ids_are_removed():
    df, report = run(BASE[0])
    assert (df["transaction_id"] == "TXN_1").sum() == 1
    assert report["dropped_duplicates"] == 1


def test_output_types():
    df, _ = run()
    assert str(df["quantity"].dtype) == "int64"
    assert str(df["price_per_unit"].dtype) == "float64"
    assert str(df["transaction_date"].dtype).startswith("datetime64")
