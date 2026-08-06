import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readFile,
    readdir,
    readlink,
    realpath,
    rm,
    stat,
    symlink,
    writeFile,
    type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import {
    MAX_REPOSITORY_BLOB_BYTES,
    MAX_REPOSITORY_VIEW_BYTES,
    MAX_REPOSITORY_VIEW_ENTRIES,
} from '../constants';
import { SubmitDependenciesError } from '../errors';
import type { SubmissionState } from '../types';

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_SYMLINK_BYTES = 4096;
const execute = promisify(execFile);

export interface RepositoryViewInput {
    readonly directory: string;
    readonly expectedSha: string;
    readonly workspace: string | undefined;
}

export interface ManifestStateInput {
    readonly manifestPath: string;
    readonly state: SubmissionState;
}

export interface RepositoryView {
    readonly directoryInput: string;
    readonly workspace: string;
    cleanup(): Promise<void>;
    verifyManifest(input: ManifestStateInput): Promise<void>;
}

export interface RepositoryViewOptions {
    readonly environment?: NodeJS.ProcessEnv;
    readonly runner?: GitRunner;
    readonly temporaryRoot?: string;
}

export interface GitOptions {
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
}

export type GitRunner = (arguments_: readonly string[], options: GitOptions) => Promise<string>;

interface TreeEntry {
    readonly mode: '100644' | '100755' | '120000' | '160000';
    readonly object: string;
    readonly path: string;
    readonly type: 'blob' | 'commit';
}

export async function createRepositoryView(
    input: RepositoryViewInput,
    options: RepositoryViewOptions = {},
): Promise<RepositoryView> {
    if (input.workspace === undefined || input.workspace.trim() === '') {
        throw repositoryError('GITHUB_WORKSPACE is not set. Run this action after actions/checkout.');
    }
    if (!validObjectId(input.expectedSha)) {
        throw repositoryError('GITHUB_SHA must be a full 40- or 64-character commit SHA.');
    }
    const sourceWorkspace = await repositoryRoot(input.workspace);
    const directoryInput = repositoryDirectoryInput(input.workspace, sourceWorkspace, input.directory);
    const runner = options.runner ?? runGit;
    const environment = gitEnvironment(options.environment ?? process.env);
    const gitOptions = { cwd: sourceWorkspace, environment };
    const head = (await git(
        runner,
        ['rev-parse', '--verify', 'HEAD^{commit}'],
        gitOptions,
        'Could not read the checked-out commit. Run this action after actions/checkout.',
    )).trim();
    if (!validObjectId(head) || head.toLowerCase() !== input.expectedSha.toLowerCase()) {
        throw repositoryError(
            'The checked-out HEAD does not equal GITHUB_SHA. Check out the triggering commit before submission.',
        );
    }
    const objectFormat = (await git(
        runner,
        ['rev-parse', '--show-object-format'],
        gitOptions,
        'Could not determine the repository object format.',
    )).trim();
    if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
        throw repositoryError('The repository uses an unsupported Git object format.');
    }
    const tree = parseTree(await git(
        runner,
        ['ls-tree', '-rz', '--full-tree', input.expectedSha],
        gitOptions,
        'Could not read the exact GITHUB_SHA tree.',
    ), objectFormat);

    const temporaryBase = options.temporaryRoot ?? options.environment?.RUNNER_TEMP ?? tmpdir();
    await mkdir(temporaryBase, { mode: 0o700, recursive: true });
    const root = await mkdtemp(join(temporaryBase, 'zolt-repository-view-'));
    const checks = join(root, 'objects.check');
    const objects = join(root, 'objects.batch');
    const requests = join(root, 'objects.request');
    const workspace = join(root, 'workspace');
    await mkdir(workspace, { mode: 0o700 });
    try {
        await materializeTree({ checks, objects, requests, sourceWorkspace, workspace }, tree, environment);
        await Promise.all([
            rm(checks, { force: true }),
            rm(objects, { force: true }),
            rm(requests, { force: true }),
        ]);
        await verifyTree(workspace, tree, objectFormat);
    } catch (error) {
        await removeView(root);
        throw error;
    }

    let cleaned = false;
    return {
        cleanup: async () => {
            if (cleaned) return;
            cleaned = true;
            await removeView(root);
        },
        directoryInput,
        verifyManifest: async (manifest) => {
            await verifyTree(workspace, tree, objectFormat);
            await verifyManifestState(manifest, {
                environment,
                runner,
                sourceWorkspace,
                tree,
            });
        },
        workspace,
    };
}

