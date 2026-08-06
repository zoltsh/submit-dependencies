import { describe, expect, it } from 'vitest';

import { SubmitDependenciesError } from '../src/errors';
import { publicErrorMessage, publicText, registeredSecrets } from '../src/public-output';

describe('errors', () => {
    it('keeps stable codes without exposing internal causes', () => {
        const cause = new Error('raw command and secret cause');
        const error = new SubmitDependenciesError('ZOLT-TEST-001', 'failed', { cause });
        expect(error.code).toBe('ZOLT-TEST-001');
        expect(publicErrorMessage(error)).toBe('ZOLT-TEST-001: failed');
        expect(publicErrorMessage('plain')).toBe('ZOLT-UNEXPECTED-001: Unexpected action failure.');
        expect(publicErrorMessage(error)).not.toContain('raw command');
    });

    it('normalizes, redacts, and bounds all public text', () => {
        const environment = { AWS_ACCESS_KEY_ID: 'cloud-secret', DEPLOY_PASSWORD: 'other-secret' };
        const secrets = registeredSecrets(environment);
        const value = '\u001B[31m::warning:: first\nsecond\tcloud-secret other-secret https://me:password@example.com/';
        expect(publicText(value, secrets)).toBe(
            ': :warning: : first second *** *** https://***:***@example.com/',
        );
        expect(publicText('x'.repeat(5000))).toHaveLength(4096);
    });
});
