/**
 * PostHog EU ingestion host.
 */
export const POSTHOG_HOST = "https://eu.i.posthog.com";

/**
 * Bundled PostHog write-only project key.
 */
const DEFAULT_POSTHOG_KEY = "phc_t8sHZoJnt85kTQWtXjPmBHdha5sEvvcRFogKJiN9ihDY";

/**
 * PostHog key resolved after bootstrap environment hydration.
 */
export const POSTHOG_KEY = process.env.LLM_SPACE_POSTHOG_KEY ?? DEFAULT_POSTHOG_KEY;

/**
 * Whether analytics is disabled through the environment.
 */
export const ANALYTICS_DISABLED = ["1", "true", "yes"].includes(
  (process.env.LLM_SPACE_ANALYTICS_DISABLED ?? "").toLowerCase()
);
