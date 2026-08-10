import { constants, type BigIntStats } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';

export type BoundedFileFailure = 'changed' | 'not-file' | 'too-large';

export class BoundedFileError extends Error {
    public readonly reason: BoundedFileFailure;

    constructor(reason: BoundedFileFailure, options?: ErrorOptions) {
        super(`Bounded file ${reason}.`, options);
        this.name = 'BoundedFileError';
        this.reason = reason;
    }
}

interface BoundedFileHandle {
    close(): Promise<void>;
    read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ readonly bytesRead: number }>;
    stat(options: { readonly bigint: true }): Promise<BigIntStats>;
}

type BoundedFileOpener = (path: string) => Promise<BoundedFileHandle>;

export async function readBoundedRegularFile(
    path: string,
    maxBytes: number,
    opener: BoundedFileOpener = openWithoutFollowing,
): Promise<Buffer> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('maxBytes must be a non-negative safe integer.');
    const file = await opener(path);
    try {
        const before = await file.stat({ bigint: true });
        if (!before.isFile()) throw new BoundedFileError('not-file');
        if (before.size > BigInt(maxBytes)) throw new BoundedFileError('too-large');

        const size = Number(before.size);
        const bytes = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
            const result = await file.read(bytes, offset, size - offset, offset);
            if (result.bytesRead === 0) throw new BoundedFileError('changed');
            offset += result.bytesRead;
        }
        const probe = await file.read(Buffer.alloc(1), 0, 1, size);
        const after = await file.stat({ bigint: true });
        if (probe.bytesRead !== 0 || !sameFileState(before, after)) throw new BoundedFileError('changed');
        return bytes;
    } finally {
        await file.close();
    }
}

async function openWithoutFollowing(path: string): Promise<FileHandle> {
    try {
        return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
            throw new BoundedFileError('not-file', { cause: error });
        }
        throw error;
    }
}

function sameFileState(before: BigIntStats, after: BigIntStats): boolean {
    return after.isFile()
        && before.dev === after.dev
        && before.ino === after.ino
        && before.mode === after.mode
        && before.nlink === after.nlink
        && before.size === after.size
        && before.mtimeNs === after.mtimeNs
        && before.ctimeNs === after.ctimeNs;
}
