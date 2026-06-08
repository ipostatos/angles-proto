export async function loadHistory(limit = 200) {
    const params = new URLSearchParams({ limit: String(limit) });
    const res = await fetch(`/api/history?${params.toString()}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
    });
    if (!res.ok) {
        const err = new Error(`/api/history responded with status ${res.status}`);
        err.status = res.status;
        throw err;
    }
    const body = await res.json();
    if (!body || typeof body !== 'object' || !Array.isArray(body.rows)) {
        throw new Error('Invalid /api/history response shape');
    }
    return body.rows.map((r) => ({
        id: Number(r.id),
        username: r.username ?? '',
        action: r.action ?? '',
        entity: r.entity ?? null,
        field: r.field ?? null,
        oldValue: r.oldValue ?? null,
        newValue: r.newValue ?? null,
        createdAt: r.createdAt ?? null,
    })).filter((r) => Number.isFinite(r.id));
}
