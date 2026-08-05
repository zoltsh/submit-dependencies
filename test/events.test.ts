import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { enforceEventPolicy } from '../src/environment/events';

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

async function event(payload: unknown): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'submit-event-test-'));
    roots.push(root);
    const path = join(root, 'event.json');
    await writeFile(path, JSON.stringify(payload));
    return path;
}

describe('event policy', () => {
    it('accepts push and dispatch only on the default branch', async () => {
        const eventPath = await event({ repository: { default_branch: 'main', full_name: 'zoltsh/demo' } });
        for (const eventName of ['push', 'workflow_dispatch']) {
            await expect(enforceEventPolicy({
                eventName,
                eventPath,
                ref: 'refs/heads/main',
                repository: 'zoltsh/demo',
            })).resolves.toEqual({ defaultBranch: 'main', eventName });
        }
    });

    it('rejects unsafe events, branches, and repositories', async () => {
        const eventPath = await event({ repository: { default_branch: 'main', full_name: 'fork/demo' } });
        await expect(enforceEventPolicy({
            eventName: 'pull_request', eventPath: undefined, ref: undefined, repository: undefined,
        })).rejects.toThrow('ZOLT-EVENT-001');
        await expect(enforceEventPolicy({
            eventName: 'push', eventPath: undefined, ref: undefined, repository: undefined,
        })).rejects.toThrow('ZOLT-EVENT-002');
        await expect(enforceEventPolicy({
            eventName: 'push', eventPath, ref: 'refs/heads/main', repository: 'zoltsh/demo',
        })).rejects.toThrow('ZOLT-EVENT-003');
        const safePath = await event({ repository: { default_branch: 'main', full_name: 'zoltsh/demo' } });
        await expect(enforceEventPolicy({
            eventName: 'push', eventPath: safePath, ref: 'refs/heads/feature', repository: 'zoltsh/demo',
        })).rejects.toThrow('ZOLT-EVENT-004');
    });

    it('rejects malformed payloads', async () => {
        const badPath = await event([]);
        await expect(enforceEventPolicy({
            eventName: 'push', eventPath: badPath, ref: 'refs/heads/main', repository: 'zoltsh/demo',
        })).rejects.toThrow('ZOLT-EVENT-006');
        const missingFields = await event({ repository: { default_branch: '', full_name: 12 } });
        await expect(enforceEventPolicy({
            eventName: 'push', eventPath: missingFields, ref: 'refs/heads/main', repository: 'zoltsh/demo',
        })).rejects.toThrow('ZOLT-EVENT-007');
        const root = await mkdtemp(join(tmpdir(), 'submit-event-invalid-test-'));
        roots.push(root);
        const invalid = join(root, 'event.json');
        await writeFile(invalid, '{');
        await expect(enforceEventPolicy({
            eventName: 'push', eventPath: invalid, ref: 'refs/heads/main', repository: 'zoltsh/demo',
        })).rejects.toThrow('ZOLT-EVENT-005');
    });
});
