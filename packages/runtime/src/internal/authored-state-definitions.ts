const STATE_DEFINITION_BRAND = Symbol.for("llm-space.state-definition");
const STATE_SCOPE_ACCESSOR = Symbol.for("llm-space.state-scope-accessor");

export function defineStateRuntime<
  TDefinition extends {
    readonly initial: unknown;
    readonly name: string;
    readonly schema: unknown;
    readonly version: number;
  }
>(input: TDefinition): TDefinition & {
  get(): unknown;
  update(updater: (current: unknown) => unknown): void;
} {
  const scope = () => {
    const accessor = (globalThis as Record<PropertyKey, unknown>)[
      Symbol.for("llm-space.state-scope-accessor")
    ];
    if (typeof accessor !== "function") {
      throw new Error("Session state is unavailable outside authored Runtime execution");
    }
    const active = (accessor as () => unknown)();
    if (!active || typeof active !== "object") {
      throw new Error("Session state is unavailable outside authored Runtime execution");
    }
    return active as {
      get(name: string): unknown;
      update(name: string, updater: (current: unknown) => unknown): void;
    };
  };
  const definition = {
    ...input,
    get() {
      return scope().get(input.name);
    },
    update(updater: (current: unknown) => unknown) {
      if (typeof updater !== "function") {
        throw new TypeError("Session state update requires a function");
      }
      scope().update(input.name, updater);
    }
  };
  return Object.defineProperty(
    definition,
    Symbol.for("llm-space.state-definition"),
    {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    }
  );
}

export function hasStateDefinitionBrand(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === "object"
    && (value as Record<PropertyKey, unknown>)[STATE_DEFINITION_BRAND] === true
  );
}

export function installStateScopeAccessor(accessor: () => unknown): void {
  const globalRecord = globalThis as Record<PropertyKey, unknown>;
  const existing = globalRecord[STATE_SCOPE_ACCESSOR];
  if (existing && existing !== accessor) {
    throw new Error("Session state scope accessor is already installed");
  }
  if (!existing) {
    Object.defineProperty(globalRecord, STATE_SCOPE_ACCESSOR, {
      value: accessor,
      configurable: false,
      enumerable: false,
      writable: false
    });
  }
}

export function getActiveAgentSessionContextRuntime(): unknown {
  const accessor = (globalThis as Record<PropertyKey, unknown>)[
    STATE_SCOPE_ACCESSOR
  ];
  if (typeof accessor !== "function") {
    throw new Error("Agent Session context is unavailable outside authored Runtime execution");
  }
  const active = (accessor as () => unknown)();
  if (!active || typeof active !== "object" || !("session" in active)) {
    throw new Error("Agent Session context is unavailable outside authored Runtime execution");
  }
  return (active).session;
}
