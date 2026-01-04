-- Analytics and Request Tracking
-- Table for monitoring HTTP requests and application performance

-- Analytics table for request tracking
CREATE TABLE IF NOT EXISTS request_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id VARCHAR(36) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID,
    method VARCHAR(10) NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER,
    user_agent TEXT,
    ip_address TEXT,
    request_data JSONB,
    response_size BIGINT,
    error_message TEXT,
    trace_id VARCHAR(32),
    span_id VARCHAR(16)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON request_analytics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_user_id ON request_analytics(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_path ON request_analytics(path);
CREATE INDEX IF NOT EXISTS idx_analytics_status ON request_analytics(status_code);
CREATE INDEX IF NOT EXISTS idx_analytics_trace_id ON request_analytics(trace_id) WHERE trace_id IS NOT NULL;

-- Comments for documentation
COMMENT ON TABLE request_analytics IS 'Analytics and monitoring data for HTTP requests';
COMMENT ON COLUMN request_analytics.request_id IS 'Unique identifier for the HTTP request';
COMMENT ON COLUMN request_analytics.timestamp IS 'When the request was made';
COMMENT ON COLUMN request_analytics.user_id IS 'User ID if request was authenticated';
COMMENT ON COLUMN request_analytics.method IS 'HTTP method (GET, POST, etc.)';
COMMENT ON COLUMN request_analytics.path IS 'Request path/endpoint';
COMMENT ON COLUMN request_analytics.status_code IS 'HTTP response status code';
COMMENT ON COLUMN request_analytics.duration_ms IS 'Request processing time in milliseconds';
COMMENT ON COLUMN request_analytics.user_agent IS 'Client user agent string';
COMMENT ON COLUMN request_analytics.ip_address IS 'Client IP address';
COMMENT ON COLUMN request_analytics.request_data IS 'Additional request metadata as JSON';
COMMENT ON COLUMN request_analytics.response_size IS 'Response size in bytes';
COMMENT ON COLUMN request_analytics.error_message IS 'Error message if request failed';
COMMENT ON COLUMN request_analytics.trace_id IS 'Distributed tracing trace ID';
COMMENT ON COLUMN request_analytics.span_id IS 'Distributed tracing span ID';
