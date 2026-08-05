import { chmod, link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { create } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

import { extractArchive, inspectArchive } from '../src/install/archive';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

async function fixture(name = 'zolt-test-linux-x64'): Promise<{ archive: string; root: string }> {
    const temporary = await mkdtemp(join(tmpdir(), 'submit-archive-test-'));
    roots.push(temporary);
    const source = join(temporary, 'source');
    await mkdir(join(source, name, 'bin'), { recursive: true });
    await writeFile(join(source, name, 'bin', 'zolt'), 'verified');
    await chmod(join(source, name, 'bin', 'zolt'), 0o755);
    const archive = join(temporary, 'zolt.tar.gz');
    await create({ cwd: source, file: archive, gzip: true }, [name]);
    return { archive, root: name };
}

describe('archive policy', () => {
    it('inspects and extracts the expected regular executable', async () => {
        const value = await fixture();
        await expect(inspectArchive(value.archive, value.root)).resolves.toBeUndefined();
        const binary = await extractArchive(value.archive, join(value.archive, '..', 'out'), value.root);
        await expect(readFile(binary, 'utf8')).resolves.toBe('verified');
    });

    it('rejects an unexpected root and missing executable', async () => {
        const value = await fixture('wrong-root');
        await expect(inspectArchive(value.archive, 'expected-root')).rejects.toThrow('ZOLT-INSTALL-010');
        await expect(inspectArchive(value.archive, 'wrong-root')).resolves.toBeUndefined();
    });

    it('rejects links and archives without the expected executable', async () => {
        const temporary = await mkdtemp(join(tmpdir(), 'submit-archive-security-test-'));
        roots.push(temporary);
        const root = 'zolt-security';
        const source = join(temporary, 'source');
        await mkdir(join(source, root, 'bin'), { recursive: true });
        await writeFile(join(source, root, 'bin', 'zolt'), 'verified');
        await symlink('/etc/passwd', join(source, root, 'escape'));
        const linked = join(temporary, 'linked.tar.gz');
        await create({ cwd: source, file: linked, gzip: true }, [root]);
        await expect(inspectArchive(linked, root)).rejects.toThrow('forbidden type');
        await expect(extractArchive(linked, join(temporary, 'linked-out'), root)).rejects.toThrow('forbidden type');

        await rm(join(source, root, 'escape'));
        await rm(join(source, root, 'bin', 'zolt'));
        await writeFile(join(source, root, 'LICENSE'), 'license');
        const missing = join(temporary, 'missing.tar.gz');
        await create({ cwd: source, file: missing, gzip: true }, [root]);
        await expect(inspectArchive(missing, root)).rejects.toThrow('is missing');
    });

    it('rejects hard links and unexpected executables', async () => {
        const temporary = await mkdtemp(join(tmpdir(), 'submit-archive-binary-test-'));
        roots.push(temporary);
        const root = 'zolt-security';
        const source = join(temporary, 'source');
        await mkdir(join(source, root, 'bin'), { recursive: true });
        const binary = join(source, root, 'bin', 'zolt');
        await writeFile(binary, 'verified');
        await chmod(binary, 0o755);
        const data = join(source, root, 'data');
        await writeFile(data, 'data');
        await link(data, join(source, root, 'hard-link'));
        const linked = join(temporary, 'hard-linked.tar.gz');
        await create({ cwd: source, file: linked, gzip: true }, [root]);
        await expect(inspectArchive(linked, root)).rejects.toThrow('forbidden type');

        await rm(join(source, root, 'hard-link'));
        const unexpected = join(source, root, 'bin', 'other');
        await writeFile(unexpected, 'unexpected');
        await chmod(unexpected, 0o755);
        const multiple = join(temporary, 'multiple.tar.gz');
        await create({ cwd: source, file: multiple, gzip: true }, [root]);
        await expect(inspectArchive(multiple, root)).rejects.toThrow('unexpected executable');
    });
});
