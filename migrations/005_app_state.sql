-- app_state.db - jobs, config, auth tables

-- job system
CREATE TABLE jobz (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  data TEXT,                      -- json blob
  created_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER
);

-- user accounts
CREATE TABLE user_accountz (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  created_at INTEGER
);

-- invite codes for user registration
CREATE TABLE invite_codez (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  created_at INTEGER,
  used_at INTEGER,
  used_by_rowid INTEGER          -- reference to user_accountz.rowid
);

-- indexes for jobz
CREATE INDEX idx_jobz_status ON jobz(status);
CREATE INDEX idx_jobz_type ON jobz(job_type);
CREATE INDEX idx_jobz_created_at ON jobz(created_at DESC);
CREATE INDEX idx_jobz_queue ON jobz(status, created_at) WHERE status = 'pending';

-- indexes for user_accountz
CREATE UNIQUE INDEX idx_user_accountz_username ON user_accountz(username);
CREATE INDEX idx_user_accountz_created_at ON user_accountz(created_at DESC);

-- indexes for invite_codez
CREATE UNIQUE INDEX idx_invite_codez_code ON invite_codez(code);
CREATE INDEX idx_invite_codez_created_at ON invite_codez(created_at DESC);
CREATE INDEX idx_invite_codez_used_at ON invite_codez(used_at);
