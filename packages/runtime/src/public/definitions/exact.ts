export type ExactDefinition<TValue, TDefinition> = TValue &
  Record<Exclude<keyof TValue, keyof TDefinition>, never>;
