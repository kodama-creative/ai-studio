"use client";

import { useMemo } from "react";

import { useController } from "@/app/di/react";
import type { GithubAuthState } from "@/shared/auth";

import { GithubAuthController } from "./github-auth-controller";

interface GithubAuthValue {
  state: GithubAuthState;
  signIn: () => void;
  signOut: () => void;
}

/** Domain adapter over the window-scoped GitHub auth controller. */
export function useGithubAuth(): GithubAuthValue {
  const { controller, state } = useController(GithubAuthController);
  return useMemo(
    () => ({ state, signIn: controller.signIn, signOut: controller.signOut }),
    [controller, state]
  );
}
