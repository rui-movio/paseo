import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

/** Installation-local UI state survives tab changes and screen/pane remounts. */
export function useHubState<T>(host: string, slot: string, initial: T) {
  const cache = useQueryClient();
  const key = ["employee-hub-ui", host, slot];
  const query = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    enabled: false,
    gcTime: Infinity,
  });
  const set = useCallback(
    (value: T | ((previous: T) => T)) => {
      cache.setQueryData<T>(["employee-hub-ui", host, slot], (previous) =>
        typeof value === "function" ? (value as (previous: T) => T)(previous ?? initial) : value,
      );
    },
    [cache, host, slot, initial],
  );
  return [query.data ?? initial, set] as const;
}
