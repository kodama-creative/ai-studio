import type { AnalyticsClient } from "@/client/analytics";
import type { AnalyticsEvent } from "@/shared/analytics";

/**
 * Record an anonymous, behaviour-only analytics event from the renderer.
 *
 * This does not send anything itself — it forwards the event to the bun main
 * process (the single, auditable telemetry egress) through the client owned by
 * the calling feature. Synchronous and asynchronous failures are contained.
 * See `shared/analytics.ts` for the privacy contract.
 */
export function trackAnalytics(
  client: Pick<AnalyticsClient, "capture">,
  event: AnalyticsEvent
): void {
  void Promise.resolve()
    .then(() => client.capture(event))
    .catch(() => undefined);
}
