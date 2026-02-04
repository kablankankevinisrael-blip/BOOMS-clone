import { useCallback, useEffect, useRef, useState } from 'react';

interface AdminResourceOptions<T> {
  fetcher: () => Promise<T>;
  immediate?: boolean;
  onError?: (error: Error) => void;
}

interface AdminResourceState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useAdminResource<T>({
  fetcher,
  immediate = true,
  onError,
}: AdminResourceOptions<T>): AdminResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<Error | null>(null);
  const isMountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);

  // Mise à jour de la ref sans déclencher useEffect
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('[useAdminResource] fetcher about to be called');
      const result = await fetcherRef.current();
      if (isMountedRef.current) {
        setData(result);
      }
    } catch (err) {
      const formattedError = err instanceof Error ? err : new Error('Unknown error');
      if (isMountedRef.current) {
        setError(formattedError);
      }
      onError?.(formattedError);
    } finally {
      if (isMountedRef.current) {
        console.log('[useAdminResource] setLoading(false) called');
        setLoading(false);
      }
    }
  }, [onError]); // ← Enlever fetcher de la dépendance

  useEffect(() => {
    isMountedRef.current = true;
    if (immediate) {
      refresh();
    }

    return () => {
      console.log('[useAdminResource] UNMOUNTED');
      isMountedRef.current = false;
    };
  }, [immediate]); // ← Enlever refresh pour éviter la boucle

  return { data, loading, error, refresh };
}
