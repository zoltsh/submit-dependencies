import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveExecutionContext } from '../src/environment/context';

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

describe('execution context', () => {
    it('combines repository and event validation', async () => {
        const root = await mkdtemp(join(tmpdir(), 'submit-context-test-'));
        roots.push(root);
        const eventPath = join(root, 'event.json');
        await writeFile(eventPath, JSON.stringify({ repository: { default_branch: 'main', full_name: 'zoltsh/demo' } }));
        await expect(resolveExecutionContext({
            directory: '.', githubToken: 'secret', validateLock: false, workspace: 'auto',
        }, {
            GITHUB_EVENT_NAME: 'push',
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_REF: 'refs/heads/main',
            GITHUB_REPOSITORY: 'zoltsh/demo',
            GITHUB_WORKSPACE: root,
        })).resolves.toMatchObject({
            event: { defaultBranch: 'main', eventName: 'push' },
            repository: { relativeDirectory: '.' },
        });
    });
});
