import { inject, injectable, preDestroy } from "inversify";

import type { DeepLinkScheme } from "../../shared/deep-link-scheme";
import type { Disposable } from "../../shared/disposable";
import { isStudioOpenDeepLink } from "../deep-link";
import type {
  DeepLinkConnection,
  DeepLinkSource,
} from "../deep-link/deep-link-inbox";

export const DESKTOP_DEEP_LINK_SOURCE = Symbol("DesktopDeepLinkSource");
export const DESKTOP_DEEP_LINK_SCHEME = Symbol("DesktopDeepLinkScheme");
export const DESKTOP_LAUNCH_TARGETS = Symbol("DesktopLaunchTargets");
export const DESKTOP_LAUNCH_ERROR_REPORTER = Symbol(
  "DesktopLaunchErrorReporter"
);

export interface DesktopLaunchTargets {
  openMain(url?: string): Promise<void>;
  openProject(rootPath: string): Promise<void>;
}

export interface DesktopLaunchErrorReporter {
  report(error: Error, url?: string): void;
}

/** Own cold-start, live deep-link, and native reopen routing. */
@injectable()
export class DesktopLaunchService implements Disposable {
  private _connection: DeepLinkConnection | undefined;
  private _disposePromise: Promise<void> | undefined;

  constructor(
    @inject(DESKTOP_DEEP_LINK_SOURCE)
    private readonly _deepLinks: DeepLinkSource,
    @inject(DESKTOP_DEEP_LINK_SCHEME)
    private readonly _scheme: DeepLinkScheme,
    @inject(DESKTOP_LAUNCH_TARGETS)
    private readonly _targets: DesktopLaunchTargets,
    @inject(DESKTOP_LAUNCH_ERROR_REPORTER)
    private readonly _errors: DesktopLaunchErrorReporter
  ) {}

  /** Connect live routing and settle every URL captured during process launch. */
  async start(): Promise<void> {
    if (this._disposePromise !== undefined) {
      throw new Error("Desktop launch service is shutting down.");
    }
    if (this._connection !== undefined) {
      throw new Error("Desktop launch service is already started.");
    }
    const connection = this._deepLinks.connect((url) => {
      void this._openSafely(url);
    });
    this._connection = connection;
    if (connection.bufferedUrls.length === 0) {
      await this._targets.openMain();
      return;
    }
    const opened = await Promise.all(
      connection.bufferedUrls.map((url) => this._openSafely(url))
    );
    // A malformed or failed cold-start intent must not leave a headless process.
    if (!opened.some(Boolean)) await this._targets.openMain();
  }

  /** Reopen the Main window and contain platform-event failures. */
  reopen(): void {
    if (this._connection === undefined) return;
    void this._targets.openMain().catch((error) => this._report(error));
  }

  /** Disconnect process-global URL delivery before window teardown begins. */
  @preDestroy()
  dispose(): Promise<void> {
    return (this._disposePromise ??= this._dispose());
  }

  private async _dispose(): Promise<void> {
    const connection = this._connection;
    this._connection = undefined;
    await connection?.dispose();
  }

  /** Route one accepted URL to exactly one window owner. */
  private async _open(url: string): Promise<void> {
    if (!isStudioOpenDeepLink(url, this._scheme)) {
      await this._targets.openMain(url);
      return;
    }
    const project = new URL(url).searchParams.get("project")?.trim();
    if (!project) {
      throw new Error("Can't open Studio: the project path is missing.");
    }
    await this._targets.openProject(project);
  }

  /** Contain platform-delivered work so one malformed URL cannot break routing. */
  private async _openSafely(url: string): Promise<boolean> {
    try {
      await this._open(url);
      return true;
    } catch (error) {
      this._report(error, url);
      return false;
    }
  }

  /** Normalize unknown failures before crossing the reporting seam. */
  private _report(error: unknown, url?: string): void {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    try {
      this._errors.report(normalized, url);
    } catch (reportError) {
      console.error("Failed to report Desktop link error:", reportError);
    }
  }
}
