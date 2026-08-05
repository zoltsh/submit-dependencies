import { describe, expect, it, vi } from 'vitest';

import { submitSnapshot, type SnapshotClient } from '../src/github/submit';
import type { DependencySnapshot } from '../src/github/snapshot';

const context = {
    attempt: '1', owner: 'zoltsh', ref: 'refs/heads/main', repository: 'demo', runId: '5',
    serverUrl: 'https://github.com', sha: 'a'.repeat(40),
};
const snapshot = {
    detector: { metadata: {}, name: 'detector', url: 'https://example.com', version: '1' },
    job: { correlator: 'c', html_url: 'https://github.com/run', id: '5.1' },
    manifests: {}, ref: context.ref, scanned: '2026-08-05T00:00:00.000Z', sha: context.sha, version: 0,
} satisfies DependencySnapshot;

describe('GitHub snapshot submission', () => {
    it('submits to the documented endpoint and returns the snapshot ID', async () => {
        const request = vi.fn(async () => await Promise.resolve({ data: { id: 123, result: 'SUCCESS' } }));
        const result = await submitSnapshot('masked-token', context, snapshot, { request });
        expect(result).toEqual({ id: 123, result: 'SUCCESS' });
        expect(request).toHaveBeenCalledWith(
            'POST /repos/{owner}/{repo}/dependency-graph/snapshots',
            { ...snapshot, owner: 'zoltsh', repo: 'demo' },
        );
    });

    it('sanitizes request failures without serializing credentials or response bodies', async () => {
        const secret = 'github_pat_secret';
        const client: SnapshotClient = {
            request: async () => {
                await Promise.resolve();
                throw Object.assign(new Error(`Authorization Bearer ${secret}`), {
                    request: { method: 'POST', url: `https://api.github.com/repos/zoltsh/demo/dependency-graph/snapshots?token=${secret}` },
                    response: { headers: { 'x-github-request-id': 'ABCD:1234' }, status: 403 },
                    status: 403,
                    responseBody: { token: secret },
                });
            },
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
            request: async () => await Promise.resolve({ data: { id: 0, result: 'SUCCESS' } }),
        };
        await expect(submitSnapshot('token', context, snapshot, client)).rejects.toThrow('invalid snapshot ID');
    });

    it.each([
        [401, 'Bad credentials'],
        [403, 'Resource not accessible by integration'],
        [422, 'Validation Failed'],
        [429, 'rate limit exceeded'],
        [500, 'server error'],
    ])('reports HTTP %i with a bounded safe message', async (status, message) => {
        const client: SnapshotClient = {
            request: async () => {
                await Promise.resolve();
                throw Object.assign(new Error(message), { status });
            },
        };
        await expect(submitSnapshot('masked-token', context, snapshot, client)).rejects.toThrow(
            `status ${status.toString()}, /dependency-graph/snapshots, ${message}`,
        );
    });

    it('sanitizes network interruptions and messages that equal the token', async () => {
        const network: SnapshotClient = {
            request: async () => {
                await Promise.resolve();
                throw new Error('connect ECONNRESET api.github.com');
            },
        };
        await expect(submitSnapshot('masked-token', context, snapshot, network)).rejects.toThrow(
            '/dependency-graph/snapshots, connect ECONNRESET api.github.com',
        );
        const echo: SnapshotClient = {
            request: async () => {
                await Promise.resolve();
                throw new Error('masked-token');
            },
        };
        try {
            await submitSnapshot('masked-token', context, snapshot, echo);
        } catch (error) {
            expect(String(error)).not.toContain('masked-token');
        }
    });
});
