import type { SharedDocumentV1 } from "@llm-space/core";
import {
  GistThreadReader,
  GistThreadWriter,
} from "@llm-space/core/storage";
import { inject, injectable } from "inversify";

import { GitHubAuthManager } from "../auth/github-auth-manager";

/** Adapt Desktop's current GitHub identity to the shared Gist storage clients. */
@injectable()
export class AuthenticatedGistStorage {
  private readonly _reader: GistThreadReader;
  private readonly _writer: GistThreadWriter;

  constructor(
    @inject(GitHubAuthManager) private readonly _auth: GitHubAuthManager
  ) {
    const getToken = () => this._auth.getAccessToken();
    this._reader = new GistThreadReader({ getToken });
    this._writer = new GistThreadWriter({ getToken });
  }

  /** Read the latest ACP Shared Document from one Gist. */
  readDocument(gistId: string): Promise<SharedDocumentV1> {
    return this._reader.readDocument(gistId);
  }

  /** Publish a portable snapshot through the authenticated Gist writer. */
  writeDocument(
    snapshot: SharedDocumentV1,
    options: { description?: string } = {}
  ) {
    return this._writer.writeDocument(snapshot, options);
  }
}
