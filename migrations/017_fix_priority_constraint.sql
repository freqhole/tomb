-- Fix thumbnail job priority constraint to match enum values
-- Updates the priority constraint to use 'critical' instead of 'urgent'

-- Drop the existing constraint
ALTER TABLE thumbnail_jobs DROP CONSTRAINT IF EXISTS chk_thumbnail_jobs_priority;

-- Add the corrected constraint with proper enum values
ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_priority
    CHECK (priority IS NULL OR priority IN ('low', 'normal', 'high', 'critical'));

-- Add comment for documentation
COMMENT ON CONSTRAINT chk_thumbnail_jobs_priority ON thumbnail_jobs IS 'Ensures priority values match ThumbnailJobPriority enum: low, normal, high, critical';
