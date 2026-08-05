import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const temporary = await mkdtemp(join(tmpdir(), 'submit-dependencies-bundle-'));
try {
    const result = spawnSync('npx', ['ncc', 'build', 'src/index.ts', '-o', temporary, '--license', 'licenses.txt'], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'ncc failed');
    for (const file of ['index.js', 'licenses.txt', 'package.json']) {
        const [expected, actual] = await Promise.all([readFile(join('dist', file)), readFile(join(temporary, file))]);
        if (!expected.equals(actual)) throw new Error(`dist/${file} is stale; run npm run bundle.`);
    }
} finally {
    await rm(temporary, { force: true, recursive: true });
}
