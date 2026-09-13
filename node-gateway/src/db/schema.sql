-- Users table: stores registered accounts
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Projects table: each user's dataset workspace
CREATE TABLE IF NOT EXISTS projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  py_session_id TEXT,
  status        TEXT DEFAULT 'created',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Files uploaded per project (with cloud storage link)
CREATE TABLE IF NOT EXISTS project_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  rows        INTEGER,
  cols        INTEGER,
  cloud_url   TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Refresh tokens for JWT auth
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Background Jobs table: asynchronous queue for heavy ML/data tasks
CREATE TABLE IF NOT EXISTS background_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
  job_type     TEXT NOT NULL,
  status       TEXT DEFAULT 'queued',
  progress     INTEGER DEFAULT 0,
  payload      JSONB DEFAULT '{}',
  result       JSONB DEFAULT NULL,
  error_msg    TEXT DEFAULT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);