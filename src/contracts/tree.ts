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
    readonly workspace?: string;
}

export interface TreeWorkspaceMember {
    readonly artifact: ArtifactIdentity;
    readonly artifactKey: string;
    readonly dependencies: readonly string[];
    readonly path: string;
}

export interface TreeProject {
    readonly artifact: string;
    readonly group: string;
    readonly version: string;
}

export interface TreeDocument {
    readonly lockVersion?: number;
    readonly mode: 'project' | 'workspace';
    readonly packages: readonly TreePackage[];
    readonly project?: TreeProject;
    readonly schemaVersion: 1 | 3;
    readonly workspaceMembers: readonly TreeWorkspaceMember[];
}

export function decodeTree(value: unknown): TreeDocument {
    const root = object(value, 'tree');
    const schemaVersion = integer(root.schemaVersion, 'tree.schemaVersion');
    if (schemaVersion === 1) return decodeV1(root);
    if (schemaVersion === 3) return decodeV3(root);
    throw contractError(`The action understands tree schema 1 and 3, but Zolt emitted schema ${schemaVersion.toString()}. Upgrade zoltsh/submit-dependencies.`);
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
    validateRoots(root.roots, packages, 1);
    array(root.conflicts, 'tree.conflicts');
    array(root.policyEffects, 'tree.policyEffects');
    return {
        mode: 'project',
        packages,
        project: { artifact: name, group, version },
        schemaVersion: 1,
        workspaceMembers: [],
    };
}

function decodeV3(root: Record<string, unknown>): TreeDocument {
    assertKeys(root, 'tree schema 3',
        ['schemaVersion', 'command', 'mode', 'lockVersion', 'workspace', 'packages', 'roots']);
    requireLiteral(root.command, 'tree', 'tree.command');
    requireLiteral(root.mode, 'workspace', 'tree.mode');
    const lockVersion = integer(root.lockVersion, 'tree.lockVersion');
    if (lockVersion !== 7) {
        throw contractError(`Tree schema 3 lockVersion ${lockVersion.toString()} is unsupported; expected 7.`);
    }
    const workspace = object(root.workspace, 'tree.workspace');
    assertKeys(workspace, 'tree.workspace', ['name', 'members']);
    string(workspace.name, 'tree.workspace.name');
    const workspaceMembers = decodeWorkspaceMembers(workspace.members);
    const packages = decodePackages(root.packages, 3, workspaceMembers);
    validateRoots(root.roots, packages, 3);
    return { lockVersion, mode: 'workspace', packages, schemaVersion: 3, workspaceMembers };
}

function decodeWorkspaceMembers(value: unknown): TreeWorkspaceMember[] {
    const members = array(value, 'tree.workspace.members').map((item, index) => {
        const label = `tree.workspace.members[${index.toString()}]`;
        const member = object(item, label);
        assertKeys(member, label, ['path', 'group', 'name', 'version', 'type', 'dependencies']);
        const path = string(member.path, `${label}.path`);
        const id = parsePackageId(
            `${string(member.group, `${label}.group`)}:${string(member.name, `${label}.name`)}`,
            label,
        );
        const version = string(member.version, `${label}.version`);
        const variant = parseVariant(string(member.type, `${label}.type`), `${label}.type`);
        if (variant.classifier !== undefined) throw contractError(`${label}.type cannot include a classifier.`);
        const artifact: ArtifactIdentity = { ...id, type: variant.type, version };
        const dependencies = sortedUniqueStrings(member.dependencies, `${label}.dependencies`);
        return { artifact, artifactKey: artifactKey(artifact), dependencies, path };
    });
    const paths = members.map((member) => member.path);
    const sortedPaths = [...new Set(paths)].sort();
    if (sortedPaths.length !== paths.length || sortedPaths.some((path, index) => path !== paths[index])) {
        throw contractError('tree.workspace.members must be sorted by unique path.');
    }
    if (new Set(members.map((member) => member.artifactKey)).size !== members.length) {
        throw contractError('tree.workspace.members contains duplicate package identities.');
    }
    return members;
}

function decodePackages(
    value: unknown,
    schema: 1 | 3,
    workspaceMembers: readonly TreeWorkspaceMember[],
): TreePackage[] {
    const membersByPath = new Map(workspaceMembers.map((member) => [member.path, member]));
    const memberByArtifact = new Map(workspaceMembers.map((member) => [member.artifactKey, member]));
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
            schema === 1 ? ['variant'] : ['variant', 'workspace'],
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
        const members = schema === 3 ? sortedUniqueStrings(pkg.members, `${label}.members`) : [];
        for (const member of members) {
            if (!membersByPath.has(member)) throw contractError(`${label}.members contains unknown workspace member ${member}.`);
        }
        const workspace = schema === 3 && pkg.workspace !== undefined
            ? string(pkg.workspace, `${label}.workspace`)
            : undefined;
        if (workspace !== undefined) {
            const owner = membersByPath.get(workspace);
            if (owner === undefined) throw contractError(`${label}.workspace names unknown workspace member ${workspace}.`);
            if (owner.artifactKey !== artifactKey(artifact)) {
                throw contractError(`${label}.workspace package identity disagrees with member ${workspace}.`);
            }
        }
        const matchingMember = memberByArtifact.get(artifactKey(artifact));
        if (schema === 3 && matchingMember !== undefined && workspace !== matchingMember.path) {
            throw contractError(`${label} matches workspace member ${matchingMember.path} but does not identify that owner.`);
        }
        if (schema === 1) sortedUniqueStrings(pkg.policies, `${label}.policies`);
        return {
            artifact,
            coordinate,
            dependencies,
            direct: boolean(pkg.direct, `${label}.direct`),
            members,
            nodeKey,
            scope,
            ...workspace === undefined ? {} : { workspace },
        };
    });
}

function validateRoots(value: unknown, packages: readonly TreePackage[], schema: 1 | 3): void {
    const roots = schema === 1
        ? sortedStrings(value, 'tree.roots')
        : sortedUniqueStrings(value, 'tree.roots');
    const distinctRoots = [...new Set(roots)];
    const expected = [...new Set(packages.filter((pkg) => pkg.direct).map((pkg) => pkg.coordinate))].sort();
    if (distinctRoots.length !== expected.length || distinctRoots.some((root, index) => root !== expected[index])) {
        throw contractError('tree.roots does not equal the sorted distinct coordinates of direct packages.');
    }
}

function sortedStrings(value: unknown, label: string): string[] {
    const values = array(value, label).map((item, index) => string(item, `${label}[${index.toString()}]`));
    const sorted = [...values].sort();
    if (values.some((item, index) => item !== sorted[index])) throw contractError(`${label} must be sorted.`);
    return values;
}

function requireLiteral(value: unknown, expected: string, label: string): void {
    if (string(value, label) !== expected) throw contractError(`${label} must equal ${JSON.stringify(expected)}.`);
}

export function artifactIdentity(pkg: TreePackage): string {
    return artifactKey(pkg.artifact);
}
