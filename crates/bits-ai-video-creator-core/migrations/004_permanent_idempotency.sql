-- Make scheduled-slot idempotency permanent.
--
-- The original partial unique index only covered queued/running runs, which
-- allowed the same cron slot to be inserted again after the first run
-- completed (or after a crash recovery marked it failed). The scheduler uses
-- idempotency keys per slot, so the key must stay reserved for the lifetime of
-- the database.
--
-- Existing databases may contain historical duplicates. Keep the newest run
-- for each key and clear the key on older rows before creating the unique
-- index.
UPDATE runs
SET idempotency_key = NULL
WHERE id IN (
    SELECT id
    FROM (
        SELECT
            id,
            ROW_NUMBER() OVER (
                PARTITION BY idempotency_key
                ORDER BY queued_at DESC, id DESC
            ) AS duplicate_rank
        FROM runs
        WHERE idempotency_key IS NOT NULL
    )
    WHERE duplicate_rank > 1
);

DROP INDEX IF EXISTS idx_runs_active_idem;

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_idempotency_key
    ON runs(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
