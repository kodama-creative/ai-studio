import { describe, expect, test } from "bun:test";

import type { FeatureReminder } from "@/shared/feature-reminders";
import type { RemindersRequests } from "@/shared/reminders-rpc";

import { RemindersController } from "./reminders-controller";

const FEATURE: FeatureReminder = {
  id: "pi-session-debugger",
  title: "Pi Session debugger",
  description: "Step through one durable operation.",
  imageUrl: "file:///feature.png",
};

describe("RemindersController", () => {
  test("contains every optional RPC rejection", async () => {
    const failure = new Error("RPC window already closed");
    const readController = new RemindersController(
      _requests({
        nextFeature: () => Promise.reject(failure),
        shouldShowGithubStar: () => Promise.reject(failure),
        dismissGithubStarForever: () => Promise.reject(failure),
      })
    );

    await readController.requestFeature();
    await readController.requestGithubStar();
    await readController.dismissGithubStarForever();
    expect(readController.getSnapshot()).toEqual({
      feature: null,
      showGithubStar: false,
    });

    const writeController = new RemindersController(
      _requests({
        nextFeature: () => Promise.resolve(FEATURE),
        markFeatureSeen: () => Promise.reject(failure),
      })
    );
    await writeController.requestFeature();
    await writeController.markFeatureSeen();
  });

  test("publishes each reminder once and deduplicates durable mutations", async () => {
    let featureReads = 0;
    let githubReads = 0;
    let seenWrites = 0;
    let dismissWrites = 0;
    const controller = new RemindersController(
      _requests({
        nextFeature: () => {
          featureReads += 1;
          return Promise.resolve(FEATURE);
        },
        shouldShowGithubStar: () => {
          githubReads += 1;
          return Promise.resolve({ show: true });
        },
        markFeatureSeen: () => {
          seenWrites += 1;
          return Promise.resolve();
        },
        dismissGithubStarForever: () => {
          dismissWrites += 1;
          return Promise.resolve();
        },
      })
    );

    await Promise.all([
      controller.requestFeature(),
      controller.requestFeature(),
      controller.requestGithubStar(),
      controller.requestGithubStar(),
    ]);
    await Promise.all([
      controller.markFeatureSeen(),
      controller.markFeatureSeen(),
      controller.dismissGithubStarForever(),
      controller.dismissGithubStarForever(),
    ]);

    expect(controller.getSnapshot()).toEqual({
      feature: FEATURE,
      showGithubStar: true,
    });
    expect({ featureReads, githubReads, seenWrites, dismissWrites }).toEqual({
      featureReads: 1,
      githubReads: 1,
      seenWrites: 1,
      dismissWrites: 1,
    });
  });

  test("ignores reads that finish after disposal", async () => {
    let resolve!: (feature: FeatureReminder | null) => void;
    const feature = new Promise<FeatureReminder | null>((next) => {
      resolve = next;
    });
    const controller = new RemindersController(
      _requests({ nextFeature: () => feature })
    );

    const pending = controller.requestFeature();
    controller.dispose();
    resolve(FEATURE);
    await pending;

    expect(controller.getSnapshot().feature).toBeNull();
  });
});

function _requests(
  overrides: Partial<RemindersRequests> = {}
): RemindersRequests {
  return {
    shouldShowGithubStar: () => Promise.resolve({ show: false }),
    dismissGithubStarForever: () => Promise.resolve(),
    nextFeature: () => Promise.resolve(null),
    markFeatureSeen: () => Promise.resolve(),
    ...overrides,
  };
}
