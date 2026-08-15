import { ContainerModule, type ResolutionContext } from "inversify";

import type {
  GithubAccountEvents,
  GithubAccountRequests,
} from "../../shared/application-rpc";
import type { GithubAuthState } from "../../shared/auth";
import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";
import type { GitHubAuthManager } from "../auth/github-auth-manager";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";

export const GITHUB_ACCOUNT_APPLICATION =
  desktopToken<GithubAccountApplication>("github-account", "application");

/** Read-only account state plus login commands and process-local events. */
export class GithubAccountApplication
  implements GithubAccountRequests, Disposable
{
  readonly events = new EventHub<GithubAccountEvents>();

  constructor(private readonly _auth: GitHubAuthManager) {}

  getState() {
    return Promise.resolve(this._auth.getState());
  }

  login() {
    return this._auth.signIn();
  }

  logout(): void {
    this._auth.signOut();
  }

  notifyChanged(state: GithubAuthState): void {
    this.events.publish("changed", state);
  }

  dispose(): void {
    this.events.dispose();
  }
}

/** Bind process-scoped GitHub account use cases. */
export function githubAccountApplicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<GithubAccountApplication>(GITHUB_ACCOUNT_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new GithubAccountApplication(context.get(PROCESS_TOKENS.githubAuth))
      )
      .inSingletonScope();
  });
}
