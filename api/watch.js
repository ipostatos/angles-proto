// GET /api/watch → compact public catalog for the Garmin watch app.
// { r: revision, h: [[holdName, [main angles], [stefan angles]], ...] }
// No images: Connect IQ web responses must stay a few KB.
import { getState } from './_lib/stateService.js';
import { neonStore } from './_lib/stateStore.js';

export function toWatchCatalog(data) {
    const holds = Array.isArray(data?.holds) ? data.holds : [];
    const angles = Array.isArray(data?.angles) ? data.angles : [];
    const pick = (id, saw) => angles
        .filter(a => a.holdId === id && a.saw === saw)
        .map(a => Number(a.value))
        .sort((x, y) => x - y);
    return holds
        .map(h => [h.name, pick(h.id, 'main'), pick(h.id, 'stefan')])
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const { data, revision } = await getState(neonStore);
        res.status(200).json({ r: revision, h: toWatchCatalog(data) });
    } catch (err) {
        console.error('/api/watch failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}
