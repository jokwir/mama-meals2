const defaults = Object.freeze({
  draftsPerDay: 8,
  uploadsPerDay: 24,
  uploadsPerDraft: 9,
  imageMaxPixels: 40000000,
  maxJobAttempts: 8,
  jobPagesPerRun: 2,
  jobRetryBaseMinutes: 5,
  jobRetryMaxHours: 24,
  pendingReviewAlertDays: 7
});

function integer(environment, name, fallback, minimum, maximum) {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(String(raw))) throw new Error(`${name} must be a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function runtimeConfig(environment = process.env) {
  const region = environment.APPLICATION_FUNCTIONS_REGION
    || environment.FIREBASE_FUNCTIONS_REGION || "europe-west1";
  if (!["europe-west1", "africa-south1"].includes(region)) {
    throw new Error("Functions region must be europe-west1 or africa-south1.");
  }
  return {
    region,
    draftsPerDay: integer(environment, "APPLICATION_DRAFTS_PER_DAY", defaults.draftsPerDay, 1, 100),
    uploadsPerDay: integer(environment, "APPLICATION_UPLOADS_PER_DAY", defaults.uploadsPerDay, 1, 200),
    uploadsPerDraft: integer(environment, "APPLICATION_UPLOADS_PER_DRAFT", defaults.uploadsPerDraft, 1, 30),
    imageMaxPixels: integer(environment, "APPLICATION_IMAGE_MAX_PIXELS", defaults.imageMaxPixels, 480000, 100000000),
    maxJobAttempts: integer(environment, "APPLICATION_JOB_MAX_ATTEMPTS", defaults.maxJobAttempts, 1, 30),
    jobPagesPerRun: integer(environment, "APPLICATION_JOB_PAGES_PER_RUN", defaults.jobPagesPerRun, 1, 10),
    jobRetryBaseMinutes: integer(environment, "APPLICATION_JOB_RETRY_BASE_MINUTES", defaults.jobRetryBaseMinutes, 1, 60),
    jobRetryMaxHours: integer(environment, "APPLICATION_JOB_RETRY_MAX_HOURS", defaults.jobRetryMaxHours, 1, 168),
    pendingReviewAlertDays: integer(environment, "APPLICATION_PENDING_REVIEW_ALERT_DAYS", defaults.pendingReviewAlertDays, 1, 90)
  };
}

module.exports = { runtimeConfig };
