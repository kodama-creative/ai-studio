import { ContainerModule } from "inversify";

import { GitHubAuthManager } from "./github-auth-manager";

/** Bind the process-owned GitHub authentication authority. */
export function githubAuthModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(GitHubAuthManager).toSelf().inSingletonScope();
  });
}
