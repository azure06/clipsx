"""One-off installed vec1 qualification. Not used by the ClipsX runtime."""

from __future__ import annotations

import json
import os
import sqlite3
import statistics
import sys
import time
from pathlib import Path

import numpy as np


ROWS = int(os.environ.get("CLIPSX_VEC1_ROWS", "540000"))
DIMENSIONS = int(os.environ.get("CLIPSX_VEC1_DIMENSIONS", "1024"))
RUNS = int(os.environ.get("CLIPSX_VEC1_RUNS", "20"))
K = 10
ANN_CANDIDATES = 100
ANN_BUCKETS = 256
TRAINING_ROWS = ANN_BUCKETS * 100


def vectors():
    """Yield deterministic, normalized dense vectors in bounded batches."""
    random = np.random.default_rng(0xC11F5)
    rowid = 1
    while rowid <= ROWS:
        count = min(1_000, ROWS - rowid + 1)
        batch = random.standard_normal((count, DIMENSIONS), dtype=np.float32)
        batch /= np.linalg.norm(batch, axis=1, keepdims=True)
        for offset, vector in enumerate(batch):
            yield rowid + offset, vector.tobytes()
        rowid += count


def percentiles(samples: list[float]) -> dict[str, float]:
    ordered = sorted(samples)
    return {
        "p50_ms": round(statistics.median(ordered), 3),
        "p95_ms": round(ordered[max(0, int(len(ordered) * 0.95) - 1)], 3),
        "p99_ms": round(ordered[max(0, int(len(ordered) * 0.99) - 1)], 3),
    }


def timed_query(connection: sqlite3.Connection, sql: str, query: bytes) -> tuple[list[int], float]:
    started = time.perf_counter()
    rows = [row[0] for row in connection.execute(sql, (query,))]
    return rows, (time.perf_counter() - started) * 1000


def main() -> None:
    extension = Path(os.environ["CLIPSX_VEC1_DLL"]).resolve()
    database = Path(os.environ["CLIPSX_VEC1_DATABASE"]).resolve()
    if database.exists():
        database.unlink()
    connection = sqlite3.connect(database)
    connection.enable_load_extension(True)
    connection.load_extension(str(extension))
    connection.execute("PRAGMA journal_mode=OFF")
    connection.execute("PRAGMA synchronous=OFF")
    connection.execute("PRAGMA temp_store=MEMORY")
    connection.execute("CREATE VIRTUAL TABLE vectors USING vec1(vector)")

    started = time.perf_counter()
    with connection:
        connection.executemany(
            "INSERT INTO vectors(rowid, vector) VALUES (?, ?)",
            vectors(),
        )
    insert_seconds = time.perf_counter() - started

    started = time.perf_counter()
    connection.execute(
        "INSERT INTO vectors(cmd,arg) VALUES('rebuild','{index:\"flat\",distance:\"cos\"}')"
    )
    connection.commit()
    flat_build_seconds = time.perf_counter() - started
    query = connection.execute(
        "SELECT vector FROM vectors WHERE rowid=?", (ROWS // 2,)
    ).fetchone()[0]
    exact_sql = "SELECT rowid FROM vectors(?, '{k:10}')"
    exact_ids, _ = timed_query(connection, exact_sql, query)
    exact_times = [timed_query(connection, exact_sql, query)[1] for _ in range(RUNS)]

    started = time.perf_counter()
    model = connection.execute(
        "SELECT vec1_train(vector, "
        "'{nbucket:256,codesize:32,quantizer:\"opq\",distance:\"cos\"}') "
        "FROM (SELECT vector FROM vectors WHERE rowid % 5 = 0 LIMIT 25600)"
    ).fetchone()[0]
    train_seconds = time.perf_counter() - started
    started = time.perf_counter()
    connection.execute("INSERT INTO vectors(cmd,arg) VALUES('rebuild',?)", (model,))
    connection.commit()
    ann_build_seconds = time.perf_counter() - started
    ann_sql = (
        "SELECT rowid FROM vectors(?, '{k:100,nprobe:0.10}') "
        "ORDER BY vec1_cos_distance(?, vector) LIMIT 10"
    )

    def ann_query() -> tuple[list[int], float]:
        started_at = time.perf_counter()
        ids = [row[0] for row in connection.execute(ann_sql, (query, query))]
        return ids, (time.perf_counter() - started_at) * 1000

    ann_ids, _ = ann_query()
    ann_times = [ann_query()[1] for _ in range(RUNS)]
    recall_at_10 = len(set(exact_ids) & set(ann_ids)) / K

    report = {
        "vec1": connection.execute("SELECT vec1_info()").fetchone()[0],
        "rows": ROWS,
        "dimensions": DIMENSIONS,
        "database_bytes": database.stat().st_size,
        "insert_seconds": round(insert_seconds, 3),
        "flat_build_seconds": round(flat_build_seconds, 3),
        "flat_exact": percentiles(exact_times),
        "exact_ids": exact_ids,
        "ann_training_rows": TRAINING_ROWS,
        "ann_buckets": ANN_BUCKETS,
        "ann_candidates": ANN_CANDIDATES,
        "ann_train_seconds": round(train_seconds, 3),
        "ann_build_seconds": round(ann_build_seconds, 3),
        "ann_reranked": percentiles(ann_times),
        "ann_ids": ann_ids,
        "recall_at_10": recall_at_10,
    }
    print(json.dumps(report, separators=(",", ":")), flush=True)
    connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise
