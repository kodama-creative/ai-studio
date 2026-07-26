import { expect, test } from "bun:test";

import {
  normalizeRunHistory,
  recordRun
} from "../../src/thread/history";

test("retains validated model-call limit terminals", () => {
  const history = recordRun([], {}, 102, {
    runLimitFailure: {
      axis: "modelCalls",
      attempted: 26,
      code: "runLimitExceeded",
      consumed: 25,
      limit: 25
    }
  });

  expect(normalizeRunHistory(history)).toMatchObject([
    { runLimitFailure: { code: "runLimitExceeded", consumed: 25 } }
  ]);
});
