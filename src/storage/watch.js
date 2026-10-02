// "Send to watch": stores the selected hold names on the server; the Garmin
// app picks them up through GET /api/watch on its next start.
export async function sendHoldsToWatch(holdNames) {
    const res = await fetch('/api/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ holds: holdNames }),
    });
    if (!res.ok) throw new Error(`/api/watch responded with status ${res.status}`);
    return res.json();
}
