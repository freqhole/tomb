-- app_state.db - jobs, config, auth tables

-- job system with sessions for batch operations
CREATE TABLE job_sessionz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'Active',
  progress TEXT DEFAULT '{"current":0,"total":0}',  -- JSON JobProgress
  last_checkpoint TEXT,            -- for resume capability
  batch_size INTEGER DEFAULT 100,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT
);

CREATE TABLE jobz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  session_id TEXT,                 -- reference to job_sessionz.id
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',
  parameters TEXT NOT NULL DEFAULT '{}',  -- JSON parameters
  result TEXT,                     -- JSON result
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  scheduled_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  created_by TEXT,

  -- constraints
  CHECK (status IN ('Pending', 'Running', 'Completed', 'Failed', 'Cancelled')),
  CHECK (retry_count >= 0),
  CHECK (max_retries >= 0),
  FOREIGN KEY (session_id) REFERENCES job_sessionz(id)
);

-- user accounts
CREATE TABLE user_accountz (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  created_at INTEGER
);

-- invite codes for user registration
CREATE TABLE invite_codez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  code TEXT UNIQUE NOT NULL,
  created_at INTEGER,
  used_at INTEGER,
  used_by_id TEXT,               -- reference to user_accountz.id

  -- constraints
  FOREIGN KEY (used_by_id) REFERENCES user_accountz(id)
);

-- triggers for automatic audit field updates
CREATE TRIGGER trg_job_sessionz_updated_at
AFTER UPDATE ON job_sessionz
FOR EACH ROW
BEGIN
  UPDATE job_sessionz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- indexes for job_sessionz
CREATE INDEX idx_job_sessionz_status ON job_sessionz(status);
CREATE INDEX idx_job_sessionz_type ON job_sessionz(job_type);
CREATE INDEX idx_job_sessionz_created_at ON job_sessionz(created_at DESC);

-- indexes for jobz
CREATE INDEX idx_jobz_status ON jobz(status);
CREATE INDEX idx_jobz_type ON jobz(job_type);
CREATE INDEX idx_jobz_session_id ON jobz(session_id);
CREATE INDEX idx_jobz_scheduled_at ON jobz(scheduled_at);
CREATE INDEX idx_jobz_queue ON jobz(status, scheduled_at) WHERE status = 'Pending';
CREATE INDEX idx_jobz_retry ON jobz(retry_count, max_retries) WHERE status = 'Failed';

-- indexes for user_accountz
CREATE UNIQUE INDEX idx_user_accountz_username ON user_accountz(username);
CREATE INDEX idx_user_accountz_created_at ON user_accountz(created_at DESC);

-- indexes for invite_codez
CREATE UNIQUE INDEX idx_invite_codez_code ON invite_codez(code);
CREATE INDEX idx_invite_codez_created_at ON invite_codez(created_at DESC);
CREATE INDEX idx_invite_codez_used_at ON invite_codez(used_at);
