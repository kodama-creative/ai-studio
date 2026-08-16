"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import { RENDERER_COMMAND_REGISTRY } from "@/app/di/common-module";
import { useInject } from "@/app/di/react";
import type { Command, CommandType } from "@/shared/commands";

import {
  type CommandHandlers,
  RendererCommandRegistry,
} from "./renderer-command-registry";

/**
 * A per-command handler, receiving that command's typed `args`. Used both as the
 * shape callers register and (internally, type-erased) as the stored dispatch
 * target.
 */
type StoredHandler = (args: unknown) => void | Promise<void>;
export type { CommandHandlers } from "./renderer-command-registry";

interface CommandContextValue {
  /**
   * Run a command. `webview`-target commands invoke the registered handler here;
   * `bun`-target commands (window zoom / reload) are forwarded to the main
   * process over RPC.
   */
  executeCommand: (command: Command) => void;
  /**
   * Register handlers for some commands; returns a teardown that removes exactly
   * the handlers it added. Prefer {@link useRegisterCommands}.
   */
  registerCommandHandlers: (handlers: CommandHandlers) => () => void;
}

const CommandContext = createContext<CommandContextValue | null>(null);

/**
 * Holds the renderer command registry. Handlers live in a ref-based map keyed by
 * command type, so modules that own the relevant state (tabs, Playgrounds,
 * sidebar) register their handlers where that state lives.
 */
export function CommandProvider({ children }: { children: ReactNode }) {
  const registry = useInject<RendererCommandRegistry>(
    RENDERER_COMMAND_REGISTRY
  );

  const value = useMemo(
    () => ({
      executeCommand: registry.executeCommand,
      registerCommandHandlers: registry.registerCommandHandlers,
    }),
    [registry]
  );

  return (
    <CommandContext.Provider value={value}>{children}</CommandContext.Provider>
  );
}

export function useCommands(): CommandContextValue {
  const ctx = useContext(CommandContext);
  if (!ctx) {
    throw new Error("useCommands must be used within a CommandProvider");
  }
  return ctx;
}

/**
 * Register the given command handlers for this component's lifetime. Stable
 * trampolines are registered once (keyed off the initial render's command set,
 * which is static per component) and always dispatch to the latest `handlers`,
 * so passing fresh closures every render is fine and never goes stale.
 *
 * Pass `enabled: false` to skip registration while some condition doesn't hold
 * (e.g. an inactive tab whose handler must not win the single-slot registry);
 * toggling it re-registers / unregisters cleanly.
 */
export function useRegisterCommands(handlers: CommandHandlers, enabled = true) {
  const { registerCommandHandlers } = useCommands();
  const latest = useRef(handlers);
  // Keep the latest handlers in a ref without mutating during render. The ref is
  // read only post-commit (the registration effect below and the trampoline
  // closures it installs), so syncing after every commit is behavior-preserving.
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const keys = Object.keys(latest.current) as CommandType[];
    const trampolines: CommandHandlers = {};
    for (const key of keys) {
      // `key` and the registry are both type-erased here; the public
      // `CommandHandlers` shape keeps callers honest at the registration site.
      (trampolines as Record<CommandType, StoredHandler>)[key] = (args) =>
        (latest.current as Record<CommandType, StoredHandler | undefined>)[
          key
        ]?.(args);
    }
    return registerCommandHandlers(trampolines);
  }, [registerCommandHandlers, enabled]);
}
