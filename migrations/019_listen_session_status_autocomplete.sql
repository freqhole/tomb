-- auto-complete on status resurrection: if a session is set to 'active' but already 100% complete,
-- immediately mark it as completed. this prevents "zombie" active sessions that have no more
-- songs to play (e.g., when resuming a completed session from feed UI).

CREATE TRIGGER IF NOT EXISTS trigger_listen_sessionz_auto_complete_on_status
    AFTER UPDATE OF status ON listen_sessionz
    FOR EACH ROW
    WHEN NEW.status = 'active'
      AND NEW.songs_completed >= NEW.total_songs
      AND NEW.total_songs > 0
BEGIN
    UPDATE listen_sessionz SET status = 'completed' WHERE id = NEW.id;
END;