async function verifyManifestState(
    input: ManifestStateInput,
    context: {
        readonly environment: NodeJS.ProcessEnv;
        readonly runner: GitRunner;
        readonly sourceWorkspace: string;
        readonly tree: ReadonlyMap<string, TreeEntry>;
    },
): Promise<void> {
    const entry = context.tree.get(input.manifestPath);
    const options = { cwd: context.sourceWorkspace, environment: context.environment };
    const pathspec = `:(literal)${input.manifestPath}`;
    const indexState = await git(
        context.runner,
        ['ls-files', '-v', '-z', '--', pathspec],
        options,
        'Could not verify the selected manifest index state.',
    );
    const sourcePath = join(context.sourceWorkspace, ...input.manifestPath.split('/'));
    if (input.state === 'clear') {
        if (entry !== undefined) {
            throw repositoryError(
                'The manifest-path still exists at GITHUB_SHA. Delete or rename the lockfile before clearing its snapshot.',
            );
        }
        if (indexState !== '') {
            throw repositoryError(
                'The manifest-path exists in the checkout index. Commit its deletion before clearing its snapshot.',
            );
        }
        try {
            await lstat(sourcePath);
            throw repositoryError(
                'The manifest-path exists in the checkout. Remove it before clearing its snapshot.',
            );
        } catch (error) {
            if (error instanceof SubmitDependenciesError) throw error;
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw repositoryError('Could not verify that the cleared manifest is absent from the checkout.', error);
            }
        }
        return;
    }
    if (entry?.type !== 'blob' || entry.mode !== '100644' && entry.mode !== '100755') {
        throw repositoryError('The selected zolt.lock is not a regular tracked blob at GITHUB_SHA.');
    }
    if (indexState !== `H ${input.manifestPath}\0`) {
        throw repositoryError(
            'The selected zolt.lock uses assume-unchanged, skip-worktree, or another nonstandard index state.',
        );
    }
    await verifyRegularBlob(sourcePath, entry, 'The selected zolt.lock differs from GITHUB_SHA.');
}

async function repositoryRoot(workspace: string): Promise<string> {
    try {
        const root = await realpath(workspace);
        const info = await lstat(root);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('not a regular directory');
        return root;
    } catch (error) {
        throw repositoryError('GITHUB_WORKSPACE does not resolve to a readable repository directory.', error);
    }
}

function repositoryDirectoryInput(logicalWorkspace: string, sourceWorkspace: string, directory: string): string {
    const logicalRoot = resolve(logicalWorkspace);
    const candidate = isAbsolute(directory) ? resolve(directory) : resolve(logicalRoot, directory);
    let value = relative(logicalRoot, candidate);
    if (outside(value)) value = relative(sourceWorkspace, candidate);
    if (outside(value)) {
        throw repositoryError('directory resolves outside GITHUB_WORKSPACE. Choose a project within the repository.');
    }
    return value === '' ? '.' : value.split(sep).join('/');
}

