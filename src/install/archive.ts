import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, posix, resolve, sep } from 'node:path';

import { extract, list, type ReadEntry } from 'tar';

import {
    MAX_ARCHIVE_DECOMPRESSION_RATIO,
    MAX_ARCHIVE_ENTRIES,
    MAX_ARCHIVE_ENTRY_BYTES,
    MAX_EXTRACTED_BYTES,
} from '../constants';
import { SubmitDependenciesError } from '../errors';

const ALLOWED_ENTRY_TYPES = new Set(['Directory', 'File', 'OldFile']);

interface State {
    entries: number;
    error?: SubmitDependenciesError;
    foundBinary: boolean;
    readonly paths: Set<string>;
    uncompressedBytes: number;
}

export async function inspectArchive(archive: string, expectedRoot: string): Promise<void> {
    const state: State = { entries: 0, foundBinary: false, paths: new Set(), uncompressedBytes: 0 };
    try {
        await list({
            file: archive,
            gzip: true,
            maxDecompressionRatio: MAX_ARCHIVE_DECOMPRESSION_RATIO,
            onentry: (entry) => {
                entry.resume();
                if (state.error !== undefined) return;
                try {
                    validateEntry(entry, expectedRoot, state);
                } catch (error) {
                    state.error = error instanceof SubmitDependenciesError
                        ? error
                        : archiveError('Could not validate a Zolt archive entry.', error);
                }
            },
            strict: true,
        });
    } catch (error) {
        if (error instanceof SubmitDependenciesError) throw error;
        throw archiveError('Could not inspect the downloaded Zolt archive.', error);
    }
    if (state.error !== undefined) throw state.error;
    if (!state.foundBinary) throw archiveError(`Archive is missing ${expectedRoot}/bin/zolt.`);
}

export async function extractArchive(archive: string, destination: string, expectedRoot: string): Promise<string> {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    let validationError: SubmitDependenciesError | undefined;
    try {
        await extract({
            cwd: destination,
            file: archive,
            filter: (_path, entryValue) => {
                const entry = entryValue as ReadEntry;
                if (validationError !== undefined) return false;
                try {
                    validatePath(entry.path, expectedRoot);
                    if (!ALLOWED_ENTRY_TYPES.has(entry.type)) throw archiveError(`Archive entry ${entry.path} has forbidden type ${entry.type}.`);
                    return true;
                } catch (error) {
                    validationError = error instanceof SubmitDependenciesError ? error : archiveError('Could not validate extraction.', error);
                    return false;
                }
            },
            gzip: true,
            maxDecompressionRatio: MAX_ARCHIVE_DECOMPRESSION_RATIO,
            noChmod: true,
            noMtime: true,
            preserveOwner: false,
            strict: true,
        });
    } catch (error) {
        throw archiveError('Could not extract the downloaded Zolt archive.', error);
    }
    if (validationError !== undefined) throw validationError;
    const root = resolve(destination, expectedRoot);
    const binary = resolve(root, 'bin', 'zolt');
    const [rootReal, binaryReal, info] = await Promise.all([realpath(root), realpath(binary), lstat(binary)]);
    if (!binaryReal.startsWith(`${rootReal}${sep}`) || !info.isFile() || info.isSymbolicLink()) {
        throw archiveError('Extracted Zolt executable is not a contained regular file.');
    }
    await chmod(binary, 0o755);
    return binary;
}

function validateEntry(entry: ReadEntry, expectedRoot: string, state: State): void {
    validatePath(entry.path, expectedRoot);
    if (!ALLOWED_ENTRY_TYPES.has(entry.type)) throw archiveError(`Archive entry ${entry.path} has forbidden type ${entry.type}.`);
    if (entry.size < 0 || entry.size > MAX_ARCHIVE_ENTRY_BYTES) throw archiveError(`Archive entry ${entry.path} is too large.`);
    state.entries += 1;
    state.uncompressedBytes += entry.size;
    if (state.entries > MAX_ARCHIVE_ENTRIES || state.uncompressedBytes > MAX_EXTRACTED_BYTES) {
        throw archiveError('Archive exceeds extraction safety limits.');
    }
    const key = entry.path.toLowerCase();
    if (state.paths.has(key)) throw archiveError(`Archive contains a duplicate or case-colliding path: ${entry.path}.`);
    state.paths.add(key);
    if (((entry.mode ?? 0) & 0o7000) !== 0) throw archiveError(`Archive entry ${entry.path} contains privilege bits.`);
    const expectedBinary = `${expectedRoot}/bin/zolt`;
    const regularFile = entry.type === 'File' || entry.type === 'OldFile';
    if (regularFile && ((entry.mode ?? 0) & 0o111) !== 0 && entry.path !== expectedBinary) {
        throw archiveError(`Archive contains an unexpected executable: ${entry.path}.`);
    }
    if (entry.path === expectedBinary) {
        if (!regularFile) throw archiveError('Expected Zolt executable is not a regular file.');
        if (state.foundBinary) throw archiveError('Archive contains multiple Zolt executables.');
        state.foundBinary = true;
    }
}

function validatePath(path: string, expectedRoot: string): void {
    if (path.includes('\\') || path.includes('\0') || isAbsolute(path)) throw archiveError(`Archive entry has an unsafe path: ${path}.`);
    const normalized = posix.normalize(path);
    if (normalized !== path || normalized === '..' || normalized.startsWith('../')) throw archiveError(`Archive entry has an unsafe path: ${path}.`);
    const first = normalized.split('/')[0];
    if (first !== expectedRoot) throw archiveError(`Archive entry is outside expected root ${expectedRoot}: ${path}.`);
}

function archiveError(message: string, cause?: unknown): SubmitDependenciesError {
    return new SubmitDependenciesError('ZOLT-INSTALL-010', message, cause === undefined ? undefined : { cause });
}
