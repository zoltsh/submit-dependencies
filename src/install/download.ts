import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpClient } from '@actions/http-client';

import { MAX_ARCHIVE_BYTES, RELEASE_ASSET_ORIGIN } from '../constants';
import { SubmitDependenciesError } from '../errors';

export interface DownloadResult {
    readonly bytes: number;
    readonly sha256: string;
}

export interface HttpMessage extends AsyncIterable<unknown> {
    readonly headers: IncomingHttpHeaders;
    readonly statusCode?: number | undefined;
    destroy(): void;
}

export interface HttpClientLike {
    readonly dispose: () => void;
    readonly get: (url: string, headers?: Record<string, string>) => Promise<{ readonly message: HttpMessage }>;
}

export class ArchiveDownloader {
    readonly #client: HttpClientLike;

    constructor(client?: HttpClientLike) {
        this.#client = client ?? new HttpClient('zoltsh/submit-dependencies', [], {
            allowRedirectDowngrade: false,
            allowRedirects: true,
            allowRetries: true,
            keepAlive: true,
            maxRedirects: 5,
            maxRetries: 3,
            socketTimeout: 30_000,
        });
    }

    public async download(url: URL, destination: string): Promise<DownloadResult> {
        if (url.protocol !== 'https:' || !url.href.startsWith(`${RELEASE_ASSET_ORIGIN}/`)) {
            throw new SubmitDependenciesError('ZOLT-INSTALL-004', `Pinned Zolt asset URL is not an allowed immutable release URL: ${url.href}.`);
        }
        let message: HttpMessage;
        try {
            message = (await this.#client.get(url.href, {
                accept: 'application/octet-stream',
                'accept-encoding': 'identity',
            })).message;
        } catch (error) {
            throw new SubmitDependenciesError('ZOLT-INSTALL-005', `Could not request pinned Zolt archive ${url.href}.`, { cause: error });
        }
        try {
            assertResponse(message, MAX_ARCHIVE_BYTES);
        } catch (error) {
            message.destroy();
            throw error;
        }
        const digest = createHash('sha256');
        let bytes = 0;
        const meter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                bytes += chunk.length;
                if (bytes > MAX_ARCHIVE_BYTES) {
                    callback(new SubmitDependenciesError('ZOLT-INSTALL-006', `Zolt archive exceeds ${MAX_ARCHIVE_BYTES.toString()} bytes.`));
                    return;
                }
                digest.update(chunk);
                callback(null, chunk);
            },
        });
        const destinationState = { owned: false };
        const destinationStream = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
        destinationStream.once('open', () => {
            destinationState.owned = true;
        });
        try {
            await pipeline(message, meter, destinationStream);
        } catch (error) {
            if (destinationState.owned) await rm(destination, { force: true });
            if (error instanceof SubmitDependenciesError) throw error;
            throw new SubmitDependenciesError('ZOLT-INSTALL-007', 'Could not write the pinned Zolt archive.', { cause: error });
        }
        return { bytes, sha256: digest.digest('hex') };
    }

    public dispose(): void {
        this.#client.dispose();
    }
}

function assertResponse(message: HttpMessage, maximumBytes: number): void {
    if (message.statusCode !== 200) {
        throw new SubmitDependenciesError('ZOLT-INSTALL-008', `Zolt archive request returned HTTP ${message.statusCode?.toString() ?? 'unknown'}; expected 200.`);
    }
    const header = message.headers['content-length'];
    const value = Array.isArray(header) ? undefined : header;
    if (header !== undefined && (value === undefined || !/^\d+$/u.test(value) || Number(value) > maximumBytes)) {
        throw new SubmitDependenciesError('ZOLT-INSTALL-009', 'Zolt archive returned an invalid or excessive Content-Length header.');
    }
}