function outside(value: string): boolean {
    return isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`);
}

function parseTree(value: string, objectFormat: 'sha1' | 'sha256'): ReadonlyMap<string, TreeEntry> {
    const result: Map<string, TreeEntry> = new Map();
    const caseFolded: Set<string> = new Set();
    const objectLength = objectFormat === 'sha1' ? 40 : 64;
    for (const record of value.split('\0')) {
        if (record === '') continue;
        const match = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]+)\t([\s\S]+)$/u.exec(record);
        if (match === null) throw repositoryError('Git returned an unsupported tree entry.');
        const [, modeValue, typeValue, object = '', path = ''] = match;
        if (object.length !== objectLength || !safeTreePath(path)) {
            throw repositoryError('Git returned an invalid tree entry.');
        }
        const mode = modeValue as TreeEntry['mode'];
        const type = typeValue as TreeEntry['type'];
        if (mode === '160000' ? type !== 'commit' : type !== 'blob') {
            throw repositoryError('Git returned an inconsistent tree entry.');
        }
        const folded = path.toLowerCase();
        if (caseFolded.has(folded)) throw repositoryError('The repository contains a case-colliding path.');
        caseFolded.add(folded);
        result.set(path, { mode, object, path, type });
        if (result.size > MAX_REPOSITORY_VIEW_ENTRIES) {
            throw repositoryError('The exact GITHUB_SHA tree exceeds the repository-view entry limit.');
        }
    }
    return result;
}

async function materializeTree(
    paths: {
        readonly checks: string;
        readonly objects: string;
        readonly requests: string;
        readonly sourceWorkspace: string;
        readonly workspace: string;
    },
    tree: ReadonlyMap<string, TreeEntry>,
    environment: NodeJS.ProcessEnv,
): Promise<void> {
    const blobs = [...tree.values()].filter((entry) => entry.type === 'blob');
    await writeFile(
        paths.requests,
        `${blobs.map((entry) => entry.object).join('\n')}${blobs.length === 0 ? '' : '\n'}`,
        { mode: 0o600 },
    );
    const gitOptions = { cwd: paths.sourceWorkspace, environment };
    await runGitBatch(
        ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
        paths.requests,
        paths.checks,
        gitOptions,
        'Could not inspect exact GITHUB_SHA blobs.',
    );
    const sizes = validateBatchChecks(await readFile(paths.checks, 'utf8'), blobs);
    await runGitBatch(
        ['cat-file', '--batch'],
        paths.requests,
        paths.objects,
        gitOptions,
        'Could not read exact GITHUB_SHA blobs.',
    );
    const objectInfo = await stat(paths.objects);
    if (!objectInfo.isFile() || objectInfo.size > MAX_REPOSITORY_VIEW_BYTES + blobs.length * 200) {
        throw repositoryError('The exact GITHUB_SHA blob batch exceeds repository-view limits.');
    }
    await materializeBatch(paths.objects, paths.workspace, blobs, sizes);
}

function validateBatchChecks(value: string, blobs: readonly TreeEntry[]): readonly number[] {
    const normalized = value.trimEnd();
    const lines = normalized === '' ? [] : normalized.split('\n');
    if (lines.length !== blobs.length) throw repositoryError('Git returned an incomplete blob-size batch.');
    const sizes: number[] = [];
    let total = 0;
    for (const [index, line] of lines.entries()) {
        const match = /^([0-9a-f]+) blob ([0-9]+)$/u.exec(line);
        const expected = blobs[index];
        if (match === null || expected === undefined || match[1] !== expected.object) {
            throw repositoryError('Git returned an invalid blob-size batch.');
        }
        const size = Number(match[2]);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_REPOSITORY_BLOB_BYTES) {
            throw repositoryError('The exact GITHUB_SHA tree contains an oversized blob.');
        }
        if (expected.mode === '120000' && size > MAX_SYMLINK_BYTES) {
            throw repositoryError('The exact GITHUB_SHA tree contains an oversized symbolic link.');
        }
        sizes.push(size);
        total += size;
        if (total > MAX_REPOSITORY_VIEW_BYTES) {
            throw repositoryError('The exact GITHUB_SHA tree exceeds the repository-view size limit.');
        }
    }
    return sizes;
}

async function materializeBatch(
    batchPath: string,
    workspace: string,
    blobs: readonly TreeEntry[],
    sizes: readonly number[],
): Promise<void> {
    const batch = await open(batchPath, 'r');
    let position = 0;
    try {
        for (const [index, entry] of blobs.entries()) {
            const size = sizes[index];
            if (size === undefined) throw repositoryError('Git returned an incomplete blob batch.');
            const header = await readLine(batch, position);
            position = header.next;
            if (header.value !== `${entry.object} blob ${size.toString()}`) {
                throw repositoryError('Git returned a mismatched blob batch.');
            }
            const destination = join(workspace, ...entry.path.split('/'));
            await mkdir(dirname(destination), { mode: 0o700, recursive: true });
            if (entry.mode === '120000') {
                const content = await readBytes(batch, position, size);
                const target = new TextDecoder('utf-8', { fatal: true }).decode(content);
                if (!safeLink(entry.path, target)) {
                    throw repositoryError('The exact GITHUB_SHA tree contains an unsafe symbolic link.');
                }
                await symlink(target, destination);
            } else if (size === 0) {
                await writeFile(destination, Buffer.alloc(0), { mode: entry.mode === '100755' ? 0o755 : 0o644 });
            } else {
                await pipeline(
                    createReadStream(batchPath, { end: position + size - 1, start: position }),
                    createWriteStream(destination, { mode: entry.mode === '100755' ? 0o755 : 0o644 }),
                );
                await chmod(destination, entry.mode === '100755' ? 0o755 : 0o644);
            }
            position += size;
            const separator = await readBytes(batch, position, 1);
            if (separator[0] !== 10) throw repositoryError('Git returned an invalid blob batch separator.');
            position += 1;
        }
    } catch (error) {
        if (error instanceof SubmitDependenciesError) throw error;
        throw repositoryError('Could not materialize the exact GITHUB_SHA blobs.', error);
    } finally {
        await batch.close();
    }
    const info = await stat(batchPath);
    if (position !== info.size) throw repositoryError('Git returned trailing data in the blob batch.');
}

async function readLine(file: FileHandle, position: number): Promise<{ readonly next: number; readonly value: string }> {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= 200) {
        const chunk = Buffer.alloc(201 - total);
        const result = await file.read(chunk, 0, chunk.length, position + total);
        if (result.bytesRead === 0) break;
        const newline = chunk.subarray(0, result.bytesRead).indexOf(10);
        if (newline !== -1) {
            chunks.push(chunk.subarray(0, newline));
            const value = Buffer.concat(chunks).toString('ascii');
            return { next: position + total + newline + 1, value };
        }
        chunks.push(chunk.subarray(0, result.bytesRead));
        total += result.bytesRead;
    }
    throw repositoryError('Git returned an invalid blob batch header.');
}

async function readBytes(file: FileHandle, position: number, length: number): Promise<Buffer> {
    const value = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
        const result = await file.read(value, offset, length - offset, position + offset);
        if (result.bytesRead === 0) throw repositoryError('Git returned a truncated blob batch.');
        offset += result.bytesRead;
    }
    return value;
}

async function runGitBatch(
    arguments_: readonly string[],
    input: string,
    output: string,
    options: GitOptions,
    message: string,
): Promise<void> {
    const [inputFile, outputFile] = await Promise.all([
        open(input, 'r'),
        open(output, 'w', 0o600),
    ]);
    try {
        await new Promise<void>((resolvePromise, reject) => {
            const child = spawn('git', [...arguments_], {
                cwd: options.cwd,
                env: options.environment,
                stdio: [inputFile.fd, outputFile.fd, 'ignore'],
                windowsHide: true,
            });
            child.once('error', reject);
            child.once('close', (code, signal) => {
                if (code === 0) resolvePromise();
                else reject(new Error(`git exited with code ${String(code)} and signal ${String(signal)}`));
            });
        });
    } catch (error) {
        throw repositoryError(message, error);
    } finally {
        await Promise.all([inputFile.close(), outputFile.close()]);
    }
}

function safeTreePath(path: string): boolean {
    if (path === '' || path.includes('\0') || posix.isAbsolute(path)) return false;
    const normalized = posix.normalize(path);
    return normalized === path && normalized !== '..' && !normalized.startsWith('../');
}

function safeLink(path: string, target: string): boolean {
    if (target === '' || target.includes('\0') || posix.isAbsolute(target)) return false;
    const resolved = posix.normalize(posix.join(posix.dirname(path), target));
    return resolved !== '..' && !resolved.startsWith('../');
}

async function verifyTree(
    workspace: string,
    tree: ReadonlyMap<string, TreeEntry>,
    objectFormat: 'sha1' | 'sha256',
): Promise<void> {
    await verifyViewShape(workspace, tree);
    for (const entry of tree.values()) {
        if (entry.type === 'commit') continue;
        const path = join(workspace, ...entry.path.split('/'));
        if (entry.mode === '120000') {
            await verifySymbolicLink(path, entry, objectFormat);
        } else {
            await verifyRegularBlob(path, entry, 'The private repository view changed after export.', objectFormat);
        }
    }
}

async function verifyViewShape(workspace: string, tree: ReadonlyMap<string, TreeEntry>): Promise<void> {
    const expectedFiles = new Set(
        [...tree.values()].filter((entry) => entry.type === 'blob').map((entry) => entry.path),
    );
    const expectedDirectories: Set<string> = new Set();
    for (const path of expectedFiles) {
        let parent = posix.dirname(path);
        while (parent !== '.') {
            expectedDirectories.add(parent);
            parent = posix.dirname(parent);
        }
    }
    const foundFiles: Set<string> = new Set();
    const pending = [''];
    let entries = 0;
    try {
        while (pending.length !== 0) {
            const directory = pending.pop();
            if (directory === undefined) break;
            const children = await readdir(
                directory === '' ? workspace : join(workspace, ...directory.split('/')),
                { withFileTypes: true },
            );
            for (const child of children) {
                const path = directory === '' ? child.name : posix.join(directory, child.name);
                entries += 1;
                if (entries > MAX_REPOSITORY_VIEW_ENTRIES + expectedDirectories.size) {
                    throw new Error('repository view contains too many entries');
                }
                if (child.isDirectory()) {
                    if (!expectedDirectories.has(path)) throw new Error('repository view contains an added directory');
                    pending.push(path);
                } else if (child.isFile() || child.isSymbolicLink()) {
                    if (!expectedFiles.has(path)) throw new Error('repository view contains an added file');
                    foundFiles.add(path);
                } else {
                    throw new Error('repository view contains a special file');
                }
            }
        }
        if (foundFiles.size !== expectedFiles.size) throw new Error('repository view is missing a tracked file');
    } catch (error) {
        throw repositoryError('The private repository view changed after export.', error);
    }
}

async function verifySymbolicLink(
    path: string,
    entry: TreeEntry,
    objectFormat: 'sha1' | 'sha256',
): Promise<void> {
    try {
        const info = await lstat(path);
        if (!info.isSymbolicLink()) throw new Error('not a symbolic link');
        const target = await readlink(path);
        if (!safeLink(entry.path, target) || gitBlobHash(Buffer.from(target), objectFormat) !== entry.object) {
            throw new Error('symbolic link differs');
        }
    } catch (error) {
        throw repositoryError('The private repository view contains a changed or unsafe symbolic link.', error);
    }
}

async function verifyRegularBlob(
    path: string,
    entry: TreeEntry,
    message: string,
    objectFormat?: 'sha1' | 'sha256',
): Promise<void> {
    try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('not a regular file');
        const executable = (info.mode & 0o111) !== 0;
        if (executable !== (entry.mode === '100755')) throw new Error('file mode differs');
        const format = objectFormat ?? (entry.object.length === 40 ? 'sha1' : 'sha256');
        if (await gitFileHash(path, info.size, format) !== entry.object) {
            throw new Error(`file bytes differ: ${entry.path}`);
        }
    } catch (error) {
        throw repositoryError(message, error);
    }
}

async function gitFileHash(path: string, size: number, objectFormat: 'sha1' | 'sha256'): Promise<string> {
    const hash = createHash(objectFormat);
    hash.update(`blob ${size.toString()}\0`);
    for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk);
    return hash.digest('hex');
}

function gitBlobHash(value: Buffer, objectFormat: 'sha1' | 'sha256'): string {
    return createHash(objectFormat)
        .update(`blob ${value.byteLength.toString()}\0`)
        .update(value)
        .digest('hex');
}

async function runGit(arguments_: readonly string[], options: GitOptions): Promise<string> {
    const result = await execute('git', [...arguments_], {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.environment,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        timeout: 120_000,
        windowsHide: true,
    });
    return result.stdout;
}

function validObjectId(value: string): boolean {
    return /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(value);
}

async function git(
    runner: GitRunner,
    arguments_: readonly string[],
    options: GitOptions,
    message: string,
): Promise<string> {
    try {
        return await runner(arguments_, options);
    } catch (error) {
        throw repositoryError(message, error);
    }
}

function gitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const allowed = ['LANG', 'LC_ALL', 'PATH', 'TMPDIR'];
    return {
        ...Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]])),
        GIT_ATTR_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
    };
}

async function removeView(root: string): Promise<void> {
    try {
        await rm(root, { force: true, recursive: true });
    } catch (error) {
        throw repositoryError('Could not remove the private repository view.', error);
    }
}

function repositoryError(message: string, cause?: unknown): SubmitDependenciesError {
    return new SubmitDependenciesError('ZOLT-GIT-001', message, cause === undefined ? undefined : { cause });
}
