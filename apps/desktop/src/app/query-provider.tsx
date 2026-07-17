"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
 * Note: This singleton is scoped to one renderer JavaScript runtime.
 * Revisit this if one renderer needs multiple isolated query caches.
 */
const QUERY_CLIENT = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false
    }
  }
});

export function QueryProvider({
  children
}: Readonly<{ children: React.ReactNode; }>) {
  return (
    <QueryClientProvider client={QUERY_CLIENT}>
      {children}
    </QueryClientProvider>
  );
}
