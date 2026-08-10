import { mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoundedFileError, readBoundedRegularFile } from '../src/files';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

async function fixture(value: string): Promise<{ readonly path: string; readonly root: string }> {
    const root = await mkdtemp(join(tmpdir(), 'submit-files-test-'));
    roots.push(root);
    const path = join(root, 'fixture');
    await writeFile(path, value);
    return { path, root };
}

describe('bounded regular-file reads', () => {
    it('reads exactly one stable bounded file', async () => {
        const value = await fixture('content');
        await expect(readBoundedRegularFile(value.path, 7)).resolves.toEqual(Buffer.from('content'));
    });

    it('rejects invalid limits, oversized files, directories, and symbolic links', async () => {
        const value = await fixture('content');
        await expect(readBoundedRegularFile(value.path, -1)).rejects.toBeInstanceOf(RangeError);
        await expect(readBoundedRegularFile(value.path, 6)).rejects.toMatchObject({ reason: 'too-large' });
        await expect(readBoundedRegularFile(value.root, 1024)).rejects.toMatchObject({ reason: 'not-file' });
        const link = join(value.root, 'link');
        await symlink(value.path, link);
        await expect(readBoundedRegularFile(link, 1024)).rejects.toBeInstanceOf(BoundedFileError);
    });

    it('rejects growth detected after the inspected bytes are read', async () => {
        const value = await fixture('content');
        const info = await stat(value.path, { bigint: true });
        const close = vi.fn(async () => {
            await Promise.resolve();
        });
        const read = vi.fn(async (
            buffer: Uint8Array,
            offset: number,
            length: number,
            position: number,
        ) => {
            if (position === 0) {
                buffer.set(Buffer.from('content').subarray(0, length), offset);
                return await Promise.resolve({ bytesRead: length });
            }
            return await Promise.resolve({ bytesRead: 1 });
        });
        const opener = vi.fn(async () => await Promise.resolve({
            close,
            read,
            stat: async () => await Promise.resolve(info),
        }));

        await expect(readBoundedRegularFile(value.path, 7, opener)).rejects.toMatchObject({ reason: 'changed' });
        expect(close).toHaveBeenCalledOnce();
    });
});
