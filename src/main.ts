import * as core from '@actions/core';

import { convert, type ConvertedManifest } from './converter/convert';
import { PRESERVE_ZOLT_PURLS } from './converter/purl-policy';
import { resolveExecutionContext } from './environment/context';
import { createRepositoryView, type RepositoryView } from './environment/repository-state';
import { SubmitDependenciesError } from './errors';
import { readGitHubSubmissionContext } from './github/context';
import { buildClearSnapshot, buildSnapshot } from './github/snapshot';
import { submitSnapshot } from './github/submit';
import { renderClearSummary, renderSummary } from './github/summary';
import { readInputs, type InputReader } from './inputs';
import { installZolt, type InstalledZolt } from './install/install-zolt';
import { resolveTarget } from './install/platform';
import { publicErrorMessage, publicText, registeredSecrets } from './public-output';
import { captureZoltOutputs } from './zolt/commands';
import { selectZoltProject } from './zolt/workspace';

export interface ActionCore extends InputReader {
    info(message: string): void;
    setFailed(message: string | Error): void;
    setOutput(name: string, value: unknown): void;
    setSecret(secret: string): void;
}

export interface ActionDependencies {
    readonly architecture?: string;
    readonly capture?: typeof captureZoltOutputs;
    readonly convertGraph?: typeof convert;
    readonly core?: ActionCore;
    readonly environment?: NodeJS.ProcessEnv;
    readonly install?: typeof installZolt;
    readonly now?: () => Date;
    readonly platform?: NodeJS.Platform;
    readonly prepareRepository?: typeof createRepositoryView;
    readonly resolveContext?: typeof resolveExecutionContext;
    readonly resolveSubmissionContext?: typeof readGitHubSubmissionContext;
    readonly selectProject?: typeof selectZoltProject;
    readonly submit?: typeof submitSnapshot;
    readonly writeSummary?: (markdown: string) => Promise<void>;
}

