import { expect, test } from "bun:test";

import { DeepLinkInbox } from "./deep-link-inbox";

test("DeepLinkInbox drains launch URLs then forwards live URLs", () => {
  const inbox = new DeepLinkInbox();
  const received: string[] = [];
  inbox.accept("llm-space://first");

  const connection = inbox.connect((url) => received.push(url));
  inbox.accept("llm-space://second");

  expect(connection.bufferedUrls).toEqual(["llm-space://first"]);
  expect(received).toEqual(["llm-space://second"]);
  void connection.dispose();
});

test("DeepLinkInbox reconnects without losing URLs accepted while disconnected", () => {
  const inbox = new DeepLinkInbox();
  const first: string[] = [];
  const connection = inbox.connect((url) => first.push(url));
  expect(() => inbox.connect(() => undefined)).toThrow(
    "Desktop deep-link inbox is already connected."
  );

  void connection.dispose();
  void connection.dispose();
  inbox.accept("llm-space://buffered");
  const second: string[] = [];
  const replacement = inbox.connect((url) => second.push(url));

  expect(first).toEqual([]);
  expect(replacement.bufferedUrls).toEqual(["llm-space://buffered"]);
  expect(second).toEqual([]);
});
