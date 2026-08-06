import { decodeCycloneDx, type BomDocument } from '../contracts/cyclonedx';
import {
    artifactIdentity,
    decodeTree,
    type TreeDocument,
    type TreePackage,
    type ZoltScope,
} from '../contracts/tree';
import { type ArtifactIdentity, artifactKey, graphError, parsePackageId, parseVariant, treeNodeKey } from './identity';
import { normalizeForGitHub, type PurlPolicy } from './purl-policy';
import { parseZoltManifestPath } from '../manifest-path';

export interface ConvertedDependency {
    readonly dependencies: readonly string[];
    readonly packageUrl: string;
    readonly relationship: 'direct' | 'indirect';
    readonly scope: 'runtime' | 'development';
}

export interface ConversionStatistics {
    readonly dependencyEdges: number;
    readonly development: number;
    readonly direct: number;
    readonly externalDependencies: number;
    readonly indirect: number;
    readonly runtime: number;
}

export interface ConvertedManifest {
    readonly dependencies: ReadonlyMap<string, ConvertedDependency>;
    readonly mode: 'project' | 'workspace';
    readonly name: string;
    readonly sourceLocation: string;
    readonly statistics: ConversionStatistics;
    readonly treeSchema: 1 | 3;
    readonly lockVersion?: number;
}

export interface ConvertInput {
    readonly bom: unknown;
    readonly manifestPath: string;
    readonly purlPolicy: PurlPolicy;
    readonly tree: unknown;
}

interface Mapping {
    readonly firstParty: boolean;
    readonly purl: string;
}

interface FirstPartyIndex {
    readonly purlByPath: ReadonlyMap<string, string>;
    readonly purlByRef: ReadonlyMap<string, string>;
    readonly refs: ReadonlySet<string>;
}

const ROOT_GRAPH_NODE = 'zolt:root';

interface Accumulator {
    readonly children: Set<string>;
    direct: boolean;
    runtime: boolean;
}

export function convert(input: ConvertInput): ConvertedManifest {
    const manifestPath = validateManifestPath(input.manifestPath);
    const tree = decodeTree(input.tree);
    const bom = decodeCycloneDx(input.bom);
    const firstParty = firstPartyComponents(tree, bom);
    const componentPurls = indexComponentPurls(bom, firstParty.refs, input.purlPolicy);
    const mappings = mapTreePackages(tree, firstParty, componentPurls.byArtifact);
    const accumulators = aggregateTree(tree, mappings);
    const treeGraph = treeDependencyGraph(tree, mappings, accumulators, firstParty);
    const bomGraph = bomDependencyGraph(bom, firstParty, componentPurls.byRef);
    compareGraphs(treeGraph, bomGraph);
    requireReachability(
        treeGraph,
        reachabilityRoots(tree, mappings, treeGraph, firstParty),
        accumulators,
    );

    const dependencies: Map<string, ConvertedDependency> = new Map();
    for (const purl of [...accumulators.keys()].sort()) {
        const value = mapValue(accumulators, purl, `Missing accumulator for ${purl}.`);
        dependencies.set(purl, {
            dependencies: [...value.children].sort(),
            packageUrl: purl,
            relationship: value.direct ? 'direct' : 'indirect',
            scope: value.runtime ? 'runtime' : 'development',
        });
    }
    const values = [...dependencies.values()];
    const statistics: ConversionStatistics = {
        dependencyEdges: values.reduce((total, dependency) => total + dependency.dependencies.length, 0),
        development: values.filter((dependency) => dependency.scope === 'development').length,
        direct: values.filter((dependency) => dependency.relationship === 'direct').length,
        externalDependencies: values.length,
        indirect: values.filter((dependency) => dependency.relationship === 'indirect').length,
        runtime: values.filter((dependency) => dependency.scope === 'runtime').length,
    };
    return {
        dependencies,
        ...tree.lockVersion === undefined ? {} : { lockVersion: tree.lockVersion },
        mode: tree.mode,
        name: manifestPath,
        sourceLocation: manifestPath,
        statistics,
        treeSchema: tree.schemaVersion,
    };
}

