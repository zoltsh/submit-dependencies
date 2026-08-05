import { array, assertKeys, boolean, contractError, integer, object, sortedUniqueStrings, string } from './decode';
import {
    artifactKey,
    type ArtifactIdentity,
    parsePackageId,
    parseVariant,
    treeNodeKey,
    variantKey,
} from '../converter/identity';

export const ZOLT_SCOPES = [
    'compile',
    'runtime',
    'dev',
    'test',
    'provided',
    'processor',
    'test-processor',
    'quarkus-deployment',
    'tool-spring-aot',
    'tool-openapi',
    'tool-protobuf',
    'tool-exec',
    'tool-coverage',
] as const;

export type ZoltScope = (typeof ZOLT_SCOPES)[number];

export interface TreePackage {
    readonly artifact: ArtifactIdentity;
    readonly coordinate: string;
    readonly dependencies: readonly string[];
    readonly direct: boolean;
    readonly members: readonly string[];
    readonly nodeKey: string;
    readonly scope: ZoltScope;
}

export interface TreeDocument {
    readonly lockVersion?: number;
    readonly mode: 'project' | 'workspace';
    readonly packages: readonly TreePackage[];
    readonly schemaVersion: 1 | 2;
    readonly workspaceMembers: readonly string[];
}

export function decodeTree(value: unknown): TreeDocument {
    const root = object(value, 'tree');
    const schemaVersion = integer(root.schemaVersion, 'tree.schemaVersion');
    if (schemaVersion === 1) return decodeV1(root);
    if (schemaVersion === 2) return decodeV2(root);
    throw contractError(`The action understands tree schema 1 and 2, but Zolt emitted schema ${schemaVersion.toString()}. Upgrade zoltsh/submit-dependencies.`);
}

function decodeV1(root: Record<string, unknown>): TreeDocument {
    assertKeys(root, 'tree schema 1',
        ['schemaVersion', 'command', 'project', 'packages', 'roots', 'conflicts', 'policyEffects']);
    requireLiteral(root.command, 'tree', 'tree.command');
    const project = object(root.project, 'tree.project');
    assertKeys(project, 'tree.project', ['group', 'name', 'version', 'coordinate']);
    const group = string(project.group, 'tree.project.group');
    const name = string(project.name, 'tree.project.name');
    const version = string(project.version, 'tree.project.version');
    if (string(project.coordinate, 'tree.project.coordinate') !== `${group}:${name}:${version}`) {
        throw contractError('tree.project.coordinate disagrees with its group, name, and version.');
    }
    const packages = decodePackages(root.packages, 1, []);
    validateRoots(root.roots, packages);
    array(root.conflicts, 'tree.conflicts');
    array(root.policyEffects, 'tree.policyEffects');
    return { mode: 'project', packages, schemaVersion: 1, workspaceMembers: [] };
}

function decodeV2(root: Record<string, unknown>): TreeDocument {
    assertKeys(root, 'tree schema 2',
        ['schemaVersion', 'command', 'mode', 'lockVersion', 'workspace', 'packages', 'roots']);
    requireLiteral(root.command, 'tree', 'tree.command');
    requireLiteral(root.mode, 'workspace', 'tree.mode');
    const lockVersion = integer(root.lockVersion, 'tree.lockVersion');
    if (lockVersion !== 5) {
        throw contractError(`Tree schema 2 lockVersion ${lockVersion.toString()} is unsupported; expected 5.`);
    }
    const workspace = object(root.workspace, 'tree.workspace');
    assertKeys(workspace, 'tree.workspace', ['name', 'members']);
    string(workspace.name, 'tree.workspace.name');
    const workspaceMembers = sortedUniqueStrings(workspace.members, 'tree.workspace.members');
    const packages = decodePackages(root.packages, 2, workspaceMembers);
    validateRoots(root.roots, packages);
    return { lockVersion, mode: 'workspace', packages, schemaVersion: 2, workspaceMembers };
}

function decodePackages(value: unknown, schema: 1 | 2, workspaceMembers: readonly string[]): TreePackage[] {
    const knownMembers = new Set(workspaceMembers);
    const nodes: Set<string> = new Set();
    return array(value, 'tree.packages').map((item, index) => {
        const label = `tree.packages[${index.toString()}]`;
        const pkg = object(item, label);
        assertKeys(
            pkg,
            label,
            schema === 1
                ? ['id', 'version', 'coordinate', 'scope', 'direct', 'dependencies', 'policies']
                : ['id', 'version', 'coordinate', 'scope', 'direct', 'members', 'dependencies'],
            ['variant'],
        );
        const id = parsePackageId(string(pkg.id, `${label}.id`), `${label}.id`);
        const version = string(pkg.version, `${label}.version`);
        if (version.includes(':')) throw contractError(`${label}.version cannot contain a colon.`);
        const rawVariant = pkg.variant === undefined ? undefined : string(pkg.variant, `${label}.variant`);
        const variant = parseVariant(rawVariant, `${label}.variant`);
        if (rawVariant === 'jar') throw contractError(`${label}.variant must omit the default jar variant.`);
        const artifact: ArtifactIdentity = variant.classifier === undefined
            ? { ...id, type: variant.type, version }
            : { ...id, classifier: variant.classifier, type: variant.type, version };
        const expectedCoordinate = `${id.group}:${id.artifact}:${version}${rawVariant === undefined ? '' : `:${variantKey(variant)}`}`;
        const coordinate = string(pkg.coordinate, `${label}.coordinate`);
        if (coordinate !== expectedCoordinate) throw contractError(`${label}.coordinate disagrees with its package identity.`);
        const scopeValue = string(pkg.scope, `${label}.scope`);
        if (!ZOLT_SCOPES.includes(scopeValue as ZoltScope)) throw contractError(`${label}.scope ${scopeValue} is unknown.`);
        const scope = scopeValue as ZoltScope;
        const nodeKey = treeNodeKey(artifact, scope);
        if (nodes.has(nodeKey)) throw contractError(`${label} duplicates a tree-node identity.`);
        nodes.add(nodeKey);
        const dependencies = sortedUniqueStrings(pkg.dependencies, `${label}.dependencies`);
        const members = schema === 2 ? sortedUniqueStrings(pkg.members, `${label}.members`) : [];
        for (const member of members) {
            if (!knownMembers.has(member)) throw contractError(`${label}.members contains unknown workspace member ${member}.`);
        }
        if (schema === 1) sortedUniqueStrings(pkg.policies, `${label}.policies`);
        return { artifact, coordinate, dependencies, direct: boolean(pkg.direct, `${label}.direct`), members, nodeKey, scope };
    });
}

function validateRoots(value: unknown, packages: readonly TreePackage[]): void {
    const roots = sortedUniqueStrings(value, 'tree.roots');
    const expected = [...new Set(packages.filter((pkg) => pkg.direct).map((pkg) => pkg.coordinate))].sort();
    if (roots.length !== expected.length || roots.some((root, index) => root !== expected[index])) {
        throw contractError('tree.roots does not equal the sorted distinct coordinates of direct packages.');
    }
}

function requireLiteral(value: unknown, expected: string, label: string): void {
    if (string(value, label) !== expected) throw contractError(`${label} must equal ${JSON.stringify(expected)}.`);
}

export function artifactIdentity(pkg: TreePackage): string {
    return artifactKey(pkg.artifact);
}
