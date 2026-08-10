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

    it('uses a semantic action version that matches version-tag builds', () => {
        expect(ACTION_VERSION).toMatch(/^\d+\.\d+\.\d+$/u);
        const expectedTag = process.env.EXPECTED_ACTION_TAG;
        if (expectedTag !== undefined && expectedTag !== '') {
            expect(`v${ACTION_VERSION}`).toBe(expectedTag);
        }
    });

    it('documents version updates and detector verification', async () => {
        const releasing = await readFile(new URL('../docs/RELEASING.md', import.meta.url), 'utf8');

        expect(releasing).toContain('`ACTION_VERSION`');
        expect(releasing).toContain('detector version');
    });
});
