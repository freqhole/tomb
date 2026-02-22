// job polling utilities - re-exports from centralized job service
// maintained for backward compatibility, new code should import from app/services/jobs/jobService

export { pollJobUntilComplete, getJobStatus, type PollResult } from "../app/services/jobs/jobService";
