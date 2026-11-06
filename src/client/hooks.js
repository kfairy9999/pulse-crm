import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

export function useResource(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { const result = await api(path); if (mounted.current) { setData(result); setError(null); } return result; }
    catch (err) { if (mounted.current) setError(err); throw err; }
    finally { if (mounted.current) setLoading(false); }
  }, [path]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  return { data, error, loading, reload: load };
}

export function useDebounced(value, delay = 220) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}