function firstPartyComponents(tree: TreeDocument, bom: BomDocument): FirstPartyIndex {
    if (tree.mode === 'project') {
        const project = tree.project;
        if (project === undefined || bom.root.artifact === undefined) {
            throw graphError('ZOLT-GRAPH-008', 'The project tree and CycloneDX root do not expose matching Maven identities.');
        }
        if (
            project.group !== bom.root.artifact.group
            || project.artifact !== bom.root.artifact.artifact
            || project.version !== bom.root.artifact.version
        ) {
            throw graphError('ZOLT-GRAPH-008', 'The project tree and CycloneDX root Maven identities disagree.');
        }
        return { purlByPath: new Map(), purlByRef: new Map(), refs: new Set() };
    }
    const roots = bom.dependencies.get(bom.root.ref) ?? [];
    if (roots.length !== tree.workspaceMembers.length) {
        throw graphError(
            'ZOLT-GRAPH-008',
            `Workspace tree lists ${tree.workspaceMembers.length.toString()} members but CycloneDX identifies ${roots.length.toString()}.`,
        );
    }
    const rootsByArtifact: Map<string, { readonly purl: string; readonly ref: string }> = new Map();
    for (const ref of roots) {
        const component = bom.components.get(ref);
        if (component?.purl === undefined || component.artifactKey === undefined) {
            throw graphError('ZOLT-GRAPH-008', `Workspace root child ${ref} has no canonical Maven PURL.`);
        }
        if (rootsByArtifact.has(component.artifactKey)) {
            throw graphError('ZOLT-GRAPH-008', `Workspace root identifies duplicate member package ${component.purl}.`);
        }
        rootsByArtifact.set(component.artifactKey, { purl: component.purl, ref });
    }
    const purlByPath: Map<string, string> = new Map();
    const purlByRef: Map<string, string> = new Map();
    const refs: Set<string> = new Set();
    for (const member of tree.workspaceMembers) {
        const component = rootsByArtifact.get(member.artifactKey);
        if (component === undefined) {
            throw graphError('ZOLT-GRAPH-008', `CycloneDX root does not identify workspace member ${member.path}.`);
        }
        purlByPath.set(member.path, component.purl);
        purlByRef.set(component.ref, component.purl);
        refs.add(component.ref);
    }
    if (refs.size !== roots.length) {
        throw graphError('ZOLT-GRAPH-008', 'CycloneDX root contains a component that is not a declared workspace member.');
    }
    return { purlByPath, purlByRef, refs };
}

function indexComponentPurls(
    bom: BomDocument,
    firstPartyRefs: ReadonlySet<string>,
    policy: PurlPolicy,
): { readonly byArtifact: ReadonlyMap<string, ReadonlySet<string>>; readonly byRef: ReadonlyMap<string, string> } {
    const byArtifact: Map<string, Set<string>> = new Map();
    const byRef: Map<string, string> = new Map();
    for (const component of bom.components.values()) {
        if (firstPartyRefs.has(component.ref)) continue;
        if (component.purl === undefined || component.artifactKey === undefined) {
            throw graphError('ZOLT-GRAPH-005', `External CycloneDX component ${component.ref} has no Maven PURL.`);
        }
        const purl = normalizeForGitHub(component.purl, policy);
        byRef.set(component.ref, purl);
        const candidates = byArtifact.get(component.artifactKey) ?? new Set<string>();
        candidates.add(purl);
        byArtifact.set(component.artifactKey, candidates);
    }
    return { byArtifact, byRef };
}

