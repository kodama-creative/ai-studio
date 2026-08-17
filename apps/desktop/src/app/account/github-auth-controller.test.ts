import { describe, expect, test } from "bun:test";

import type { CommandService } from "@/commands/command-service";
import type { GithubAuthState } from "@/shared/auth";
import type { GithubAccountRpc } from "@/shared/github-account-rpc";
import type { RpcClient } from "@/shared/namespaced-rpc";

import type { RendererNotificationService } from "../notifications/renderer-notification-service";

import { GithubAuthController } from "./github-auth-controller";

describe("GithubAuthController", () => {
  test("keeps a live signed-out error authoritative over the initial read", async () => {
    const initial = _deferred<GithubAuthState>();
    const errors: string[] = [];
    let publish!: (state: GithubAuthState) => void;
    const controller = new GithubAuthController(
      {
      getState: () => initial.promise,
      on: (_event, listener) => {
        publish = listener;
        return { dispose: () => undefined };
      },
      },
      _commands(),
      _notifications((message) => errors.push(message))
    );

    controller.start();
    publish({ status: "signedOut", error: "Device flow expired" });
    initial.resolve({
      status: "signedIn",
      user: _user("stale"),
    });
    await _flushMicrotasks();

    expect(controller.getSnapshot()).toEqual({
      status: "signedOut",
      error: "Device flow expired",
    });
    expect(errors).toEqual(["Device flow expired"]);
    controller.stop();
  });

  test("publishes the initial read when no live transition intervenes", async () => {
    const controller = new GithubAuthController(
      {
      getState: () =>
        Promise.resolve({
          status: "signedIn",
          user: _user("octocat"),
        }),
      on: () => ({ dispose: () => undefined }),
      } as Pick<RpcClient<GithubAccountRpc>, "getState" | "on">,
      _commands(),
      _notifications()
    );

    controller.start();
    await _eventually(() => controller.getSnapshot().status, "signedIn");
    expect(controller.getSnapshot()).toMatchObject({
      status: "signedIn",
      user: { login: "octocat" },
    });
    controller.stop();
  });

  test("owns auth commands and ignores events after stop", () => {
    const commands: string[] = [];
    let publish!: (state: GithubAuthState) => void;
    let disposed = 0;
    const controller = new GithubAuthController(
      {
      getState: () => new Promise(() => undefined),
      on: (_event, listener) => {
        publish = listener;
        return { dispose: () => void (disposed += 1) };
      },
      },
      _commands((type) => commands.push(type.replace("githubAccount.", ""))),
      _notifications()
    );

    controller.start();
    controller.signIn();
    controller.signOut();
    controller.stop();
    publish({ status: "signingIn" });

    expect(commands).toEqual(["login", "logout"]);
    expect(disposed).toBe(1);
    expect(controller.getSnapshot()).toEqual({ status: "signedOut" });
  });
});

function _commands(
  execute: (type: string) => void = () => undefined
): CommandService {
  return {
    executeCommand: ({ type }: { type: string }) => execute(type),
    registerCommandHandlers: () => () => undefined,
  };
}

function _notifications(
  notifyError: (message: string) => void = () => undefined
): RendererNotificationService {
  return { error: notifyError } as RendererNotificationService;
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function _user(login: string) {
  return {
    login,
    name: null,
    email: null,
    avatarUrl: `https://example.com/${login}.png`,
    htmlUrl: `https://github.com/${login}`,
  };
}

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (read() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(read()).toBe(expected);
}

async function _flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
