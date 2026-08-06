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

    it('keeps normal analysis minimal and strips every GitHub bearer channel from validation', () => {
        const source = {
            ACTIONS_CACHE_TOKEN: 'cache-bearer',
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-bearer',
            ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
            GITHUB_TOKEN: 'secret',
            HOME: '/home',
            MAVEN_TOKEN: 'maven',
            PATH: '/bin',
            SAME: 'secret',
        };
        expect(minimalZoltEnvironment(source)).toEqual({ PATH: '/bin' });
        expect(validationEnvironment(source, 'secret')).toEqual({ HOME: '/home', MAVEN_TOKEN: 'maven', PATH: '/bin' });
    });
});
