import { decodeCycloneDx, type BomDocument } from '../contracts/cyclonedx';
import { artifactIdentity, decodeTree, type TreeDocument, type TreePackage, type ZoltScope } from '../contracts/tree';
import { type ArtifactIdentity, artifactKey, graphError, parsePackageId, parseVariant, treeNodeKey } from './identity';
import { normalizeForGitHub, type PurlPolicy } from './purl-policy';

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
    readonly treeSchema: 1 | 2;
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
    readonly purl?: string;
}

interface Accumulator {
    readonly children: Set<string>;
    direct: boolean;
    runtime: boolean;
}

export function convert(input: ConvertInput): ConvertedManifest {
    validateManifestPath(input.manifestPath);
    const tree = decodeTree(input.tree);
    const bom = decodeCycloneDx(input.bom);
    const firstPartyRefs = firstPartyComponentRefs(tree, bom);
    const componentPurls = indexComponentPurls(bom, firstPartyRefs, input.purlPolicy);
    const mappings = mapTreePackages(tree, bom, firstPartyRefs, componentPurls.byArtifact);
    const accumulators = aggregateTree(tree, mappings);
    const treeGraph = treeDependencyGraph(tree, mappings, accumulators);
    const bomGraph = bomDependencyGraph(bom, firstPartyRefs, componentPurls.byRef);
    compareGraphs(treeGraph, bomGraph);

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
        name: input.manifestPath,
        sourceLocation: input.manifestPath,
        statistics,
        treeSchema: tree.schemaVersion,
    };
}

function firstPartyComponentRefs(tree: TreeDocument, bom: BomDocument): Set<string> {
    if (tree.mode === 'project') return new Set();
    const roots = bom.dependencies.get(bom.root.ref) ?? [];
    if (roots.length !== tree.workspaceMembers.length) {
        throw graphError(
            'ZOLT-GRAPH-008',
            `Workspace tree lists ${tree.workspaceMembers.length.toString()} members but CycloneDX identifies ${roots.length.toString()}.`,
        );
    }
    const refs: Set<string> = new Set();
    for (const ref of roots) {
        const component = bom.components.get(ref);
        if (component?.purl === undefined) {
            throw graphError('ZOLT-GRAPH-008', `Workspace member ${ref} has no canonical Maven PURL.`);
        }
        refs.add(ref);
    }
    return refs;
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
    bom: BomDocument,
    firstPartyRefs: ReadonlySet<string>,
    externalByArtifact: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, Mapping> {
    const firstPartyArtifacts: Set<string> = new Set();
    for (const ref of firstPartyRefs) {
        const key = bom.components.get(ref)?.artifactKey;
        if (key !== undefined) firstPartyArtifacts.add(key);
    }
    const mappings: Map<string, Mapping> = new Map();
    for (const pkg of tree.packages) {
        const key = artifactIdentity(pkg);
        if (firstPartyArtifacts.has(key)) {
            mappings.set(pkg.nodeKey, { firstParty: true });
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
        if (mapping.firstParty || mapping.purl === undefined) continue;
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
): ReadonlyMap<string, ReadonlySet<string>> {
    const nodes = new Map(tree.packages.map((pkg) => [pkg.nodeKey, pkg]));
    const graph: Map<string, Set<string>> = new Map([...accumulators.keys()].map((purl) => [purl, new Set<string>()]));
    for (const source of tree.packages) {
        const sourceMapping = mapValue(mappings, source.nodeKey, `Missing package mapping for ${source.coordinate}.`);
        for (const edge of source.dependencies) {
            const target = resolveEdge(edge, tree.packages, nodes);
            const targetMapping = mapValue(mappings, target.nodeKey, `Missing package mapping for ${target.coordinate}.`);
            if (sourceMapping.firstParty || sourceMapping.purl === undefined || targetMapping.firstParty) continue;
            if (targetMapping.purl === undefined || !accumulators.has(targetMapping.purl)) {
                throw graphError('ZOLT-GRAPH-009', `Dependency edge ${edge} does not target a submitted package.`);
            }
            if (sourceMapping.purl === targetMapping.purl) {
                throw graphError('ZOLT-GRAPH-010', `Dependency edge ${edge} becomes a self-edge after PURL normalization.`);
            }
            mapValue(graph, sourceMapping.purl, `Missing tree graph node for ${sourceMapping.purl}.`).add(targetMapping.purl);
            mapValue(accumulators, sourceMapping.purl, `Missing accumulator for ${sourceMapping.purl}.`).children.add(targetMapping.purl);
        }
    }
    return graph;
}

function resolveEdge(
    edge: string,
    packages: readonly TreePackage[],
    nodes: ReadonlyMap<string, TreePackage>,
): TreePackage {
    const parts = edge.split(':');
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
    firstPartyRefs: ReadonlySet<string>,
    purlsByRef: ReadonlyMap<string, string>,
): ReadonlyMap<string, ReadonlySet<string>> {
    const graph: Map<string, Set<string>> = new Map();
    for (const purl of purlsByRef.values()) graph.set(purl, new Set());
    for (const [sourceRef, targets] of bom.dependencies) {
        if (sourceRef === bom.root.ref || firstPartyRefs.has(sourceRef)) continue;
        const source = purlsByRef.get(sourceRef);
        if (source === undefined) throw graphError('ZOLT-GRAPH-005', `CycloneDX source ${sourceRef} has no submitted PURL.`);
        for (const targetRef of targets) {
            if (firstPartyRefs.has(targetRef)) continue;
            const target = purlsByRef.get(targetRef);
            if (target === undefined) throw graphError('ZOLT-GRAPH-005', `CycloneDX target ${targetRef} has no submitted PURL.`);
            if (source === target) throw graphError('ZOLT-GRAPH-010', `CycloneDX edge ${sourceRef} -> ${targetRef} collapses to a self-edge.`);
            graph.get(source)?.add(target);
        }
    }
    return graph;
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

function validateManifestPath(value: string): void {
    if (value === '' || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
        throw graphError('ZOLT-GRAPH-013', `Manifest path ${JSON.stringify(value)} is not repository-relative.`);
    }
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
