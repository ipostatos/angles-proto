import { useEffect, useState } from "react";

/**
 * Tracks the current location hash route (without the leading "#").
 * Extracted verbatim from App.jsx during v1.6 A1; behavior unchanged.
 */
export function useHashRoute() {
    const [hash, setHash] = useState(() => window.location.hash || "#/");
    useEffect(() => {
        const onHash = () => setHash(window.location.hash || "#/");
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);
    return hash.replace("#", "");
}
