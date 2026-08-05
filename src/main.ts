import * as core from '@actions/core';

import { convert, type ConvertedManifest } from './converter/convert';
import { PRESERVE_ZOLT_PURLS } from './converter/purl-policy';
import { resolveExecutionContext } from './environment/context';
import { errorMessage, SubmitDependenciesError } from './errors';
import { readGitHubSubmissionContext } from './github/context';
import { buildSnapshot } from './github/snapshot';
import { submitSnapshot } from './github/submit';
import { renderSummary } from './github/summary';
import { readInputs, type InputReader } from './inputs';
import { installZolt, type InstalledZolt } from './install/install-zolt';
import { resolveTarget } from './install/platform';
import { captureZoltOutputs } from './zolt/commands';

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
    readonly resolveContext?: typeof resolveExecutionContext;
    readonly resolveSubmissionContext?: typeof readGitHubSubmissionContext;
    readonly submit?: typeof submitSnapshot;
    readonly writeSummary?: (markdown: string) => Promise<void>;
}

export async function runAction(dependencies: ActionDependencies = {}): Promise<void> {
    const actionCore = dependencies.core ?? core;
    const environment = dependencies.environment ?? process.env;
    let installed: InstalledZolt | undefined;
    let token: string | undefined;
    try {
        const inputs = readInputs(actionCore, (secret) => {
            actionCore.setSecret(secret);
        });
        token = inputs.githubToken;
        const [context, submissionContext] = await Promise.all([
            (dependencies.resolveContext ?? resolveExecutionContext)(inputs, environment),
            Promise.resolve((dependencies.resolveSubmissionContext ?? readGitHubSubmissionContext)(environment)),
        ]);
        const target = resolveTarget(dependencies.platform ?? process.platform, dependencies.architecture ?? process.arch);
        actionCore.info(`Validated ${context.repository.relativeDirectory} on ${context.event.defaultBranch}; installing pinned Zolt for ${target}.`);
        installed = await (dependencies.install ?? installZolt)(target);
        actionCore.info(`Verified pinned Zolt ${installed.version} for ${installed.target}; SHA-256 ${installed.sha256}.`);
        const machine = await (dependencies.capture ?? captureZoltOutputs)(
            installed.binary,
            inputs,
            context.repository,
            { environment },
        );
        const manifest = (dependencies.convertGraph ?? convert)({
            bom: machine.bom,
            manifestPath: machine.manifestPath,
            purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: machine.tree,
        });
        assertMode(machine.mode, manifest);
        const snapshot = buildSnapshot({
            context: submissionContext,
            manifest,
            scanned: (dependencies.now ?? (() => new Date()))(),
            zoltVersion: installed.version,
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
        for (const warning of machine.warnings) actionCore.info(`Zolt warning: ${warning}`);
        actionCore.info(
            `Submitted dependency snapshot ${submission.id.toString()} with ${manifest.statistics.externalDependencies.toString()} external dependencies.`,
        );
    } catch (error) {
        actionCore.setFailed(redact(errorMessage(error, environment.ACTIONS_STEP_DEBUG === 'true'), token));
    } finally {
        if (installed !== undefined) {
            try {
                await installed.cleanup();
            } catch (error) {
                actionCore.setFailed(`ZOLT-CLEANUP-001: Could not remove the private Zolt installation: ${errorMessage(error)}.`);
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

function redact(message: string, token: string | undefined): string {
    return token === undefined || token === '' ? message : message.split(token).join('***');
}
