import { describe, expect, it } from 'vitest';

import { resolveTarget } from '../src/install/platform';

describe('platform', () => {
    it('maps all supported targets', () => {
        expect(resolveTarget('linux', 'x64')).toBe('linux-x64');
        expect(resolveTarget('linux', 'arm64')).toBe('linux-arm64');
        expect(resolveTarget('darwin', 'x64')).toBe('macos-x64');
        expect(resolveTarget('darwin', 'arm64')).toBe('macos-arm64');
    });

    it('fails clearly on Windows and unknown architectures', () => {
        expect(() => resolveTarget('win32', 'x64')).toThrow('does not support Windows');
        expect(() => resolveTarget('linux', 'riscv64')).toThrow('ZOLT-INSTALL-002');
    });
});
