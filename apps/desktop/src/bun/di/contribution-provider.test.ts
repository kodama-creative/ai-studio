import { expect, test } from "bun:test";

import { SnapshotContributionProvider } from "./contribution-provider";

test("ContributionProvider freezes one lazy snapshot", () => {
  const contributions: object[] = [{}];
  let resolutions = 0;
  const provider = new SnapshotContributionProvider(() => {
    resolutions += 1;
    return contributions;
  });

  const first = provider.getContributions();
  contributions.push({});

  expect(provider.getContributions()).toBe(first);
  expect(first).toHaveLength(1);
  expect(Object.isFrozen(first)).toBe(true);
  expect(resolutions).toBe(1);
});
