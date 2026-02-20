-- listen session triggers: auto-complete, auto-pause, and clamp corrections

-- auto-complete: mark session as completed when all songs have been played
CREATE TRIGGER IF NOT EXISTS trigger_listen_sessionz_auto_complete
    AFTER UPDATE OF songs_completed, total_songs ON listen_sessionz
    FOR EACH ROW
    WHEN NEW.status IN ('active', 'paused')
      AND NEW.songs_completed >= NEW.total_songs
      AND NEW.total_songs > 0
BEGIN
    UPDATE listen_sessionz SET status = 'completed' WHERE id = NEW.id;
END;

-- auto-pause: when a new session is created, pause any other active sessions for that user
CREATE TRIGGER IF NOT EXISTS trigger_listen_sessionz_auto_pause
    AFTER INSERT ON listen_sessionz
    FOR EACH ROW
BEGIN
    UPDATE listen_sessionz
    SET status = 'paused'
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND status = 'active';
END;

-- clamp: if total_songs shrinks below songs_completed, clamp songs_completed down
-- (this may chain into the auto-complete trigger if the clamped value matches total_songs)
CREATE TRIGGER IF NOT EXISTS trigger_listen_sessionz_clamp_completed
    AFTER UPDATE OF total_songs ON listen_sessionz
    FOR EACH ROW
    WHEN NEW.songs_completed > NEW.total_songs
BEGIN
    UPDATE listen_sessionz
    SET songs_completed = NEW.total_songs
    WHERE id = NEW.id;
END;
