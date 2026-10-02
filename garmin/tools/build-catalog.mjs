// Downloads the shared catalog and writes the compact watch copy:
// [[name, [main angles], [stefan angles]], ...]
import { writeFileSync } from 'node:fs';
const url = process.argv[2] || 'https://avacut.vercel.app/api/state';
const { data } = await (await fetch(url)).json();
const pick = (id, saw) => data.angles
    .filter(a => a.holdId === id && a.saw === saw)
    .map(a => Number(a.value)).sort((x, y) => x - y);
const rows = data.holds
    .map(h => [h.name, pick(h.id, 'main'), pick(h.id, 'stefan')])
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
writeFileSync(new URL('../resources/jsonData/catalog.json', import.meta.url), JSON.stringify(rows));
console.log(`${rows.length} holds written`);
