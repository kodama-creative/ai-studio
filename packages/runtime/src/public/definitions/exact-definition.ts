export type ExactDefinition<TValue, TDefinition> = Record<Exclude<keyof TValue, keyof TDefinition>, never>
  & TValue;
