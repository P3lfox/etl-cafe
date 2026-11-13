"""Step 1 of the pipeline: clean the raw cafe sales CSV.

Reads data/raw/dirty_cafe_sales.csv and writes:
  - data/clean/cafe_sales_clean.csv   (clean table, input for carga.py)
  - data/clean/cleaning_report.csv    (what was fixed or dropped, and how many)

Strategy: rebuild values that can be derived deterministically instead of
inventing them (no mean/mode imputation):
  - total_spent = quantity * price_per_unit, so any one of the three can be
    derived from the other two;
  - each item has a fixed menu price, so price <-> item can be derived when
    the price belongs to a single item.
Rows that still miss a required value after rebuilding are dropped.
"""

from pathlib import Path

import pandas as pd

RAW_FILE = Path("data/raw/dirty_cafe_sales.csv")
CLEAN_FILE = Path("data/clean/cafe_sales_clean.csv")
REPORT_FILE = Path("data/clean/cleaning_report.csv")

COLUMN_NAMES = {
    "Transaction ID": "transaction_id",
    "Item": "item",
    "Quantity": "quantity",
    "Price Per Unit": "price_per_unit",
    "Total Spent": "total_spent",
    "Payment Method": "payment_method",
    "Location": "location",
    "Transaction Date": "transaction_date",
}
SENTINELS = {"", "ERROR", "UNKNOWN"}
NUMERIC_COLUMNS = ["quantity", "price_per_unit", "total_spent"]
REBUILDABLE_COLUMNS = ["item", *NUMERIC_COLUMNS]
OPTIONAL_CATEGORIES = ["payment_method", "location"]
UNKNOWN_LABEL = "Unknown"
TOLERANCE = 0.01


def normalize_text(df: pd.DataFrame) -> pd.DataFrame:
    """Trim whitespace and turn every sentinel value into a real missing value."""
    df = df.apply(lambda s: s.str.strip())
    return df.mask(df.isna() | df.apply(lambda s: s.str.upper().isin(SENTINELS)))


def build_menu(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Return item -> price and price -> item (only for unambiguous prices)."""
    known = df.dropna(subset=["item", "price_per_unit"])
    item_to_price = known.groupby("item")["price_per_unit"].agg(lambda s: s.mode().iloc[0])
    items_per_price = item_to_price.reset_index().groupby("price_per_unit")["item"]
    unique = items_per_price.nunique() == 1
    price_to_item = items_per_price.first()[unique]
    return item_to_price, price_to_item


def rebuild_values(df: pd.DataFrame) -> pd.DataFrame:
    """Derive missing item/quantity/price/total from the values that are present."""
    item_to_price, price_to_item = build_menu(df)
    for _ in range(2):  # a second pass uses values rebuilt by the first one
        df["price_per_unit"] = df["price_per_unit"].fillna(df["item"].map(item_to_price))
        df["item"] = df["item"].fillna(df["price_per_unit"].map(price_to_item))
        df["price_per_unit"] = df["price_per_unit"].fillna(df["total_spent"] / df["quantity"])

        qty = df["total_spent"] / df["price_per_unit"]
        whole_qty = qty.where((qty - qty.round()).abs() < TOLERANCE).round()
        df["quantity"] = df["quantity"].fillna(whole_qty)

        df["total_spent"] = df["total_spent"].fillna(df["quantity"] * df["price_per_unit"])
    return df


def clean(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Clean the raw table and return (clean_df, report)."""
    report: dict = {"rows_input": len(raw)}
    df = normalize_text(raw.rename(columns=COLUMN_NAMES).astype("string"))

    before = len(df)
    df = df.drop_duplicates(subset="transaction_id", keep="first")
    report["dropped_duplicates"] = before - len(df)

    df = df.astype(object).where(df.notna(), None)
    for col in NUMERIC_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
        df.loc[df[col] <= 0, col] = None  # impossible values count as missing
    df["transaction_date"] = pd.to_datetime(df["transaction_date"], format="%Y-%m-%d", errors="coerce")

    before = len(df)
    df = df[df["transaction_date"].notna()].copy()
    report["dropped_invalid_date"] = before - len(df)

    missing_before = df[REBUILDABLE_COLUMNS].isna().sum()
    df = rebuild_values(df)
    missing_after = df[REBUILDABLE_COLUMNS].isna().sum()

    unrecoverable = df[REBUILDABLE_COLUMNS].isna().any(axis=1)
    report["dropped_unrecoverable"] = int(unrecoverable.sum())
    df = df[~unrecoverable].copy()

    inconsistent = (df["quantity"] * df["price_per_unit"] - df["total_spent"]).abs() > TOLERANCE
    report["dropped_inconsistent_total"] = int(inconsistent.sum())
    df = df[~inconsistent].copy()

    for col in REBUILDABLE_COLUMNS:
        report[f"rebuilt_{col}"] = int(missing_before[col] - missing_after[col])
    for col in OPTIONAL_CATEGORIES:
        report[f"filled_unknown_{col}"] = int(df[col].isna().sum())
        df[col] = df[col].fillna(UNKNOWN_LABEL)

    df = df.astype({
        "transaction_id": "string",
        "item": "string",
        "quantity": "int64",
        "price_per_unit": "float64",
        "total_spent": "float64",
        "payment_method": "string",
        "location": "string",
    })
    df = df.sort_values(["transaction_date", "transaction_id"]).reset_index(drop=True)
    report["rows_output"] = len(df)
    return df, report


def main() -> None:
    raw = pd.read_csv(RAW_FILE, dtype=str, keep_default_na=False)
    df, report = clean(raw)

    CLEAN_FILE.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(CLEAN_FILE, index=False, date_format="%Y-%m-%d")
    pd.Series(report, name="value").rename_axis("metric").to_csv(REPORT_FILE)

    print("Cleaning report")
    print("-" * 40)
    for metric, value in report.items():
        print(f"{metric:<32}{value:>8}")
    print("-" * 40)
    print(f"Clean file:  {CLEAN_FILE}")
    print(f"Report file: {REPORT_FILE}")


if __name__ == "__main__":
    main()
