import { PackageURL } from 'packageurl-js';

export interface PackageFixture {
    readonly classifier?: string;
    readonly dependencies?: readonly string[];
    readonly direct: boolean;
    readonly id: string;
    readonly members?: readonly string[];
    readonly scope: string;
    readonly type?: string;
    readonly version: string;
    readonly workspace?: string;
}

export function projectTree(packages: readonly PackageFixture[]): Record<string, unknown> {
    const treePackages = packages.map((pkg) => treePackage(pkg, 1));
    return {
        schemaVersion: 1,
        command: 'tree',
        project: { group: 'com.example', name: 'demo', version: '0.1.0', coordinate: 'com.example:demo:0.1.0' },
        packages: treePackages,
        roots: roots(treePackages),
        conflicts: [],
        policyEffects: [],
    };
}

export function workspaceTree(
    packages: readonly PackageFixture[],
    memberDependencies: Readonly<Record<string, readonly string[]>> = inferredMemberDependencies(packages),
): Record<string, unknown> {
    const treePackages = packages.map((pkg) => treePackage(pkg, 3));
    return {
        schemaVersion: 3,
        command: 'tree',
        mode: 'workspace',
        lockVersion: 5,
        workspace: {
            name: 'demo-workspace',
            members: [
                { path: 'apps/api', group: 'com.example', name: 'api', version: '0.1.0', type: 'jar',
                    dependencies: [...memberDependencies['apps/api'] ?? []].sort() },
                { path: 'modules/core', group: 'com.example', name: 'core', version: '0.1.0', type: 'jar',
                    dependencies: [...memberDependencies['modules/core'] ?? []].sort() },
            ],
        },
        packages: treePackages,
        roots: roots(treePackages),
    };
}

function inferredMemberDependencies(packages: readonly PackageFixture[]): Record<string, readonly string[]> {
    const dependencies: Record<string, string[]> = { 'apps/api': [], 'modules/core': [] };
    for (const pkg of packages) {
        if (!pkg.direct) continue;
        for (const member of pkg.members ?? []) dependencies[member]?.push(edge(pkg));
    }
    return dependencies;
}

function edge(pkg: PackageFixture): string {
    const type = pkg.type ?? 'jar';
    const variant = pkg.classifier === undefined ? type : `${type}|${pkg.classifier}`;
    return `${pkg.id}:${pkg.version}:${variant}:${pkg.scope}`;
}

export function purl(group: string, artifact: string, version: string, type = 'jar', classifier?: string): string {
    return new PackageURL('maven', group, artifact, version, {
        ...classifier === undefined ? {} : { classifier },
        type,
    }).toString();
}

export function component(packageUrl: string, ref = packageUrl): Record<string, unknown> {
    const parsed = PackageURL.fromString(packageUrl);
    return {
        type: 'library',
        'bom-ref': ref,
        group: parsed.namespace,
        name: parsed.name,
        version: parsed.version,
        purl: packageUrl,
        scope: 'required',
    };
}

export function projectBom(
    components: ReadonlyArray<Record<string, unknown>>,
    edges: Readonly<Record<string, readonly string[]>>,
    directRefs?: readonly string[],
): Record<string, unknown> {
    const root = purl('com.example', 'demo', '0.1.0');
    return bom(
        {
            type: 'application',
            'bom-ref': root,
            group: 'com.example',
            name: 'demo',
            version: '0.1.0',
            purl: root,
        },
        components,
        { [root]: directRefs ?? inferredDirectComponentRefs(components, edges), ...edges },
    );
}

export function workspaceBom(
    externals: ReadonlyArray<Record<string, unknown>>,
    edges: Readonly<Record<string, readonly string[]>>,
): Record<string, unknown> {
    const api = purl('com.example', 'api', '0.1.0');
    const core = purl('com.example', 'core', '0.1.0');
    const members = [component(api), component(core)];
    return bom(
        { type: 'application', 'bom-ref': 'workspace:demo-workspace', name: 'demo-workspace' },
        [...members, ...externals],
        {
            'workspace:demo-workspace': [api, core],
            [api]: [],
            [core]: [],
            ...edges,
        },
    );
}

function treePackage(pkg: PackageFixture, schema: 1 | 3): Record<string, unknown> {
    const type = pkg.type ?? 'jar';
    const variant = pkg.classifier === undefined ? type : `${type}|${pkg.classifier}`;
    const coordinate = `${pkg.id}:${pkg.version}${variant === 'jar' ? '' : `:${variant}`}`;
    return {
        id: pkg.id,
        version: pkg.version,
        coordinate,
        ...variant === 'jar' ? {} : { variant },
        scope: pkg.scope,
        direct: pkg.direct,
        ...schema === 3 ? { ...pkg.workspace === undefined ? {} : { workspace: pkg.workspace }, members: pkg.members ?? [] } : {},
        dependencies: [...pkg.dependencies ?? []].sort(),
        ...schema === 1 ? { policies: [] } : {},
    };
}

function roots(packages: ReadonlyArray<Record<string, unknown>>): string[] {
    return [...new Set(packages.filter((pkg) => pkg.direct === true).map((pkg) => String(pkg.coordinate)))].sort();
}

function inferredDirectComponentRefs(
    components: ReadonlyArray<Record<string, unknown>>,
    edges: Readonly<Record<string, readonly string[]>>,
): string[] {
    const children = new Set(Object.values(edges).flat());
    return components
        .map((value) => String(value['bom-ref']))
        .filter((ref) => !children.has(ref))
        .sort();
}

function bom(
    root: Record<string, unknown>,
    components: ReadonlyArray<Record<string, unknown>>,
    edges: Readonly<Record<string, readonly string[]>>,
): Record<string, unknown> {
    const dependencies = [String(root['bom-ref']), ...components.map((value) => String(value['bom-ref']))]
        .map((ref) => ({ ref, dependsOn: [...edges[ref] ?? []].sort() }));
    return {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        serialNumber: 'urn:uuid:00000000-0000-0000-0000-000000000000',
        version: 1,
        metadata: { tools: [{ name: 'zolt', version: 'test' }], component: root },
        components,
        dependencies,
    };
}
