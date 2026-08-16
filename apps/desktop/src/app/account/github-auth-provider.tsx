"use client";

import { useMemo } from "react";

import { GITHUB_AUTH_CONTROLLER } from "@/app/di/main-window-module";
import { useController } from "@/app/di/react";
import type { GithubAuthState } from "@/shared/auth";

interface GithubAuthValue {
  state: GithubAuthState;
  signIn: () => void;
  signOut: () => void;
}

/** Domain adapter over the window-scoped GitHub auth controller. */
export function useGithubAuth(): GithubAuthValue {
  const { controller, state } = useController(GITHUB_AUTH_CONTROLLER);
  return useMemo(
    () => ({ state, signIn: controller.signIn, signOut: controller.signOut }),
    [controller, state]
  );
}
