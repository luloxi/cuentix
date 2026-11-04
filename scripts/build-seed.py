#!/usr/bin/env python3
"""Build an idempotent seed.sql from the local legacy sqlite file.

Reads --old-db (default /workspace/cuentix-v2/old.db). Does not touch remote D1.
Writes SQL to --out (default /workspace/cuentix-v2/seed.sql), which must stay out of git.
The file has no BEGIN/COMMIT: D1 rejects those statements in `wrangler d1 execute --file`.
Re-running is safe because transactions use INSERT OR IGNORE and balances use ON CONFLICT.

Stdout is counts only. Ambiguous description shapes, without amounts, go to stderr.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import re
import sqlite3
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

SOURCE_RANK = {
    "csv_import": 70,
    "xlsx_import": 60,
    "sheet_import": 50,
    "casita_csv": 40,
    "statement_pdf": 30,
    "bbva_pdf": 20,
    "bbva_import": 10,
}

INTERNAL_CATEGORIES = {"Conversiones", "Transferencia interna", "Pagos"}
INTERNAL_PHRASES = (
    "cuenta tuya",
    "cuenta propia",
    "own account",
    "own cuit",
    "cambio de moneda",
    "prestamo",
    "devolvio deuda",
    "transferencia deuda",
    "su pago en",
    "pago de tarjeta",
    "pago visa",
)

BALANCE_SEED = (
    ("Fiwind", "USDT", 1961.41, "2026-11-03", "manual"),
    ("Fiwind", "ARS", 10145.02, "2026-11-03", "manual"),
)


def fold(value: str | None) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"\s+", " ", text).lower().strip()


def shape_of(value: str | None) -> str:
    text = fold(value)
    text = re.sub(r"\d+(?:[.,]\d+)*", "#", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:90]


def numeric_only(value: str | None) -> bool:
    text = (value or "").strip()
    if not text or not re.fullmatch(r"[0-9.,/\s]+", text):
        return False
    return any(char.isdigit() for char in text)


def parse_amount(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number


def cents(value: float | None) -> int:
    return int(round(abs(value or 0.0) * 100))


def sql_str(value: str) -> str:
    cleaned = value.replace("\x00", " ").replace("\r", " ").replace("\n", " ")
    return "'" + cleaned.replace("'", "''") + "'"


def sql_num(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError("non-finite amount")
    text = f"{value:.6f}".rstrip("0").rstrip(".")
    if text in {"", "-0"}:
        return "0"
    return text


def account_name(bank: str | None, source: str | None) -> str:
    if bank == "Fiwind":
        return "Fiwind"
    if bank == "BBVA":
        return "BBVA caja"
    if (bank is None or str(bank).strip() == "") and source in {"bbva_import", "bbva_pdf"}:
        return "BBVA tarjeta"
    return "Sin cuenta"


def generic_description(folded: str) -> bool:
    if folded == "deposito":
        return True
    if folded.startswith("debito debin"):
        return True
    if folded.startswith("pago con visa debito"):
        return True
    return False


def blocked_credit_shape(folded: str) -> bool:
    """Generic deposit or DEBIN, not 'deposito de <persona>'."""
    return generic_description(folded) or folded.startswith("debin ")


def classify(category: str, description: str, is_credit: int, is_payment: int, raw_amount: float) -> tuple[str, str, float, bool]:
    folded = fold(description)
    credit = bool(is_credit)
    payment = bool(is_payment)
    ambiguous = False

    if category in INTERNAL_CATEGORIES:
        kind = "internal_transfer"
        out_category = "Conversiones" if category == "Conversiones" else "Transferencia interna"
    elif category == "Crypto / inversiones":
        kind = "internal_transfer"
        out_category = "Transferencia interna"
    elif folded.startswith("conversion") or any(phrase in folded for phrase in INTERNAL_PHRASES):
        kind = "internal_transfer"
        out_category = "Conversiones" if category == "Conversiones" else "Transferencia interna"
        if category not in INTERNAL_CATEGORIES:
            ambiguous = True
    elif category == "Rendimientos":
        kind = "income"
        out_category = "Rendimientos"
    elif payment and generic_description(folded):
        kind = "internal_transfer"
        out_category = "Transferencia interna"
        ambiguous = True
    elif credit and category == "Uncategorized" and not folded.startswith("pago a") and not blocked_credit_shape(folded):
        kind = "income"
        out_category = "Ingreso"
        ambiguous = True
    else:
        kind = "expense"
        out_category = category or "Uncategorized"
        if credit and category == "Uncategorized":
            ambiguous = True
        if "debin" in folded or generic_description(folded):
            ambiguous = True

    amount = abs(raw_amount)
    if kind == "expense" and credit:
        amount = -amount
    return kind, out_category, amount, ambiguous


def similar(label: str, description: str) -> bool:
    left = fold(label)
    right = fold(description)
    if not left or not right:
        return False
    if left in right or right in left:
        return True
    left_tokens = {token for token in re.split(r"[^a-z0-9]+", left) if len(token) >= 4}
    right_tokens = {token for token in re.split(r"[^a-z0-9]+", right) if len(token) >= 4}
    if not left_tokens or not right_tokens:
        return False
    overlap = left_tokens & right_tokens
    return len(overlap) >= min(len(left_tokens), len(right_tokens), 2) or (len(overlap) / len(left_tokens) >= 0.6)


def choose_currency(account: str, amount_ars: object, amount_usd: object) -> tuple[str, float, str] | None:
    """Return currency, raw signed amount, and description suffix. None when empty."""
    ars = parse_amount(amount_ars)
    usd = parse_amount(amount_usd)
    usd_nonzero = usd is not None and usd != 0
    ars_nonzero = ars is not None and ars != 0
    if usd_nonzero:
        currency = "USDT" if account == "Fiwind" else "USD"
        suffix = ""
        if ars_nonzero:
            suffix = f" (ARS {str(amount_ars).strip()})"
        return currency, float(usd), suffix
    if ars_nonzero:
        return "ARS", float(ars), ""
    return None


def chunked(statements_rows: list[str], header: str, max_rows: int = 80, max_bytes: int = 70_000) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    size = len(header)
    for row in statements_rows:
        if current and (len(current) >= max_rows or size + len(row) > max_bytes):
            chunks.append(header + ",\n".join(current) + ";\n")
            current = []
            size = len(header)
        current.append(row)
        size += len(row) + 2
    if current:
        chunks.append(header + ",\n".join(current) + ";\n")
    return chunks


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Cuentix v2 seed.sql from the legacy sqlite file.")
    parser.add_argument("--old-db", default="/workspace/cuentix-v2/old.db")
    parser.add_argument("--out", default="/workspace/cuentix-v2/seed.sql")
    args = parser.parse_args()

    db_path = Path(args.old_db)
    if not db_path.is_file():
        print(f"old db not found: {db_path}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    transactions = conn.execute(
        """
        SELECT t.id, t.date, t.description_raw, t.amount_ars, t.amount_usd,
               t.is_payment, t.is_credit, t.external_fingerprint, t.source, t.bank,
               h.name AS household, c.name AS category
        FROM transactions t
        JOIN households h ON h.id = t.household_id
        LEFT JOIN categories c ON c.id = t.category_id
        """
    ).fetchall()
    incomes = conn.execute(
        """
        SELECT i.date, i.label, i.amount_ars, i.amount_usd, i.external_fingerprint, h.name AS household
        FROM incomes i
        JOIN households h ON h.id = i.household_id
        """
    ).fetchall()
    conn.close()

    named_keys: set[tuple[str, int, int]] = set()
    for row in transactions:
        if row["bank"] != "Fiwind" or numeric_only(row["description_raw"]):
            continue
        named_keys.add((row["date"], cents(parse_amount(row["amount_ars"])), cents(parse_amount(row["amount_usd"]))))

    dropped = defaultdict(int)
    prepared: list[dict] = []
    ambiguous: dict[tuple[str, str], int] = defaultdict(int)

    for row in transactions:
        if row["household"] != "Personal":
            dropped["other_household"] += 1
            continue
        if row["bank"] == "Fiwind" and numeric_only(row["description_raw"]):
            key = (row["date"], cents(parse_amount(row["amount_ars"])), cents(parse_amount(row["amount_usd"])))
            if key in named_keys:
                dropped["ockham"] += 1
                continue
        account = account_name(row["bank"], row["source"])
        chosen = choose_currency(account, row["amount_ars"], row["amount_usd"])
        if chosen is None:
            dropped["empty"] += 1
            continue
        currency, raw_amount, suffix = chosen
        category = row["category"] or "Uncategorized"
        kind, out_category, amount, is_ambiguous = classify(
            category,
            row["description_raw"] or "",
            int(row["is_credit"] or 0),
            int(row["is_payment"] or 0),
            raw_amount,
        )
        description = (row["description_raw"] or "").strip() + suffix
        external = row["external_fingerprint"] or hashlib.sha256(
            f"{row['id']}|{row['date']}|{amount}|{description}".encode()
        ).hexdigest()
        item = {
            "id": row["id"],
            "date": row["date"],
            "amount": amount,
            "currency": currency,
            "account": account,
            "category": out_category,
            "description": description,
            "original_description": row["description_raw"] or "",
            "kind": kind,
            "source": row["source"],
            "external_key": external,
            "ambiguous": is_ambiguous,
        }
        prepared.append(item)

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for item in prepared:
        key = (
            item["date"],
            item["currency"],
            cents(item["amount"]),
            fold(item["original_description"]),
            item["account"],
        )
        groups[key].append(item)

    kept: list[dict] = []
    for items in groups.values():
        sources = {item["source"] or "" for item in items}
        if len(sources) <= 1:
            kept.extend(items)
            continue
        best_rank = max(SOURCE_RANK.get(source, 0) for source in sources)
        best_sources = sorted(source for source in sources if SOURCE_RANK.get(source, 0) == best_rank)
        winner = best_sources[0]
        for item in items:
            if (item["source"] or "") == winner:
                kept.append(item)
            else:
                dropped["cross_source"] += 1

    skipped_income_shapes: dict[tuple[str, str], int] = defaultdict(int)

    def find_match(date: str, currency: str, amount: float, label: str) -> dict | None:
        candidates = []
        for item in kept:
            if item["date"] != date or item["currency"] != currency:
                continue
            if cents(item["amount"]) != cents(amount):
                continue
            if not similar(label, item["original_description"]):
                continue
            score = 2 if fold(label) in fold(item["original_description"]) or fold(item["original_description"]) in fold(label) else 1
            candidates.append((score, str(item["id"]), item))
        if not candidates:
            return None
        candidates.sort(key=lambda pair: (-pair[0], pair[1]))
        return candidates[0][2]

    for income in incomes:
        label = income["label"] or ""
        folded = fold(label)
        if income["household"] != "Personal":
            dropped["income_other_household"] += 1
            continue
        if "devolucion" in folded or "devolvio" in folded:
            dropped["income_not_real"] += 1
            skipped_income_shapes[("income_not_real", shape_of(label))] += 1
            continue
        chosen = choose_currency("Sin cuenta", income["amount_ars"], income["amount_usd"])
        if chosen is None:
            dropped["income_empty"] += 1
            continue
        currency, raw_amount, suffix = chosen
        match = find_match(income["date"], currency, abs(raw_amount), label)
        if match is not None:
            if match["kind"] == "expense":
                match["kind"] = "income"
                match["category"] = "Ingreso"
                match["amount"] = abs(match["amount"])
                match["ambiguous"] = True
                dropped["income_relabel"] += 1
            else:
                dropped["income_duplicate"] += 1
            continue
        fingerprint = income["external_fingerprint"] or hashlib.sha256(
            f"income|{income['date']}|{label}|{raw_amount}".encode()
        ).hexdigest()
        kept.append(
            {
                "id": f"income-{fingerprint}",
                "date": income["date"],
                "amount": abs(raw_amount),
                "currency": currency,
                "account": "Sin cuenta",
                "category": "Ingreso",
                "description": label.strip() + suffix,
                "original_description": label,
                "kind": "income",
                "source": "incomes",
                "external_key": f"income:{fingerprint}",
                "ambiguous": True,
            }
        )
        dropped["income_added"] += 1

    for item in kept:
        if item["ambiguous"]:
            ambiguous[(item["kind"], shape_of(item["original_description"]))] += 1

    seen: dict[str, int] = {}
    kept.sort(key=lambda item: (str(item["date"]), str(item["external_key"]), str(item["id"])))
    for item in kept:
        key = str(item["external_key"])
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            item["external_key"] = f"{key}~{seen[key]}"

    accounts = sorted({item["account"] for item in kept} | {"Fiwind", "BBVA caja", "BBVA tarjeta", "Brubank", "Sin cuenta"})
    categories = sorted({item["category"] for item in kept} | {"Ingreso", "Rendimientos", "Transferencia interna", "Conversiones", "Uncategorized"})

    lines: list[str] = [
        "-- Generated by scripts/build-seed.py. Do not commit.\n",
        "PRAGMA foreign_keys = ON;\n",
    ]
    account_header = "INSERT OR IGNORE INTO accounts (name, household) VALUES\n"
    account_rows = [f"({sql_str(name)}, 'Personal')" for name in accounts]
    lines.extend(chunked(account_rows, account_header, max_rows=50))
    category_header = "INSERT OR IGNORE INTO categories (name) VALUES\n"
    category_rows = [f"({sql_str(name)})" for name in categories]
    lines.extend(chunked(category_rows, category_header, max_rows=50))

    tx_header = (
        "INSERT OR IGNORE INTO transactions "
        "(date, amount, currency, account_id, category_id, description, kind, source, external_key) VALUES\n"
    )
    tx_rows = []
    for item in kept:
        source_sql = "NULL" if item["source"] is None else sql_str(str(item["source"]))
        tx_rows.append(
            "("
            f"{sql_str(str(item['date']))}, {sql_num(float(item['amount']))}, {sql_str(item['currency'])}, "
            f"(SELECT id FROM accounts WHERE name = {sql_str(item['account'])}), "
            f"(SELECT id FROM categories WHERE name = {sql_str(item['category'])}), "
            f"{sql_str(item['description'])}, {sql_str(item['kind'])}, {source_sql}, {sql_str(item['external_key'])}"
            ")"
        )
    lines.extend(chunked(tx_rows, tx_header))

    for account, currency, amount, date, source in BALANCE_SEED:
        lines.append(
            "INSERT INTO balance_snapshots (date, account_id, currency, amount, source) "
            f"SELECT {sql_str(date)}, id, {sql_str(currency)}, {sql_num(amount)}, {sql_str(source)} "
            f"FROM accounts WHERE name = {sql_str(account)} "
            "ON CONFLICT(account_id, currency, date) DO UPDATE SET "
            "amount = excluded.amount, source = excluded.source;\n"
        )
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(lines)
    for statement in text.split(";\n"):
        body = statement.strip()
        if body and len(body.encode()) > 100_000:
            print("a SQL statement exceeded 100KB", file=sys.stderr)
            return 1
    out_path.write_text(text, encoding="utf-8")

    by_kind: dict[tuple[str, str], list[float]] = defaultdict(list)
    for item in kept:
        by_kind[(item["kind"], item["currency"])].append(float(item["amount"]))

    print("rows_by_kind_currency")
    print(f"{'kind':<22} {'currency':<8} {'rows':>8} {'sum':>16}")
    for kind, currency in sorted(by_kind):
        amounts = by_kind[(kind, currency)]
        print(f"{kind:<22} {currency:<8} {len(amounts):>8} {sum(amounts):>16.2f}")
    print(f"{'kept_rows':<22} {'':<8} {len(kept):>8}")
    print("dropped_or_adjusted")
    for reason in (
        "other_household",
        "ockham",
        "empty",
        "cross_source",
        "income_other_household",
        "income_not_real",
        "income_empty",
        "income_duplicate",
        "income_relabel",
        "income_added",
    ):
        print(f"{reason:<22} {dropped[reason]:>8}")
    print(f"ambiguous_rows {sum(ambiguous.values())}")
    print(f"wrote {out_path} bytes {out_path.stat().st_size}")

    print("ambiguous description shapes (no amounts)", file=sys.stderr)
    print(f"{'count':>6}  {'kind':<20}  shape", file=sys.stderr)
    ranked = sorted(ambiguous.items(), key=lambda pair: (-pair[1], pair[0][0], pair[0][1]))
    for (kind, text_shape), count in ranked[:40]:
        print(f"{count:>6}  {kind:<20}  {text_shape}", file=sys.stderr)
    if skipped_income_shapes:
        print("skipped income labels (no amounts)", file=sys.stderr)
        for (reason, text_shape), count in sorted(skipped_income_shapes.items()):
            print(f"{count:>6}  {reason:<20}  {text_shape}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
