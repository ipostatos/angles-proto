export function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
}

export function toAngleLabel(n) {
    const isInt = Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
    return isInt ? `${Math.round(Number(n))}°` : `${Number(n).toFixed(1)}°`;
}

export function sortAngles(angles, saw, direction) {
    return [...angles]
        .filter(a => a.saw === saw)
        .sort((x, y) => direction === 'asc'
            ? Number(x.value) - Number(y.value) || x.hold.localeCompare(y.hold)
            : Number(y.value) - Number(x.value) || x.hold.localeCompare(y.hold)
        );
}
