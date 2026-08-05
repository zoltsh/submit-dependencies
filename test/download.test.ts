import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArchiveDownloader, type HttpClientLike, type HttpMessage } from '../src/install/download';

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

function client(body: Buffer, statusCode = 200, contentLength = body.length.toString()): HttpClientLike {
    const dispose = vi.fn();
    return {
        dispose,
        get: vi.fn(async () => {
            await Promise.resolve();
            const message = Readable.from([body]) as unknown as HttpMessage;
            Object.assign(message, { headers: { 'content-length': contentLength }, statusCode });
            return Promise.resolve({ message });
        }),
    };
}

async function destination(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'submit-download-test-'));
    roots.push(root);
    return join(root, 'archive.tar.gz');
}

describe('archive downloader', () => {
    it('streams bytes and returns their digest', async () => {
        const body = Buffer.from('archive');
        const transport = client(body);
        const downloader = new ArchiveDownloader(transport);
        const path = await destination();
        await expect(downloader.download(new URL(
            'https://github.com/zoltsh/releases/releases/download/tag/archive.tar.gz',
        ), path)).resolves.toEqual({
            bytes: body.length,
            sha256: createHash('sha256').update(body).digest('hex'),
        });
        await expect(readFile(path)).resolves.toEqual(body);
        downloader.dispose();
        expect(transport.dispose).toHaveBeenCalledOnce();
    });

    it('rejects origins, HTTP failures, and invalid lengths', async () => {
        const path = await destination();
        await expect(new ArchiveDownloader(client(Buffer.alloc(0))).download(
            new URL('https://example.com/archive.tar.gz'), path,
        )).rejects.toThrow('ZOLT-INSTALL-004');
        await expect(new ArchiveDownloader(client(Buffer.alloc(0), 500)).download(
            new URL('https://github.com/zoltsh/releases/releases/download/tag/archive.tar.gz'), path,
        )).rejects.toThrow('ZOLT-INSTALL-008');
        await expect(new ArchiveDownloader(client(Buffer.alloc(0), 200, 'invalid')).download(
            new URL('https://github.com/zoltsh/releases/releases/download/tag/archive.tar.gz'), path,
        )).rejects.toThrow('ZOLT-INSTALL-009');
    });

    it('does not remove a destination it did not create', async () => {
        const path = await destination();
        await writeFile(path, 'owned');
        await expect(new ArchiveDownloader(client(Buffer.from('new'))).download(
            new URL('https://github.com/zoltsh/releases/releases/download/tag/archive.tar.gz'), path,
        )).rejects.toThrow('ZOLT-INSTALL-007');
        await expect(readFile(path, 'utf8')).resolves.toBe('owned');
    });

    it('sanitizes request and stream failures and removes owned partial files', async () => {
        const requestFailure: HttpClientLike = {
            dispose: vi.fn(),
            get: vi.fn(async () => {
                await Promise.resolve();
                throw new Error('network failure');
            }),
        };
        const path = await destination();
        await expect(new ArchiveDownloader(requestFailure).download(
            new URL('https://github.com/zoltsh/releases/releases/download/tag/archive.tar.gz'), path,
        )).rejects.toThrow('ZOLT-INSTALL-005');

        const stream = Readable.from((async function* chunks() {
            await Promise.resolve();
            yield Buffer.from('partial');
            throw new Error('broken stream');
        })()) as unknown as HttpMessage;
        Object.assign(stream, { headers: {}, statusCode: 200 });
        const broken: HttpClientLike = {
            dispose: vi.fn(),
            get: vi.fn(async () => {
                await Promise.resolve();
                return { message: stream };
            }),
        };
        await expect(new ArchiveDownloader(broken).download(
            new URL('https://github.com/zoltsh/releases/releases/download/tag/archive.tar.gz'), path,
        )).rejects.toThrow('ZOLT-INSTALL-007');
        await expect(readFile(path)).rejects.toThrow();
    });
});
