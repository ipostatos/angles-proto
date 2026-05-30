export function isSafeRasterDataUrl(s) {
    return typeof s === 'string' && /^data:image\/(png|jpe?g|webp|gif);/i.test(s);
}

export const WEAK_PINS = new Set([
    '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
    '1234', '4321', '0123',
]);

export function isStrongAdminPassword(pw) {
    const p = String(pw ?? '');
    if (!/^\d{4}$/.test(p)) return false;
    if (WEAK_PINS.has(p)) return false;
    return true;
}
