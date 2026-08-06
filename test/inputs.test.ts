import { describe, expect, it } from 'vitest';

import { parseBoolean, parseState, parseWorkspace, readInputs, type InputReader } from '../src/inputs';

function reader(values: Record<string, string>): InputReader {
    return { getInput: (name) => values[name] ?? '' };
}

describe('inputs', () => {
    it('applies narrow defaults', () => {
        expect(readInputs(reader({ 'github-token': 'secret' }))).toEqual({
            directory: '.',
            githubToken: 'secret',
            state: 'submit',
            validateLock: false,
            workspace: 'auto',
        });
    });

    it('accepts every explicit mode', () => {
        expect(parseWorkspace('true')).toBe('true');
        expect(parseWorkspace('false')).toBe('false');
        expect(parseWorkspace(' auto ')).toBe('auto');
        expect(parseBoolean('validate-lock', 'true')).toBe(true);
        expect(parseBoolean('validate-lock', 'false')).toBe(false);
        expect(parseState('clear')).toBe('clear');
        expect(parseState(' submit ')).toBe('submit');
    });

    it('rejects coercion, empty tokens, and NUL paths', () => {
        expect(() => parseWorkspace('yes')).toThrow('ZOLT-INPUT-003');
        expect(() => parseBoolean('validate-lock', '1')).toThrow('ZOLT-INPUT-005');
        expect(() => parseState('delete')).toThrow('ZOLT-INPUT-008');
        expect(() => readInputs(reader({ 'github-token': ' ' }))).toThrow('ZOLT-INPUT-002');
        expect(() => readInputs(reader({ directory: 'bad\0path', 'github-token': 'secret' }))).toThrow('ZOLT-INPUT-001');
    });

    it('requires one safe repository-relative lock path when clearing', () => {
        expect(readInputs(reader({
            'github-token': 'secret',
            'manifest-path': 'services/old/zolt.lock',
            state: 'clear',
        }))).toMatchObject({ manifestPath: 'services/old/zolt.lock', state: 'clear' });
        for (const manifestPath of ['', '/zolt.lock', '../zolt.lock', 'services\\zolt.lock', 'pom.xml']) {
            expect(() => readInputs(reader({
                'github-token': 'secret',
                'manifest-path': manifestPath,
                state: 'clear',
            }))).toThrow('ZOLT-INPUT-009');
        }
        expect(() => readInputs(reader({
            'github-token': 'secret',
            'manifest-path': 'zolt.lock',
            state: 'submit',
        }))).toThrow('ZOLT-INPUT-009');
    });

    it('masks the token before validating other inputs', () => {
        const calls: string[] = [];
        expect(() => readInputs(reader({ 'github-token': 'secret', workspace: 'invalid' }), (secret) => {
            calls.push(secret);
        })).toThrow('ZOLT-INPUT-003');
        expect(calls).toEqual(['secret']);
    });
});
