export const RELEASE_TARGETS = ['linux-x64', 'linux-arm64', 'macos-x64', 'macos-arm64'] as const;

export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];
export type WorkspaceMode = 'auto' | 'true' | 'false';
export type SubmissionState = 'clear' | 'submit';

export interface ActionInputs {
    readonly directory: string;
    readonly githubToken: string;
    readonly manifestPath?: string;
    readonly state: SubmissionState;
    readonly validationEnv: readonly string[];
    readonly validateLock: boolean;
    readonly workspace: WorkspaceMode;
}

export interface ReleaseArtifact {
    readonly archive: string;
    readonly archiveUrl: string;
    readonly sha256: string;
}
