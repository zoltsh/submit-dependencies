import { describe, expect, it } from 'vitest';

import { errorMessage, SubmitDependenciesError } from '../src/errors';

describe('errors', () => {
    it('keeps stable codes and bounded cause chains', () => {
        const cause = new Error('root');
        const error = new SubmitDependenciesError('ZOLT-TEST-001', 'failed', { cause });
        expect(error.code).toBe('ZOLT-TEST-001');
        expect(errorMessage(error)).toBe('ZOLT-TEST-001: failed: root');
        expect(errorMessage('plain')).toBe('plain');
        expect(errorMessage(error, true)).toContain('SubmitDependenciesError');
    });
});
