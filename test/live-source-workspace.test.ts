import { realpath } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { convert } from '../src/converter/convert';
import { PRESERVE_ZOLT_PURLS } from '../src/converter/purl-policy';
import { captureZoltOutputs } from '../src/zolt/commands';

describe('live source-built Zolt workspace contract', () => {
    it.runIf(process.env.RUN_LIVE_ZOLT_SOURCE === 'true')(
        'converts the Zolt source workspace with a source-built CLI',
        async () => {
            const binaryInput = process.env.ZOLT_LIVE_BINARY;
            const workspaceInput = process.env.ZOLT_LIVE_WORKSPACE;
            if (binaryInput === undefined || workspaceInput === undefined) {
                throw new Error('ZOLT_LIVE_BINARY and ZOLT_LIVE_WORKSPACE are required.');
            }
            const binary = await realpath(binaryInput);
            const workspace = await realpath(workspaceInput);
            const machine = await captureZoltOutputs(binary, {
                directory: '.',
                githubToken: 'must-not-reach-zolt',
                state: 'submit',
                validationEnv: [],
                validateLock: false,
                workspace: 'true',
            }, {
                directory: workspace,
                relativeDirectory: '.',
                workspace,
            });
            const result = convert({ ...machine, purlPolicy: PRESERVE_ZOLT_PURLS });

            expect(result).toMatchObject({ lockVersion: 5, mode: 'workspace', treeSchema: 3 });
            expect(result.statistics.externalDependencies).toBeGreaterThan(0);
            expect([...result.dependencies.keys()]).not.toContainEqual(expect.stringContaining('/sh.zolt/'));
        },
        120_000,
    );
});
