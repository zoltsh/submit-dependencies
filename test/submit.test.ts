import { describe, expect, it, vi } from 'vitest';

import { submitSnapshot, type SnapshotClient } from '../src/github/submit';
import type { DependencySnapshot } from '../src/github/snapshot';

const context = {
    attempt: '1', owner: 'zoltsh', ref: 'refs/heads/main', repository: 'demo', runId: '5',
    serverUrl: 'https://github.com', sha: 'a'.repeat(40),
};
const snapshot = {
    detector: { name: 'detector', url: 'https://example.com', version: '1' },
    job: { correlator: 'c', html_url: 'https://github.com/run', id: '5.1' },
    manifests: {}, ref: context.ref, scanned: '2026-08-05T00:00:00.000Z', sha: context.sha, version: 0,
} satisfies DependencySnapshot;

describe('GitHub snapshot submission', () => {
    it('checks the branch tip immediately before submission and returns the snapshot ID', async () => {
        const getReference = vi.fn(async () => await Promise.resolve({
            data: { object: { sha: context.sha, type: 'commit' } },
        }));
        const createSnapshot = vi.fn(async () => await Promise.resolve({ data: { id: 123, result: 'SUCCESS' } }));
        const result = await submitSnapshot('masked-token', context, snapshot, { createSnapshot, getReference });
        expect(result).toEqual({ id: 123, result: 'SUCCESS' });
        expect(getReference).toHaveBeenCalledWith('zoltsh', 'demo', 'heads/main');
        expect(createSnapshot).toHaveBeenCalledWith({ ...snapshot, owner: 'zoltsh', repo: 'demo' });
        expect(getReference.mock.invocationCallOrder[0]).toBeLessThan(createSnapshot.mock.invocationCallOrder[0] ?? 0);
    });

    it('sanitizes request failures without serializing credentials or response bodies', async () => {
        const secret = 'github_pat_secret';
        const client: SnapshotClient = {
            createSnapshot: async () => {
                await Promise.resolve();
                throw Object.assign(new Error(`Authorization Bearer ${secret}`), {
                    request: { method: 'POST', url: `https://api.github.com/repos/zoltsh/demo/dependency-graph/snapshots?token=${secret}` },
                    response: { headers: { 'x-github-request-id': 'ABCD:1234' }, status: 403 },
                    status: 403,
                    responseBody: { token: secret },
                });
            },
            getReference: async () => await Promise.resolve({
                data: { object: { sha: context.sha, type: 'commit' } },
            }),
        };
        await expect(submitSnapshot(secret, context, snapshot, client)).rejects.toThrow(
            'status 403, POST, /dependency-graph/snapshots, request ABCD:1234',
        );
        try {
            await submitSnapshot(secret, context, snapshot, client);
        } catch (error) {
            expect(String(error)).not.toContain(secret);
        }
    });

    it('rejects invalid success responses with a stable error', async () => {
        const client: SnapshotClient = {
            createSnapshot: async () => await Promise.resolve({ data: { id: 0, result: 'SUCCESS' } }),
            getReference: async () => await Promise.resolve({
                data: { object: { sha: context.sha, type: 'commit' } },
            }),
        };
        await expect(submitSnapshot('token', context, snapshot, client)).rejects.toThrow('invalid snapshot ID');
    });

    it.each([
        [401, 'Bad credentials'],
        [403, 'Resource not accessible by integration'],
        [422, 'Validation Failed'],
        [429, 'rate limit exceeded'],
        [500, 'server error'],
    ])('reports HTTP %i without exposing the response message', async (status, message) => {
        const client: SnapshotClient = {
            createSnapshot: async () => {
                await Promise.resolve();
                throw Object.assign(new Error(message), { status });
            },
            getReference: async () => await Promise.resolve({
                data: { object: { sha: context.sha, type: 'commit' } },
            }),
        };
        let failure = '';
        try {
            await submitSnapshot('masked-token', context, snapshot, client);
        } catch (error) {
            failure = String(error);
        }
        expect(failure).toContain(`status ${status.toString()}, POST, /dependency-graph/snapshots`);
        expect(failure).not.toContain(message);
    });

    it('sanitizes network interruptions and messages that equal the token', async () => {
        const network: SnapshotClient = {
            createSnapshot: async () => {
                await Promise.resolve();
                throw new Error('connect ECONNRESET api.github.com');
            },
            getReference: async () => await Promise.resolve({
                data: { object: { sha: context.sha, type: 'commit' } },
            }),
        };
        let networkFailure = '';
        try {
            await submitSnapshot('masked-token', context, snapshot, network);
        } catch (error) {
            networkFailure = String(error);
        }
        expect(networkFailure).toContain('POST, /dependency-graph/snapshots');
        expect(networkFailure).not.toContain('connect ECONNRESET api.github.com');
        const echo: SnapshotClient = {
            createSnapshot: async () => {
                await Promise.resolve();
                throw new Error('masked-token');
            },
            getReference: async () => await Promise.resolve({
                data: { object: { sha: context.sha, type: 'commit' } },
            }),
        };
        try {
            await submitSnapshot('masked-token', context, snapshot, echo);
        } catch (error) {
            expect(String(error)).not.toContain('masked-token');
        }
    });

    it('rejects an invalid or advanced default-branch tip without posting', async () => {
        for (const object of [
            { sha: 'not-a-sha', type: 'commit' },
            { sha: 'b'.repeat(40), type: 'commit' },
            { sha: context.sha, type: 'tag' },
        ]) {
            const createSnapshot = vi.fn(async () => await Promise.resolve({ data: { id: 1, result: 'SUCCESS' } }));
            await expect(submitSnapshot('token', context, snapshot, {
                createSnapshot,
                getReference: async () => await Promise.resolve({ data: { object } }),
            })).rejects.toThrow('ZOLT-GITHUB-003');
            expect(createSnapshot).not.toHaveBeenCalled();
        }
    });

    it('sanitizes reference lookup failures', async () => {
        const client: SnapshotClient = {
            createSnapshot: async () => await Promise.resolve({ data: { id: 1, result: 'SUCCESS' } }),
            getReference: async () => {
                await Promise.resolve();
                throw Object.assign(new Error('Resource not accessible by integration'), { status: 403 });
            },
        };
        await expect(submitSnapshot('token', context, snapshot, client)).rejects.toThrow(
            'status 403, GET, /git/ref',
        );
    });
});
