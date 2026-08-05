import { describe, expect, it } from 'vitest';

import { readGitHubSubmissionContext } from '../src/github/context';

const valid = {
    GITHUB_REPOSITORY: 'zoltsh/demo',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_RUN_ID: '12345',
    GITHUB_SERVER_URL: 'https://github.com/',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: 'A'.repeat(40),
};

describe('GitHub submission context', () => {
    it('validates and normalizes the GitHub Actions environment', () => {
        expect(readGitHubSubmissionContext(valid)).toEqual({
            attempt: '2', owner: 'zoltsh', ref: 'refs/heads/main', repository: 'demo', runId: '12345',
            serverUrl: 'https://github.com', sha: 'a'.repeat(40),
        });
    });

    it.each([
        ['GITHUB_REPOSITORY', 'bad'],
        ['GITHUB_SHA', 'not-a-sha'],
        ['GITHUB_REF', 'refs/tags/v1'],
        ['GITHUB_RUN_ID', '0'],
        ['GITHUB_RUN_ATTEMPT', '1.5'],
        ['GITHUB_SERVER_URL', 'https://example.com'],
    ])('rejects invalid %s', (key, value) => {
        expect(() => readGitHubSubmissionContext({ ...valid, [key]: value })).toThrow('ZOLT-GITHUB-001');
    });

    it('rejects missing fields', () => {
        const environment: NodeJS.ProcessEnv = { ...valid };
        delete environment.GITHUB_SHA;
        expect(() => readGitHubSubmissionContext(environment)).toThrow('GITHUB_SHA is required');
    });
});
