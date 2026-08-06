import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { convert } from '../src/converter/convert';
import { PRESERVE_ZOLT_PURLS } from '../src/converter/purl-policy';
import { verifyZoltVersion } from '../src/install/verify';
import { captureZoltOutputs } from '../src/zolt/commands';
import { component, projectBom, projectTree, purl } from './converter-fixtures';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

describe('action analysis integration', () => {
    it('runs the real process adapter against a fake Zolt CLI and converts its machine outputs', async () => {
        const root = await mkdtemp(join(tmpdir(), 'submit-action-integration-'));
        roots.push(root);
        const project = join(root, 'project');
        const runnerTemp = join(root, 'runner-temp');
        await mkdir(project);
        await mkdir(runnerTemp);
        await writeFile(join(project, 'zolt.toml'), '[project]\nname = "fixture"\n');
        await writeFile(join(project, 'zolt.lock'), 'fixture');
        const workspace = await realpath(root);
        const projectDirectory = await realpath(project);

        const a = purl('org.example', 'a', '1.0.0');
        const b = purl('org.example', 'b', '2.0.0');
        const tree = projectTree([
            { id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true,
                dependencies: ['org.example:b:2.0.0:jar:runtime'] },
            { id: 'org.example:b', version: '2.0.0', scope: 'runtime', direct: false },
        ]);
        const bom = projectBom([component(a), component(b)], { [a]: [b], [b]: [] });
        const callLog = join(root, 'calls.txt');
        const fake = join(root, 'zolt');
        await writeFile(fake, fakeZoltScript(tree, bom, callLog));
        await chmod(fake, 0o755);

        await expect(verifyZoltVersion(fake, 'fixture-zolt-1', { PATH: process.env.PATH })).resolves.toBeUndefined();
        const machine = await captureZoltOutputs(fake, {
            directory: '.', githubToken: 'must-not-reach-zolt', state: 'submit', validateLock: true, workspace: 'false',
        }, {
            directory: projectDirectory, relativeDirectory: 'project', workspace,
        }, {
            environment: {
                HOME: root,
                PATH: process.env.PATH,
                RUNNER_TEMP: runnerTemp,
            },
        });
        const result = convert({ ...machine, purlPolicy: PRESERVE_ZOLT_PURLS });

        expect([...result.dependencies]).toEqual([
            [a, { dependencies: [b], packageUrl: a, relationship: 'direct', scope: 'runtime' }],
            [b, { dependencies: [], packageUrl: b, relationship: 'indirect', scope: 'runtime' }],
        ]);
        expect(await readFile(callLog, 'utf8')).toBe('version\nresolve\ntree\nsbom\n');
        expect(await readdir(runnerTemp)).toEqual([]);
    });
});

function fakeZoltScript(tree: unknown, bom: unknown, callLog: string): string {
    return `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const log = ${JSON.stringify(callLog)};
if (args.length === 1 && args[0] === '--version') {
  appendFileSync(log, 'version\\n');
  process.stdout.write('fixture-zolt-1');
} else if (args.includes('resolve')) {
  appendFileSync(log, 'resolve\\n');
} else if (args.includes('tree')) {
  appendFileSync(log, 'tree\\n');
  process.stdout.write(${JSON.stringify(JSON.stringify(tree))});
} else if (args.includes('sbom')) {
  appendFileSync(log, 'sbom\\n');
  const output = args[args.indexOf('--output') + 1];
  if (output === undefined) throw new Error('missing output');
  writeFileSync(output, ${JSON.stringify(JSON.stringify(bom))});
} else {
  throw new Error('unsupported fake Zolt invocation');
}
`;
}
