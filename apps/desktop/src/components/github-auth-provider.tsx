"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { getGithubAuthStatus, githubAccountClient } from "@/client/github-auth";
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
  const [state, setState] = useState<GithubAuthState>({ status: "signedOut" });

  useEffect(() => {
    const handle = (next: GithubAuthState) => {
      setState(next);
      // A failed / cancelled Device Flow comes back as signed-out with a reason.
      if (next.status === "signedOut" && next.error) {
        toast.error(next.error);
      }
    };
    const subscription = githubAccountClient.on("changed", handle);

    let cancelled = false;
    void getGithubAuthStatus()
      .then((initial) => {
        // Don't clobber a live transition that arrived before the initial fetch.
        if (!cancelled)
          setState((prev) => (prev.status === "signedOut" ? initial : prev));
      })
      .catch(() => {
        // Non-fatal: leave the signed-out default in place.
      });

    return () => {
      cancelled = true;
      void subscription.dispose();
    };
  }, []);

  const signIn = useCallback(
    () => executeCommand({ type: "githubAccount.login", args: {} }),
    [executeCommand]
  );
  const signOut = useCallback(
    () => executeCommand({ type: "githubAccount.logout", args: {} }),
    [executeCommand]
  );

  const value = useMemo(
    () => ({ state, signIn, signOut }),
    [state, signIn, signOut]
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
