import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { ACTION_VERSION } from '../src/constants';

describe('release contract', () => {
    it('reconciles every default-branch commit in the canonical workflow', async () => {
        const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
        const workflow = readme.slice(readme.indexOf('```yaml'), readme.indexOf('```', readme.indexOf('```yaml') + 3));

        expect(workflow).toContain('push:\n    branches: [main]');
        expect(workflow).not.toContain('\n    paths:');
    });

    it('matches immutable and compatibility action tags', () => {
        expect(ACTION_VERSION).toMatch(/^\d+\.\d+\.\d+$/u);
        expect(actionReleaseTags('1.2.3')).toEqual(['v1.2.3', 'v1', 'v1.2']);
        expect(actionReleaseTags('1.2.3')).not.toContain('v1.2.4');
        expect(actionReleaseTags('1.2.3')).not.toContain('latest');
        const expectedTag = process.env.EXPECTED_ACTION_TAG;
        if (expectedTag !== undefined && expectedTag !== '') {
            expect(actionReleaseTags(ACTION_VERSION)).toContain(expectedTag);
        }
    });

    it('documents version updates and detector verification', async () => {
        const releasing = await readFile(new URL('../docs/RELEASING.md', import.meta.url), 'utf8');

        expect(releasing).toContain('`ACTION_VERSION`');
        expect(releasing).toContain('detector version');
        expect(releasing).toContain('`v0`');
        expect(releasing).toContain('matching minor compatibility tag');
    });
});

function actionReleaseTags(version: string): readonly string[] {
    const [major, minor, patch, extra] = version.split('.');
    if (major === undefined || minor === undefined || patch === undefined || extra !== undefined) return [];
    return [`v${version}`, `v${major}`, `v${major}.${minor}`];
}
