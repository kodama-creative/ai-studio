/** Root of all Desktop-owned application data. */
export const APP_HOME_PATH = Symbol("AppHomePath");

/** Default working directory exposed to bundled local tools. */
export const WORKSPACE_ROOT = Symbol("WorkspaceRoot");

/** Shell-hydrated process environment supplied at the platform boundary. */
export const DESKTOP_ENV = Symbol("DesktopEnvironment");

export type DesktopEnvironment = Readonly<
  Record<string, string | undefined>
>;
