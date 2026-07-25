import { expect, test } from "bun:test";

import {
  compactSessionBudgetWindowLabel,
  focusSessionBudgetPrimaryAction
} from "../../../src/components/thread-playground/session-budget-view";

test("formats both budget axes and discloses an unlimited source axis", () => {
  expect(compactSessionBudgetWindowLabel(12_000, 3_000, {
    maxInputTokensPerSession: 20_000,
    maxOutputTokensPerSession: false
  })).toBe("12k / 20k in · 3k / Unlimited out");
});

test("focuses the primary action only through the supplied Thread container", () => {
  let focused = false;
  const action = { focus: () => { focused = true; } } as HTMLElement;
  const container = {
    querySelector: (selector: string) => {
      expect(selector).toBe("[data-session-budget-primary-action]");
      return action;
    }
  } as unknown as ParentNode;

  expect(focusSessionBudgetPrimaryAction(container)).toBe(true);
  expect(focused).toBe(true);
});
