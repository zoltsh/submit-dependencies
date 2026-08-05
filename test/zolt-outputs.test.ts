import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseMachineJson, readMachineJson } from '../src/zolt/outputs';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

describe('machine output decoding', () => {
    it('parses UTF-8 JSON from memory and bounded files', async () => {
        expect(parseMachineJson(Buffer.from('{"ok":true}'), 'fixture')).toEqual({ ok: true });
        const root = await mkdtemp(join(tmpdir(), 'submit-output-test-'));
        roots.push(root);
        const path = join(root, 'output.json');
        await writeFile(path, '{"ok":true}');
        await expect(readMachineJson(path, 'fixture')).resolves.toEqual({ ok: true });
    });

    it('rejects invalid UTF-8, JSON, and missing files', async () => {
        expect(() => parseMachineJson(Buffer.from([0xC3, 0x28]), 'fixture')).toThrow('ZOLT-OUTPUT-002');
        expect(() => parseMachineJson(Buffer.from('{'), 'fixture')).toThrow('ZOLT-OUTPUT-003');
        await expect(readMachineJson('/missing/zolt-output.json', 'fixture')).rejects.toThrow('ZOLT-OUTPUT-004');
    });
});
