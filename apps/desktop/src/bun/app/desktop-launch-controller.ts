import type { DeepLinkScheme } from "../../shared/deep-link-scheme";
import type { Disposable } from "../../shared/disposable";
import { isStudioOpenDeepLink } from "../deep-link";
import type {
  DeepLinkConnection,
  DeepLinkSource,
} from "../deep-link/deep-link-inbox";

export interface DesktopLaunchTargets {
  openMain(url?: string): Promise<void>;
  openProject(rootPath: string): Promise<void>;
}

export interface DesktopLaunchControllerOptions {
  readonly deepLinks: DeepLinkSource;
  readonly scheme: DeepLinkScheme;
  readonly targets: DesktopLaunchTargets;
  readonly onOpenError?: (error: Error, url?: string) => void;
}

/**
 * Owns cold-start, live deep-link, and reopen routing without exposing native
 * windows or Project managers to the process composition root.
 */
export class DesktopLaunchController implements Disposable {
  private _connection: DeepLinkConnection | undefined;

  constructor(private readonly _options: DesktopLaunchControllerOptions) {}

  /** Connect live routing and settle every URL captured during process launch. */
  async start(): Promise<void> {
    if (this._connection !== undefined) {
      throw new Error("Desktop launch controller is already started.");
    }
    const connection = this._options.deepLinks.connect((url) => {
      void this._openSafely(url);
    });
    this._connection = connection;
    if (connection.bufferedUrls.length === 0) {
      await this._options.targets.openMain();
      return;
    }
    await Promise.all(
      connection.bufferedUrls.map((url) => this._openSafely(url))
    );
  }

  /** Reopen the Main window and contain platform-event failures. */
  reopen(): void {
    if (this._connection === undefined) return;
    void this._options.targets.openMain().catch((error) => {
      this._report(error);
    });
  }

  /** Disconnect process-global URL delivery before window teardown begins. */
  dispose(): void {
    void this._connection?.dispose();
    this._connection = undefined;
  }

  private async _open(url: string): Promise<void> {
    if (!isStudioOpenDeepLink(url, this._options.scheme)) {
      await this._options.targets.openMain(url);
      return;
    }
    const project = new URL(url).searchParams.get("project")?.trim();
    if (!project) {
      throw new Error("Can't open Studio: the project path is missing.");
    }
    await this._options.targets.openProject(project);
  }

  private async _openSafely(url: string): Promise<void> {
    try {
      await this._open(url);
    } catch (error) {
      this._report(error, url);
    }
  }

  private _report(error: unknown, url?: string): void {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    if (this._options.onOpenError !== undefined) {
      try {
        this._options.onOpenError(normalized, url);
      } catch (reportError) {
        console.error("Failed to report Desktop link error:", reportError);
      }
      return;
    }
    console.error("Failed to open Desktop link:", normalized);
  }
}
