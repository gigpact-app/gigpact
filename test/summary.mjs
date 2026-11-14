// Prints the G2 R-VM evidence table from test/results.json (written by the test run).
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(new URL('./results.json', import.meta.url)));
const order = ['F1','F2','A1','A2','A3','A4','C1','C2','C3','C4','D1','D2','D3','D4a','D4b','D5','D6'];
const t = {};
for (const x of r) { const d = (t[x.path] ??= { cases: 0, ok: 0, valid: 0, invalid: 0 }); d.cases++; d.ok += x.ok ? 1 : 0; x.expect === 'pass' ? d.valid++ : d.invalid++; }
console.log('\nG2 R-VM evidence (libauth VM; not regtest, not wallet, not mainnet)');
console.log('path  cases  as-expected  valid  invalid');
for (const k of order) { const d = t[k]; if (d) console.log(k.padEnd(5), String(d.cases).padStart(5), String(d.ok).padStart(12), String(d.valid).padStart(6), String(d.invalid).padStart(8)); }
const tot = r.length, ok = r.filter((x) => x.ok).length;
console.log(`total ${tot} cases, ${ok} as expected, ${tot - ok} unexpected`);
console.log('Paths with at least 1 valid and 1 invalid case: ' + order.filter((k) => t[k] && t[k].valid > 0 && t[k].invalid > 0).length + '/' + order.length + ' (D4a/D4b are the two phi instances of fallback: 16 paths = 17 rows - 1)');
process.exit(ok === tot ? 0 : 1);
