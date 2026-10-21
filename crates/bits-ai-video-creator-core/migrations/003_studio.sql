-- Native studio features: storyboard aggregates and generated voiceover files.
-- Scenes and shots are nested editing data, so they live in a JSON aggregate;
-- counts and runtime are denormalised for fast list and dashboard queries.

CREATE TABLE IF NOT EXISTS storyboards (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    logline TEXT NOT NULL DEFAULT '',
    style TEXT NOT NULL DEFAULT 'Cinematic',
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    scenes TEXT NOT NULL DEFAULT '[]',
    scene_count INTEGER NOT NULL DEFAULT 0,
    shot_count INTEGER NOT NULL DEFAULT 0,
    total_duration_seconds INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storyboards_updated
    ON storyboards(updated_at DESC);

CREATE TABLE IF NOT EXISTS voiceover_assets (
    id TEXT PRIMARY KEY,
    storyboard_id TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
    scene_id TEXT NOT NULL,
    path TEXT NOT NULL,
    format TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    voice TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voiceover_assets_storyboard
    ON voiceover_assets(storyboard_id, created_at DESC);
