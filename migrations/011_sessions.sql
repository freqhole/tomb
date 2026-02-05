-- 011: sessions - tower sessions for web framework

CREATE TABLE tower_sessions (
    id text primary key not null,
    data blob not null,
    expiry_date integer not null
);
