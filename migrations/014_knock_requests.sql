-- 014: knock requests - allow unknown P2P peers to request access

-- knock_requestz stores access requests from unknown peers
-- peers can "knock" with a username and message, admin can approve/reject
CREATE TABLE knock_requestz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  node_id TEXT NOT NULL,
  username TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'accepted', 'rejected'
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  processed_at INTEGER,                     -- when admin approved/rejected
  processed_by TEXT REFERENCES user_accountz(id),  -- admin who processed
  UNIQUE(node_id)                           -- one active knock per node
);

-- index for listing pending knocks
CREATE INDEX idx_knock_requestz_status ON knock_requestz(status, created_at DESC);

-- index for looking up knock by node_id
CREATE INDEX idx_knock_requestz_node_id ON knock_requestz(node_id);