export async function runAction(dependencies: ActionDependencies = {}): Promise<void> {
    const actionCore = dependencies.core ?? core;
    const environment = dependencies.environment ?? process.env;
    let installed: InstalledZolt | undefined;
    let repositoryView: RepositoryView | undefined;
    let secrets = registeredSecrets(environment);
    const maskedSecrets: Set<string> = new Set();
    try {
        const inputs = readInputs(actionCore, (secret) => {
            actionCore.setSecret(secret);
            maskedSecrets.add(secret);
        });
        secrets = registeredSecrets(environment, [inputs.githubToken]);
        for (const secret of secrets) {
            if (!maskedSecrets.has(secret)) actionCore.setSecret(secret);
        }
        const submissionContext = (dependencies.resolveSubmissionContext ?? readGitHubSubmissionContext)(environment);
        const target = inputs.state === 'submit'
            ? resolveTarget(dependencies.platform ?? process.platform, dependencies.architecture ?? process.arch)
            : undefined;
        repositoryView = await (dependencies.prepareRepository ?? createRepositoryView)({
            directory: inputs.state === 'clear' ? '.' : inputs.directory,
            expectedSha: submissionContext.sha,
            workspace: environment.GITHUB_WORKSPACE,
        }, { environment });
        const context = await (dependencies.resolveContext ?? resolveExecutionContext)({
            ...inputs,
            directory: repositoryView.directoryInput,
        }, { ...environment, GITHUB_WORKSPACE: repositoryView.workspace });
        if (inputs.state === 'clear') {
            const manifestPath = inputs.manifestPath;
            if (manifestPath === undefined) {
                throw new SubmitDependenciesError('ZOLT-INPUT-009', 'manifest-path is required when state is clear.');
            }
            await repositoryView.verifyManifest({ manifestPath, state: inputs.state });
            actionCore.info(
                `Validated ${publicText(manifestPath, secrets)} tombstone on ${publicText(context.event.defaultBranch, secrets)}.`,
            );
            await repositoryView.verifyManifest({ manifestPath, state: inputs.state });
            const snapshot = buildClearSnapshot({
                context: submissionContext,
                manifestPath,
                scanned: (dependencies.now ?? (() => new Date()))(),
            });
            const submission = await (dependencies.submit ?? submitSnapshot)(
                inputs.githubToken,
                submissionContext,
                snapshot,
            );
            actionCore.setOutput('snapshot-id', submission.id);
            actionCore.setOutput('dependency-count', 0);
            actionCore.setOutput('zolt-version', '');
            await (dependencies.writeSummary ?? writeActionSummary)(renderClearSummary({
                manifestPath,
                snapshotId: submission.id,
            }));
            actionCore.info(
                `Cleared dependency snapshot ${submission.id.toString()} for ${publicText(manifestPath, secrets)}.`,
            );
            return;
        }
        if (target === undefined) throw new SubmitDependenciesError('ZOLT-PLATFORM-001', 'No release target was selected.');
        const selection = await (dependencies.selectProject ?? selectZoltProject)(context.repository, inputs.workspace);
        await repositoryView.verifyManifest({ manifestPath: selection.manifestPath, state: inputs.state });
        actionCore.info(
            `Validated ${publicText(context.repository.relativeDirectory, secrets)} on ${publicText(context.event.defaultBranch, secrets)}; installing pinned Zolt for ${target}.`,
        );
        installed = await (dependencies.install ?? installZolt)(target, { environment });
        actionCore.info(`Verified pinned Zolt ${installed.version} for ${installed.target}; SHA-256 ${installed.sha256}.`);
        const machine = await (dependencies.capture ?? captureZoltOutputs)(
            installed.binary,
            inputs,
            context.repository,
            { environment, selection },
        );
        if (machine.manifestPath !== selection.manifestPath || machine.mode !== selection.mode) {
            throw new SubmitDependenciesError(
                'ZOLT-GRAPH-015',
                'The verified project selection changed during Zolt analysis. No dependency snapshot was submitted.',
            );
        }
        const manifest = (dependencies.convertGraph ?? convert)({
            bom: machine.bom,
            manifestPath: machine.manifestPath,
            purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: machine.tree,
        });
        assertMode(machine.mode, manifest);
        await repositoryView.verifyManifest({ manifestPath: machine.manifestPath, state: inputs.state });
        const snapshot = buildSnapshot({
            context: submissionContext,
            manifest,
            scanned: (dependencies.now ?? (() => new Date()))(),
        });
        const submission = await (dependencies.submit ?? submitSnapshot)(inputs.githubToken, submissionContext, snapshot);
        actionCore.setOutput('snapshot-id', submission.id);
        actionCore.setOutput('dependency-count', manifest.statistics.externalDependencies);
        actionCore.setOutput('zolt-version', installed.version);
        await (dependencies.writeSummary ?? writeActionSummary)(renderSummary({
            manifest,
            snapshotId: submission.id,
            validateLock: inputs.validateLock,
            zoltVersion: installed.version,
        }));
        for (const warning of machine.warnings) actionCore.info(`Zolt warning: ${publicText(warning, secrets)}`);
        actionCore.info(
            `Submitted dependency snapshot ${submission.id.toString()} with ${manifest.statistics.externalDependencies.toString()} external dependencies.`,
        );
    } catch (error) {
        actionCore.setFailed(publicErrorMessage(error, secrets));
    } finally {
        if (installed !== undefined) {
            try {
                await installed.cleanup();
            } catch (error) {
                actionCore.setFailed(
                    `ZOLT-CLEANUP-001: Could not remove the private Zolt installation: ${publicErrorMessage(error, secrets)}.`,
                );
            }
        }
        if (repositoryView !== undefined) {
            try {
                await repositoryView.cleanup();
            } catch (error) {
                actionCore.setFailed(
                    `ZOLT-CLEANUP-003: Could not remove the private repository view: ${publicErrorMessage(error, secrets)}.`,
                );
            }
        }
    }
}

function assertMode(capturedMode: 'project' | 'workspace', manifest: ConvertedManifest): void {
    if (capturedMode !== manifest.mode) {
        throw new SubmitDependenciesError(
            'ZOLT-GRAPH-015',
            `Selected ${capturedMode} analysis but Zolt emitted a ${manifest.mode} tree. No dependency snapshot was submitted.`,
        );
    }
}

async function writeActionSummary(markdown: string): Promise<void> {
    core.summary.addRaw(markdown);
    await core.summary.write();
}
