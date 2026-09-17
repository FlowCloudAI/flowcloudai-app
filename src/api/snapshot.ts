import {command} from './base'

export interface SnapshotInfo {
  id: string
  message: string
  timestamp: number
}

export interface SnapshotBranchInfo {
    name: string
    head?: string | null
    isCurrent: boolean
    isActive: boolean
}

export interface SnapshotGraphBranch {
    name: string
    target?: string | null
    isCurrent: boolean
    isActive: boolean
}

export interface SnapshotGraphNode {
    id: string
    shortId: string
    message: string
    timestamp: number
    parents: string[]
    branchNames: string[]
    isCurrentHead: boolean
    isActiveTip: boolean
}

export interface SnapshotGraph {
    activeBranch: string
    branches: SnapshotGraphBranch[]
    nodes: SnapshotGraphNode[]
}

export interface AppendResult {
  projects: number
  categories: number
  entries: number
  tagSchemas: number
  relations: number
  links: number
  entryTypes: number
  ideaNotes: number
  preservedLegacyPageDocuments: number
}

export interface SnapshotRestoreReport {
  preservedLegacyPageDocuments: number
  warning: string | null
}

export const dbSnapshot = (projectId?: string | null) =>
    command<boolean>('db_snapshot', {projectId: projectId ?? null})

export const dbSnapshotWithMessage = (message: string, projectId?: string | null) =>
    command<boolean>('db_snapshot_with_message', {message, projectId: projectId ?? null})

export const dbGetActiveBranch = (projectId?: string | null) =>
    command<string>('db_get_active_branch', {projectId: projectId ?? null})

export const dbListBranches = (projectId?: string | null) =>
    command<SnapshotBranchInfo[]>('db_list_branches', {projectId: projectId ?? null})

export const dbCreateBranch = (
    branchName: string,
    fromRef?: string | null,
    projectId?: string | null,
) =>
    command<void>('db_create_branch', {branchName, fromRef: fromRef ?? null, projectId: projectId ?? null})

export const dbSwitchBranch = (branchName: string, projectId?: string | null) =>
    command<SnapshotRestoreReport>('db_switch_branch', {branchName, projectId: projectId ?? null})

export const dbListSnapshots = (projectId?: string | null) =>
  command<SnapshotInfo[]>('db_list_snapshots', {projectId: projectId ?? null})

export const dbListSnapshotsInBranch = (branchName: string, projectId?: string | null) =>
    command<SnapshotInfo[]>('db_list_snapshots_in_branch', {branchName, projectId: projectId ?? null})

export const dbGetSnapshotGraph = (projectId?: string | null) =>
    command<SnapshotGraph>('db_get_snapshot_graph', {projectId: projectId ?? null})

export const dbSnapshotToBranch = (branchName: string, message: string, projectId?: string | null) =>
    command<boolean>('db_snapshot_to_branch', {branchName, message, projectId: projectId ?? null})

export const dbRollbackTo = (snapshotId: string, projectId?: string | null) =>
  command<SnapshotRestoreReport>('db_rollback_to', { snapshotId, projectId: projectId ?? null })

export const dbAppendFrom = (snapshotId: string, projectId?: string | null) =>
  command<AppendResult>('db_append_from', { snapshotId, projectId: projectId ?? null })
