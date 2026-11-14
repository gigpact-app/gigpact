// Compiles the four GigPact R-0 contracts (BCH mode) with cashc 0.14.0,
// writes artifacts/*.json and artifacts/SOURCES.sha256, prints a size table.
import { compileFile } from 'cashc';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['GigPactFunded', 'GigPactAccepted', 'GigPactRequested', 'GigPactDispute'];
mkdirSync(join(root, 'artifacts'), { recursive: true });

const sums = [];
const rows = [];
for (const name of names) {
  const src = join(root, 'contracts', `${name}.cash`);
  const artifact = compileFile(src);
  writeFileSync(join(root, 'artifacts', `${name}.json`), JSON.stringify(artifact, null, 2));
  const sha = createHash('sha256').update(readFileSync(src)).digest('hex');
  sums.push(`${sha}  contracts/${name}.cash`);
  const fns = artifact.abi.map((f) => f.name).join(', ');
  const bytes = artifact.bytecode.split(' ').length;
  rows.push({ contract: name, compiler: artifact.compiler.version, functions: fns, opcodes: bytes, sha256: sha.slice(0, 12) });
}
writeFileSync(join(root, 'artifacts', 'SOURCES.sha256'), sums.join('\n') + '\n');
console.table(rows);
console.log(sums.join('\n'));
