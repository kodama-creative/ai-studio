import type { ThreadConnector } from "../../types/storage/connector";

import { GIST_CONNECTOR_ID } from "./gist-constants";
import {
  GistThreadReader,
  type GistThreadReaderOptions,
} from "./gist-thread-reader";

export { GIST_CONNECTOR_ID } from "./gist-constants";

/**
 * Build the gist {@link ThreadConnector}: a {@link GistThreadReader} under the
 * stable `"gist"` connector id. The reader also implements `SharedThreadSource`,
 * so the shared-viewer page can read a thread plus its display metadata through
 * `connector.storage`.
 */
export function createGistConnector(
  options?: GistThreadReaderOptions
): ThreadConnector {
  return {
    connectorId: GIST_CONNECTOR_ID,
    storage: new GistThreadReader(options),
  };
}
