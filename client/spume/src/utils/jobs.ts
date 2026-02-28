// job polling utilities - re-exports from centralized job service
// maintained for backward compatibility, new code should import from app/services/jobs/jobService

export {
  pollJobUntilComplete,
  pollJobWithDetails,
  getJobStatus,
  type PollResult,
  type PollResultDetails,
} from "../app/services/jobs/jobService";
