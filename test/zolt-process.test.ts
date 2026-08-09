import { describe, expect, it } from 'vitest';

import { minimalZoltEnvironment, runZolt, validationEnvironment } from '../src/zolt/process';

describe('Zolt process adapter', () => {
    it('captures stdout and stderr without a shell wrapper', async () => {
        const result = await runZolt('/bin/sh', ['-c', 'printf tree; printf warning >&2'], {
            cwd: '/', environment: { PATH: '/bin' }, label: 'fixture',
        });
        expect(result.stdout.toString()).toBe('tree');
        expect(result.stderr.toString()).toBe('warning');
    });

    it('returns a stable process error without exposing machine stderr', async () => {
        let failure = '';
        try {
            await runZolt('/bin/sh', ['-c', 'printf \'\\033[31m::warning:: first\\nsecond secret-value\' >&2; exit 7'], {
                cwd: '/', environment: { DEPLOY_PASSWORD: 'secret-value', PATH: '/bin' }, label: 'fixture command',
            });
        } catch (error) {
            failure = String(error);
        }
        expect(failure).toContain('ZOLT-PROCESS-001: fixture command failed.');
        expect(failure).not.toContain('warning');
        expect(failure).not.toContain('secret-value');
    });

    it('keeps normal analysis minimal and passes only explicit validation variables', () => {
        const source = {
            ACTIONS_CACHE_TOKEN: 'cache-bearer',
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-bearer',
            ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
            GITHUB_TOKEN: 'secret',
            HOME: '/home',
            MAVEN_TOKEN: 'maven',
            PATH: '/bin',
            TMPDIR: 'prefix-secret-suffix',
            SAME: 'secret',
        };
        expect(minimalZoltEnvironment(source)).toEqual({ PATH: '/bin', TMPDIR: 'prefix-secret-suffix' });
        expect(validationEnvironment(source, 'secret', ['MAVEN_TOKEN'])).toEqual({
            HOME: '/home',
            MAVEN_TOKEN: 'maven',
            PATH: '/bin',
        });
    });

    it('fails closed for missing, GitHub-owned, or token-containing validation variables', () => {
        const source = {
            ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
            AUTH_HEADER: 'Bearer github-secret',
            GITHUB_TOKEN: 'github-secret',
            PATH: '/bin',
        };
        expect(() => validationEnvironment(source, 'github-secret', ['MISSING'])).toThrow('ZOLT-INPUT-011');
        expect(() => validationEnvironment(source, 'github-secret', ['GITHUB_TOKEN'])).toThrow('ZOLT-INPUT-011');
        expect(() => validationEnvironment(
            source,
            'github-secret',
            ['ACTIONS_ID_TOKEN_REQUEST_URL'],
        )).toThrow('ZOLT-INPUT-011');
        expect(() => validationEnvironment(source, 'github-secret', ['AUTH_HEADER'])).toThrow('ZOLT-INPUT-011');
    });
});
