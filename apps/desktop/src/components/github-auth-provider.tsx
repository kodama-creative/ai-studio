"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { GithubAuthController } from "@/app/account/github-auth-controller";
import { createGithubAccountClient } from "@/client/github-auth";
import { useCommands } from "@/commands";
import type { GithubAuthState } from "@/shared/auth";

interface GithubAuthValue {
  state: GithubAuthState;
  signIn: () => void;
  signOut: () => void;
}

const GithubAuthContext = createContext<GithubAuthValue | null>(null);

/**
 * Owns GitHub sign-in state for the whole page. Pulls the initial state once on
 * mount and then follows the bun-side `githubAuthChanged` messages, so the
 * sidebar account widget and the Account settings page stay in sync through the
 * Device Flow. Sign-in/out are dispatched as commands (bun-target).
 */
export function GithubAuthProvider({ children }: { children: ReactNode }) {
  const { executeCommand } = useCommands();
  const client = useMemo(() => createGithubAccountClient(), []);
  const controller = useMemo(
    () =>
      new GithubAuthController({
        getState: () => client.getState(),
        subscribeChanged: (listener) => client.on("changed", listener),
        login: () =>
          executeCommand({ type: "githubAccount.login", args: {} }),
        logout: () =>
          executeCommand({ type: "githubAccount.logout", args: {} }),
        notifyError: (message) => toast.error(message),
      }),
    [client, executeCommand]
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  const value = useMemo(
    () => ({ state, signIn: controller.signIn, signOut: controller.signOut }),
    [controller, state]
  );

  return (
    <GithubAuthContext.Provider value={value}>
      {children}
    </GithubAuthContext.Provider>
  );
}

export function useGithubAuth(): GithubAuthValue {
  const ctx = useContext(GithubAuthContext);
  if (!ctx) {
    throw new Error("useGithubAuth must be used within a GithubAuthProvider");
  }
  return ctx;
}
