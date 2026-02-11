import { useCallback, useEffect, useRef } from "react";
import { saveState } from "../utils/storage";

export function useDebouncedStorage(data, delay = 500, onSave) {
  const pendingRef = useRef(null);
  const timerRef = useRef(null);

  const flush = useCallback(() => {
    if (pendingRef.current) {
      saveState(pendingRef.current);
      if (onSave) onSave();
      pendingRef.current = null;
    }
  }, [onSave]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      saveState(data);
      if (onSave) onSave();
      pendingRef.current = null;
    }, delay);

    pendingRef.current = data;

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [data, delay, onSave]);

  useEffect(() => {
    const handleBeforeUnload = () => flush();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flush]);
}