function mapTreePackages(
    tree: TreeDocument,
    firstParty: FirstPartyIndex,
    externalByArtifact: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, Mapping> {
    const mappings: Map<string, Mapping> = new Map();
    for (const pkg of tree.packages) {
        const key = artifactIdentity(pkg);
        if (pkg.workspace !== undefined) {
            const purl = firstParty.purlByPath.get(pkg.workspace);
            if (purl === undefined) throw graphError('ZOLT-GRAPH-008', `Tree package ${pkg.coordinate} has unknown owner ${pkg.workspace}.`);
            mappings.set(pkg.nodeKey, { firstParty: true, purl });
            continue;
        }
        const candidates = externalByArtifact.get(key) ?? new Set<string>();
        if (candidates.size === 0) {
            throw graphError(
                'ZOLT-GRAPH-006',
                `No CycloneDX PURL was found for ${pkg.coordinate}:${pkg.scope}. The tree and SBOM outputs disagree. No dependency snapshot was submitted.`,
            );
        }
        if (candidates.size !== 1) {
            throw graphError('ZOLT-GRAPH-007', `Tree package ${pkg.coordinate}:${pkg.scope} maps to multiple CycloneDX PURLs.`);
        }
        const purl = [...candidates].at(0);
        if (purl === undefined) throw graphError('ZOLT-GRAPH-007', `Tree package ${pkg.coordinate} has no PURL candidate.`);
        mappings.set(pkg.nodeKey, { firstParty: false, purl });
    }
    return mappings;
}

function aggregateTree(tree: TreeDocument, mappings: ReadonlyMap<string, Mapping>): Map<string, Accumulator> {
    const accumulators: Map<string, Accumulator> = new Map();
    for (const pkg of tree.packages) {
        const mapping = mapValue(mappings, pkg.nodeKey, `Missing package mapping for ${pkg.coordinate}.`);
        if (mapping.firstParty) continue;
        const accumulator = accumulators.get(mapping.purl) ?? { children: new Set<string>(), direct: false, runtime: false };
        accumulator.direct ||= pkg.direct;
        accumulator.runtime ||= runtimeScope(pkg.scope);
        accumulators.set(mapping.purl, accumulator);
    }
    return accumulators;
}

function treeDependencyGraph(
    tree: TreeDocument,
    mappings: ReadonlyMap<string, Mapping>,
    accumulators: ReadonlyMap<string, Accumulator>,
    firstParty: FirstPartyIndex,
): ReadonlyMap<string, ReadonlySet<string>> {
    const nodes = new Map(tree.packages.map((pkg) => [pkg.nodeKey, pkg]));
    const graph: Map<string, Set<string>> = new Map(
        [...new Set([ROOT_GRAPH_NODE, ...accumulators.keys(), ...firstParty.purlByPath.values()])]
            .map((purl) => [purl, new Set<string>()]),
    );
    if (tree.mode === 'workspace') {
        const root = mapValue(graph, ROOT_GRAPH_NODE, 'Missing workspace root graph node.');
        const rootedOccurrences: Set<string> = new Set();
        for (const memberPurl of firstParty.purlByPath.values()) root.add(memberPurl);
        for (const member of tree.workspaceMembers) {
            const memberPurl = mapValue(
                firstParty.purlByPath,
                member.path,
                `Missing member mapping for ${member.path}.`,
            );
            for (const edge of member.dependencies) {
                const target = resolveEdge(edge, tree.schemaVersion, tree.packages, nodes);
                const targetMapping = mapValue(mappings, target.nodeKey, `Missing package mapping for ${target.coordinate}.`);
                if (!target.members.includes(member.path)) {
                    throw graphError(
                        'ZOLT-GRAPH-017',
                        `Workspace member ${member.path} roots ${edge}, but that occurrence does not attribute itself to the member.`,
                    );
                }
                if (!target.direct && !injectedToolingScope(target.scope)) {
                    throw graphError(
                        'ZOLT-GRAPH-017',
                        `Workspace member ${member.path} roots indirect non-tooling occurrence ${edge}.`,
                    );
                }
                rootedOccurrences.add(target.nodeKey);
                if (memberPurl === targetMapping.purl) {
                    throw graphError('ZOLT-GRAPH-010', `Workspace member ${member.path} has a self-edge ${edge}.`);
                }
                mapValue(graph, memberPurl, `Missing tree graph node for ${memberPurl}.`).add(targetMapping.purl);
            }
        }
        for (const pkg of tree.packages) {
            if (pkg.direct && !rootedOccurrences.has(pkg.nodeKey)) {
                throw graphError(
                    'ZOLT-GRAPH-017',
                    `Direct workspace occurrence ${pkg.coordinate}:${pkg.scope} is absent from every member root.`,
                );
            }
        }
    }
    for (const source of tree.packages) {
        const sourceMapping = mapValue(mappings, source.nodeKey, `Missing package mapping for ${source.coordinate}.`);
        if (source.direct && tree.mode === 'project') {
            mapValue(graph, ROOT_GRAPH_NODE, 'Missing project root graph node.').add(sourceMapping.purl);
        }
        for (const edge of source.dependencies) {
            const target = resolveEdge(edge, tree.schemaVersion, tree.packages, nodes);
            const targetMapping = mapValue(mappings, target.nodeKey, `Missing package mapping for ${target.coordinate}.`);
            if (!targetMapping.firstParty && !accumulators.has(targetMapping.purl)) {
                throw graphError('ZOLT-GRAPH-009', `Dependency edge ${edge} does not target a submitted package.`);
            }
            if (sourceMapping.purl === targetMapping.purl) {
                throw graphError('ZOLT-GRAPH-010', `Dependency edge ${edge} becomes a self-edge after PURL normalization.`);
            }
            mapValue(graph, sourceMapping.purl, `Missing tree graph node for ${sourceMapping.purl}.`).add(targetMapping.purl);
            if (!sourceMapping.firstParty && !targetMapping.firstParty) {
                mapValue(accumulators, sourceMapping.purl, `Missing accumulator for ${sourceMapping.purl}.`)
                    .children.add(targetMapping.purl);
            }
        }
    }
    return graph;
}

function resolveEdge(
    edge: string,
    schemaVersion: 1 | 3,
    packages: readonly TreePackage[],
    nodes: ReadonlyMap<string, TreePackage>,
): TreePackage {
    const parts = edge.split(':');
    if (schemaVersion === 3 && parts.length !== 5) {
        throw graphError('ZOLT-GRAPH-011', `Schema-3 dependency edge ${edge} must contain exactly five fields.`);
    }
    if (parts.length < 3 || parts.length > 5 || parts.some((part) => part === '')) {
        throw graphError('ZOLT-GRAPH-011', `Malformed dependency edge ${edge}.`);
    }
    const group = edgePart(parts, 0, edge);
    const artifactName = edgePart(parts, 1, edge);
    const id = parsePackageId(`${group}:${artifactName}`, `dependency edge ${edge}`);
    const version = edgePart(parts, 2, edge);
    const variant = parseVariant(parts.length >= 4 ? edgePart(parts, 3, edge) : undefined, `dependency edge ${edge}`);
    const artifact: ArtifactIdentity = variant.classifier === undefined
        ? { ...id, type: variant.type, version }
        : { ...id, classifier: variant.classifier, type: variant.type, version };
    if (parts.length === 5) {
        const exact = nodes.get(treeNodeKey(artifact, edgePart(parts, 4, edge)));
        if (exact === undefined) throw graphError('ZOLT-GRAPH-009', `Dependency edge ${edge} is dangling.`);
        return exact;
    }
    const key = artifactKey(artifact);
    const candidates = packages.filter((pkg) => artifactIdentity(pkg) === key);
    if (candidates.length !== 1) {
        throw graphError('ZOLT-GRAPH-011', `Legacy dependency edge ${edge} is ${candidates.length === 0 ? 'dangling' : 'ambiguous'}.`);
    }
    const candidate = candidates.at(0);
    if (candidate === undefined) throw graphError('ZOLT-GRAPH-011', `Legacy dependency edge ${edge} is dangling.`);
    return candidate;
}

function bomDependencyGraph(
    bom: BomDocument,
    firstParty: FirstPartyIndex,
    purlsByRef: ReadonlyMap<string, string>,
): ReadonlyMap<string, ReadonlySet<string>> {
    const graph: Map<string, Set<string>> = new Map();
    for (const purl of [ROOT_GRAPH_NODE, ...purlsByRef.values(), ...firstParty.purlByPath.values()]) {
        graph.set(purl, new Set());
    }
    const allPurls = new Map([[bom.root.ref, ROOT_GRAPH_NODE], ...purlsByRef, ...firstParty.purlByRef]);
    for (const [sourceRef, targets] of bom.dependencies) {
        const source = allPurls.get(sourceRef);
        if (source === undefined) throw graphError('ZOLT-GRAPH-005', `CycloneDX source ${sourceRef} has no submitted PURL.`);
        for (const targetRef of targets) {
            const target = allPurls.get(targetRef);
            if (target === undefined) throw graphError('ZOLT-GRAPH-005', `CycloneDX target ${targetRef} has no submitted PURL.`);
            if (source === target) throw graphError('ZOLT-GRAPH-010', `CycloneDX edge ${sourceRef} -> ${targetRef} collapses to a self-edge.`);
            graph.get(source)?.add(target);
        }
    }
    return graph;
}

function reachabilityRoots(
    tree: TreeDocument,
    mappings: ReadonlyMap<string, Mapping>,
    graph: ReadonlyMap<string, ReadonlySet<string>>,
    firstParty: FirstPartyIndex,
): Iterable<string> {
    if (tree.mode === 'workspace') return firstParty.purlByPath.values();
    const incoming = new Set([...graph.values()].flatMap((targets) => [...targets]));
    const roots = new Set([ROOT_GRAPH_NODE]);
    for (const pkg of tree.packages) {
        const mapping = mapValue(mappings, pkg.nodeKey, `Missing package mapping for ${pkg.coordinate}.`);
        if (!incoming.has(mapping.purl) && legacyInjectedToolingRoot(pkg)) roots.add(mapping.purl);
    }
    return roots;
}

function legacyInjectedToolingRoot(pkg: TreePackage): boolean {
    if (pkg.direct) return false;
    if (injectedToolingScope(pkg.scope)) return true;
    return pkg.scope === 'test'
        && pkg.artifact.group === 'org.junit.platform'
        && pkg.artifact.artifact === 'junit-platform-console'
        && pkg.artifact.type === 'jar'
        && pkg.artifact.classifier === undefined;
}

function requireReachability(
    graph: ReadonlyMap<string, ReadonlySet<string>>,
    roots: Iterable<string>,
    externals: ReadonlyMap<string, Accumulator>,
): void {
    const reached = new Set(roots);
    const pending = [...reached];
    while (pending.length !== 0) {
        const source = pending.shift();
        if (source === undefined) break;
        for (const target of graph.get(source) ?? []) {
            if (!reached.has(target)) {
                reached.add(target);
                pending.push(target);
            }
        }
    }
    const unreachable = [...externals.keys()].filter((purl) => !reached.has(purl)).sort();
    if (unreachable.length !== 0) {
        throw graphError(
            'ZOLT-GRAPH-016',
            `Dependency graph contains packages unreachable from every accepted root: ${unreachable.join(', ')}. No dependency snapshot was submitted.`,
        );
    }
}

function compareGraphs(
    tree: ReadonlyMap<string, ReadonlySet<string>>,
    bom: ReadonlyMap<string, ReadonlySet<string>>,
): void {
    const onlyTree: string[] = [];
    const onlyBom: string[] = [];
    for (const source of new Set([...tree.keys(), ...bom.keys()])) {
        const treeChildren = tree.get(source) ?? new Set();
        const bomChildren = bom.get(source) ?? new Set();
        if (!tree.has(source)) onlyBom.push(`${source} (package)`);
        if (!bom.has(source)) onlyTree.push(`${source} (package)`);
        for (const child of treeChildren) if (!bomChildren.has(child)) onlyTree.push(`${source} -> ${child}`);
        for (const child of bomChildren) if (!treeChildren.has(child)) onlyBom.push(`${source} -> ${child}`);
    }
    if (onlyTree.length !== 0 || onlyBom.length !== 0) {
        throw graphError(
            'ZOLT-GRAPH-012',
            `Zolt tree and CycloneDX disagree. Only in tree: ${onlyTree.sort().join(', ') || '(none)'}. Only in CycloneDX: ${onlyBom.sort().join(', ') || '(none)'}. No dependency snapshot was submitted.`,
        );
    }
}

function runtimeScope(scope: ZoltScope): boolean {
    return scope === 'compile' || scope === 'runtime' || scope === 'provided';
}

function injectedToolingScope(scope: ZoltScope): boolean {
    return scope === 'tool-coverage'
        || scope === 'tool-exec'
        || scope === 'tool-openapi'
        || scope === 'tool-protobuf'
        || scope === 'tool-spring-aot';
}

function validateManifestPath(value: string): string {
    const manifestPath = parseZoltManifestPath(value);
    if (manifestPath === undefined) {
        throw graphError('ZOLT-GRAPH-013', `Manifest path ${JSON.stringify(value)} is not repository-relative.`);
    }
    return manifestPath;
}

function edgePart(parts: readonly string[], index: number, edge: string): string {
    const value = parts.at(index);
    if (value === undefined) throw graphError('ZOLT-GRAPH-011', `Malformed dependency edge ${edge}.`);
    return value;
}

function mapValue<K, V>(values: ReadonlyMap<K, V>, key: K, message: string): V {
    const value = values.get(key);
    if (value === undefined) throw graphError('ZOLT-GRAPH-014', message);
    return value;
}
