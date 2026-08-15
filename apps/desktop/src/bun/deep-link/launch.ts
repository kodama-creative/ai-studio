import Electrobun, { type ElectrobunEvent } from "electrobun/bun";

import { DeepLinkInbox } from "./deep-link-inbox";

/**
 * Process-entry inbox. Its Electrobun listener is deliberately installed at
 * module evaluation so cold-start URLs cannot race the async composition root.
 */
export const desktopDeepLinks = new DeepLinkInbox();

Electrobun.events.on(
  "open-url",
  (event: ElectrobunEvent<{ url: string }, void>) => {
    desktopDeepLinks.accept(event.data.url);
  }
);
