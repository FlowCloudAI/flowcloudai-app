import {command} from './base'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppLogSnapshot {
    path: string
    content: string
    truncated: boolean
}

export interface Project {
    id: string
    name: string
    description?: string | null
    cover_image?: string | null
    cover_path?: string | null
    created_at?: string | null
    updated_at?: string | null

}

export interface Category {
    id: string
    project_id: string
    parent_id?: string | null
    name: string
    sort_order: number
    created_at: string
    updated_at: string

}

export interface EntryTag {
    schema_id?: string
    name?: string
    value: string | number | boolean | null

}

export interface FCImage {
    path?: string | null
    url?: string | null
    alt?: string | null
    caption?: string | null
    is_cover?: boolean

}

export interface Entry {
    id: string
    project_id: string
    category_id?: string | null
    title: string
    summary?: string | null
    content?: string | null
    type?: string | null
    tags?: EntryTag[] | null
    images?: FCImage[] | null
    created_at?: string | null
    updated_at?: string | null
}

export interface EntryBrief {
    id: string
    project_id: string
    category_id?: string | null
    title: string
    summary?: string | null
    type?: string | null
    cover?: string | null
    updated_at: string

}

export interface ProjectTimelineEvent {
    id: string
    title: string
    startTime: number
    endTime?: number | null
    description?: string | null
    parentId?: string | null
    entryType?: string | null
    categoryId?: string | null

}

export interface ProjectEntryTypeStat {
    entryType?: string | null
    count: number
    wordCount: number
}

export interface ProjectCategoryStat {
    categoryId?: string | null
    count: number
    wordCount: number
}

export interface ProjectGovernanceCheck {
    label: string
    passed: boolean
}

export interface ProjectGovernanceDimension {
    key: string
    label: string
    score: number
    weight: number
}

export interface ProjectGovernanceScore {
    score: number
    checks: ProjectGovernanceCheck[]
    dimensions: ProjectGovernanceDimension[]
}

export interface ProjectStats {
    entryCount: number
    imageCount: number
    wordCount: number
    relationCount: number
    internalLinkCount: number
    entriesByType: ProjectEntryTypeStat[]
    entriesByCategory: ProjectCategoryStat[]
    uncategorizedEntryCount: number
    emptyContentEntryCount: number
    shortContentEntryCount: number
    missingSummaryEntryCount: number
    isolatedEntryCount: number
    createdLast7Days: number
    updatedLast7Days: number
    governanceScore: ProjectGovernanceScore
}

export interface CoverThumbnailMigrationSummary {
    scanned: number
    generated: number
    skipped: number
    failed: number
}

export interface FcworldExportResult {
    outputPath: string
    packageId: string
    projectId: string
    assetCount: number
    mapCount: number
    historyFileCount: number
    hasHistory: boolean
    fileSize: number
    warnings: string[]
}

export interface FcworldImportRows {
    projects: number
    categories: number
    entries: number
    tagSchemas: number
    entryTypes: number
    relations: number
    links: number
    ideaNotes: number
}

export interface FcworldImportResult {
    inputPath: string
    packageId: string
    sourceProjectId: string
    projectId: string
    projectName: string
    assetCount: number
    mapCount: number
    historyFileCount: number
    hasHistory: boolean
    fileSize: number
    importedRows: FcworldImportRows
    skippedComponentDefinitions: number
    warnings: string[]
}

export interface FcworldImportDuplicateProject {
    projectId: string
    projectName: string
}

export interface FcworldImportPreview {
    inputPath: string
    packageId: string
    sourceProjectId: string
    projectName: string
    suggestedName: string
    duplicateProject: FcworldImportDuplicateProject | null
    assetCount: number
    mapCount: number
    historyFileCount: number
    hasHistory: boolean
    fileSize: number
}

export interface FcworldImportOptions {
    mode: 'rename' | 'overwrite'
    projectName?: string | null
    overwriteProjectId?: string | null
}

export type FcworldProgressKind = 'import' | 'export'
export type FcworldProgressStatus = 'running' | 'done' | 'error'

export interface FcworldProgressEvent {
    operationId: string
    kind: FcworldProgressKind
    phase: string
    message: string
    current: number
    total: number
    percent: number
    status: FcworldProgressStatus
}

export const FCWORLD_PROGRESS_EVENT = 'fcworld:progress'

export interface ProjectTimelineData {
    events: ProjectTimelineEvent[]
    yearStart?: number | null
    yearEnd?: number | null
    scannedEntryCount: number
    matchedEntryCount: number

}

export interface TagSchema {
    id: string
    project_id: string
    name: string
    description?: string | null
    type: string
    target: string[]
    default_val?: string | null
    range_min?: number | null
    range_max?: number | null
    sort_order?: number | null

}

export type RelationDirection = 'one_way' | 'two_way'

export interface EntryLink {
    id: string
    project_id: string
    a_id: string
    b_id: string

}

export interface EntryRelation {
    id: string
    project_id: string
    a_id: string
    b_id: string
    relation: RelationDirection
    content: string
    created_at: string
    updated_at: string

}

export interface CreateProjectInput {
    name: string
    description?: string | null
    coverPath?: string | null
    createDefaultTemplate?: boolean
}

export interface UpdateProjectInput {
    id: string
    name?: string | null
    description?: string | null
    coverPath?: string | null
}

export interface CreateCategoryInput {
    projectId: string
    parentId?: string | null
    name: string
    sortOrder?: number | null
}

export interface UpdateCategoryInput {
    id: string
    projectId: string
    parentId?: string | null
    name?: string | null
    sortOrder?: number | null
}

export interface CategoryCascadeDeleteResult {
    deletedEntries: number
    deletedCategories: number
}

export interface ListEntriesParams {
    projectId: string
    categoryId?: string | null
    entryType?: string | null
    limit: number
    offset: number
}

export interface SearchEntriesParams {
    projectId: string
    query: string
    categoryId?: string | null
    entryType?: string | null
    limit: number
}

export interface CountEntriesParams {
    projectId: string
    categoryId?: string | null
    entryType?: string | null
}

export interface CreateEntryInput {
    projectId: string
    categoryId?: string | null
    title: string
    summary?: string | null
    content?: string | null
    type?: string | null
    tags?: EntryTag[] | null
    images?: FCImage[] | null
}

export interface UpdateEntryInput {
    id: string
    projectId?: string
    categoryId?: string | null
    title?: string | null
    summary?: string | null
    content?: string | null
    type?: string | null
    tags?: EntryTag[] | null
    images?: FCImage[] | null
}

export interface SaveEntryRelationDraftInput {
    id?: string | null
    otherEntryId?: string | null
    direction: 'incoming' | 'outgoing' | 'two_way'
    content?: string | null
}

export interface SaveEntryBundleInput extends UpdateEntryInput {
    projectId: string
    relationDrafts: SaveEntryRelationDraftInput[]
    sourceId?: string
}

export interface SaveEntryBundleResponse {
    entry: Entry
    outgoingLinks: EntryLink[]
    incomingLinks: EntryLink[]
    relations: EntryRelation[]
}

export interface CreateTagSchemaInput {
    projectId: string
    name: string
    description?: string | null
    type: string
    target: string[]
    defaultVal?: string | null
    rangeMin?: number | null
    rangeMax?: number | null
    sortOrder?: number | null
}

export interface UpdateTagSchemaInput extends CreateTagSchemaInput {
    id: string
}

export interface CreateEntryLinkInput {
    projectId: string
    aId: string
    bId: string
}

export interface CreateRelationInput {
    projectId: string
    aId: string
    bId: string
    relation: RelationDirection
    content: string
}

export interface UpdateRelationInput {
    id: string
    projectId?: string
    relation?: RelationDirection | null
    content?: string | null
}

export interface RelationGraphNode {
    id: string
    label: string
    title: string
    summary: string
    coverImage?: string | null
}

export interface RelationGraphEdge {
    id: string
    source: string
    target: string
    label: string
    kind: RelationDirection
}

export interface RelationGraphData {
    nodes: RelationGraphNode[]
    edges: RelationGraphEdge[]
}

export const log_message = (level: LogLevel, message: string, source?: string) =>
    command<void>('log_message', {level, message, source})

export const read_app_log = () =>
    command<AppLogSnapshot>('read_app_log')

export const open_in_file_manager = (path: string) =>
    command<void>('open_in_file_manager', {path})

export const show_main_window = () => command<string>('show_main_window')

export const showWindow = () => show_main_window().then(() => undefined)

export const exit_app = () => command<void>('exit_app')

const normalizeProject = (project: Project): Project => ({
    ...project,
    cover_path: project.cover_path ?? project.cover_image ?? null,
})

export const db_create_project = ({name, description, coverPath, createDefaultTemplate}: CreateProjectInput) =>
    command<Project>('db_create_project', {
        name,
        description,
        coverImage: coverPath,
        createDefaultTemplate,
    }).then(normalizeProject)

export const db_get_project = (id: string) => command<Project>('db_get_project', {id}).then(normalizeProject)

export const db_list_projects = () => command<Project[]>('db_list_projects')
    .then(projects => projects.map(normalizeProject))

export const db_update_project = (input: UpdateProjectInput) => {
    const {id, name, description, coverPath} = input
    return command<Project>('db_update_project', {
        id,
        name,
        description: description ?? null,
        descriptionSet: description !== undefined,
        coverImage: coverPath,
    }).then(normalizeProject)
}

export const db_delete_project = (id: string) =>
    command<void>('db_delete_project', {id})

export const db_export_project_fcworld = (
    projectId: string,
    outputPath: string,
    operationId?: string,
    includeHistory = true,
) =>
    command<FcworldExportResult>('db_export_project_fcworld', {
        projectId,
        outputPath,
        includeHistory,
        operationId,
    })

export const db_preview_project_fcworld = (inputPath: string, operationId?: string) =>
    command<FcworldImportPreview>('db_preview_project_fcworld', {inputPath, operationId})

export const db_import_project_fcworld = (
    inputPath: string,
    options?: FcworldImportOptions,
    operationId?: string,
) =>
    command<FcworldImportResult>('db_import_project_fcworld', {inputPath, options, operationId})

export const db_create_category = ({
                                       projectId,
                                       parentId,
                                       name,
                                       sortOrder,
                                   }: CreateCategoryInput) =>
    command<Category>('db_create_category', {projectId, parentId, name, sortOrder})

export const db_get_category = (id: string, projectId?: string) =>
    command<Category>('db_get_category', {id, projectId: projectId ?? null})

export const db_list_categories = (projectId: string) =>
    command<Category[]>('db_list_categories', {projectId})

export const db_update_category = ({id, projectId, parentId, name, sortOrder}: UpdateCategoryInput) =>
    command<Category>('db_update_category', {
        id,
        projectId,
        ...(parentId !== undefined ? {parentId, parentIdSet: true} : {}),
        ...(name !== undefined ? {name} : {}),
        ...(sortOrder !== undefined ? {sortOrder} : {}),
    })

export const db_delete_category = (id: string, projectId: string) =>
    command<void>('db_delete_category', {id, projectId})

export const db_cascade_delete_category = (id: string, projectId: string) =>
    command<CategoryCascadeDeleteResult>('db_cascade_delete_category', {id, projectId})

export const db_delete_category_move_to_parent = (id: string, projectId: string) =>
    command<void>('db_delete_category_move_to_parent', {id, projectId})

export const db_create_entry = ({
                                    projectId,
                                    categoryId,
                                    title,
                                    summary,
                                    content,
                                    type,
                                    tags,
                                    images,
                                }: CreateEntryInput) =>
    command<Entry>('db_create_entry', {
        projectId,
        categoryId,
        title,
        summary,
        content,
        type,
        tags,
        images,
    })

export const db_get_entry = (id: string, projectId?: string) =>
    command<Entry>('db_get_entry', {id, projectId: projectId ?? null})

export const db_list_entries = ({
                                    projectId,
                                    categoryId,
                                    entryType,
                                    limit,
                                    offset,
                                }: ListEntriesParams) =>
    command<EntryBrief[]>('db_list_entries', {
        projectId,
        categoryId,
        entryType,
        limit,
        offset,
    })

export const db_list_timeline_events = (projectId: string) =>
    command<ProjectTimelineData>('db_list_timeline_events', {projectId})

export const db_get_project_stats = (projectId: string) =>
    command<ProjectStats>('db_get_project_stats', {projectId})

export const db_search_entries = ({
                                      projectId,
                                      query,
                                      categoryId,
                                      entryType,
                                      limit,
                                  }: SearchEntriesParams) =>
    command<EntryBrief[]>('db_search_entries', {
        projectId,
        query,
        categoryId,
        entryType,
        limit,
    })

export const db_count_entries = ({projectId, categoryId, entryType}: CountEntriesParams) =>
    command<number>('db_count_entries', {projectId, categoryId, entryType})

export const db_update_entry = (input: UpdateEntryInput) => {
    const {
        id,
        projectId,
        categoryId,
        title,
        summary,
        content,
        type,
        tags,
        images,
    } = input
    return command<Entry>('db_update_entry', {
        id,
        projectId: projectId ?? null,
        categoryId,
        title,
        summary: summary ?? null,
        summarySet: summary !== undefined,
        content,
        type,
        tags,
        images,
    })
}

export const db_save_entry_bundle = (input: SaveEntryBundleInput) => {
    const {
        id,
        projectId,
        categoryId,
        title,
        summary,
        content,
        type,
        tags,
        images,
        relationDrafts,
        sourceId,
    } = input
    return command<SaveEntryBundleResponse>('db_save_entry_bundle', {
        input: {
            id,
            projectId,
            categoryId,
            title,
            summary: summary ?? null,
            content,
            type,
            tags,
            images,
            relationDrafts,
            sourceId,
        },
    })
}

export const db_delete_entry = (id: string, projectId?: string) =>
    command<void>('db_delete_entry', {id, projectId: projectId ?? null})

export const db_create_entries_bulk = (entries: CreateEntryInput[]) =>
    command<number>('db_create_entries_bulk', {entries})

export const db_optimize_fts = (projectId?: string | null) =>
    command<void>('db_optimize_fts', {projectId: projectId ?? null})

export const import_entry_images = (projectId: string, filePaths: string[]) =>
    command<FCImage[]>('import_entry_images', {projectId, filePaths})

export const import_remote_images = (projectId: string, urls: string[]) =>
    command<FCImage[]>('import_remote_images', {projectId, urls})

export const db_ensure_project_cover_thumbnails = (projectId: string) =>
    command<CoverThumbnailMigrationSummary>('db_ensure_project_cover_thumbnails', {projectId})

export const db_ensure_project_cover_thumbnail = (projectId: string) =>
    command<string | null>('db_ensure_project_cover_thumbnail', {projectId})

export const db_ensure_entry_cover_thumbnail = (projectId: string, entryId: string) =>
    command<string | null>('db_ensure_entry_cover_thumbnail', {projectId, entryId})

export const open_entry_image_path = (path: string) =>
    command<void>('open_entry_image_path', {path})

export const db_create_tag_schema = ({
                                         projectId,
                                         name,
                                         description,
                                         type,
                                         target,
                                         defaultVal,
                                         rangeMin,
                                         rangeMax,
                                         sortOrder,
                                     }: CreateTagSchemaInput) =>
    command<TagSchema>('db_create_tag_schema', {
        projectId,
        name,
        description,
        type,
        target,
        defaultVal,
        rangeMin,
        rangeMax,
        sortOrder,
    })

export const db_get_tag_schema = (id: string, projectId?: string) =>
    command<TagSchema>('db_get_tag_schema', {id, projectId: projectId ?? null})

export const db_list_tag_schemas = (projectId: string) =>
    command<TagSchema[]>('db_list_tag_schemas', {projectId})

export const db_update_tag_schema = ({
                                         id,
                                         projectId,
                                         name,
                                         description,
                                         type,
                                         target,
                                         defaultVal,
                                         rangeMin,
                                         rangeMax,
                                         sortOrder,
                                     }: UpdateTagSchemaInput) =>
    command<TagSchema>('db_update_tag_schema', {
        id,
        projectId,
        name,
        description,
        type,
        target,
        defaultVal,
        rangeMin,
        rangeMax,
        sortOrder,
    })

export const db_delete_tag_schema = (id: string, projectId: string) =>
    command<void>('db_delete_tag_schema', {id, projectId})

export const db_create_relation = ({
                                       projectId,
                                       aId,
                                       bId,
                                       relation,
                                       content,
                                   }: CreateRelationInput) =>
    command<EntryRelation>('db_create_relation', {projectId, aId, bId, relation, content})

export const db_get_relation = (id: string, projectId?: string) =>
    command<EntryRelation>('db_get_relation', {id, projectId: projectId ?? null})

export const db_list_relations_for_entry = (entryId: string, projectId?: string) =>
    command<EntryRelation[]>('db_list_relations_for_entry', {entryId, projectId: projectId ?? null})

export const db_list_relations_for_project = (projectId: string) =>
    command<EntryRelation[]>('db_list_relations_for_project', {projectId})

export const db_get_relation_graph_data = (projectId: string) =>
    command<RelationGraphData>('db_get_relation_graph_data', {projectId})

export const db_get_project_setting = (projectId: string, key: string) =>
    command<string | null>('db_get_project_setting', {projectId, key})

export const db_set_project_setting = (projectId: string, key: string, value: string) =>
    command<void>('db_set_project_setting', {projectId, key, value})

export const db_update_relation = ({id, projectId, relation, content}: UpdateRelationInput) =>
    command<EntryRelation>('db_update_relation', {id, projectId: projectId ?? null, relation, content})

export const db_delete_relation = (id: string, projectId?: string) =>
    command<void>('db_delete_relation', {id, projectId: projectId ?? null})

export const db_delete_relations_between = (entryAId: string, entryBId: string, projectId?: string) =>
    command<number>('db_delete_relations_between', {entryAId, entryBId, projectId: projectId ?? null})

export const db_create_entry_link = ({projectId, aId, bId}: CreateEntryLinkInput) =>
    command<EntryLink>('db_create_entry_link', {projectId, aId, bId})

export const db_list_outgoing_links = (entryId: string, projectId?: string) =>
    command<EntryLink[]>('db_list_outgoing_links', {entryId, projectId: projectId ?? null})

export const db_list_incoming_links = (entryId: string, projectId?: string) =>
    command<EntryLink[]>('db_list_incoming_links', {entryId, projectId: projectId ?? null})

export const db_delete_links_from_entry = (entryId: string, projectId?: string) =>
    command<number>('db_delete_links_from_entry', {entryId, projectId: projectId ?? null})

export const db_replace_outgoing_links = (projectId: string, entryId: string, linkedEntryIds: string[]) =>
    command<EntryLink[]>('db_replace_outgoing_links', {projectId, entryId, linkedEntryIds})

// ── 词条类型 ────────────────────────────────────────────────────────────────

export interface CustomEntryType {
    id: string
    project_id: string
    name: string
    description?: string | null
    icon?: string | null
    color?: string | null
    created_at: string
    updated_at: string
}

/** list_all_entry_types 返回的联合类型 */
export type EntryTypeView =
    | { kind: 'builtin'; key: string; name: string; description: string; icon: string; color: string }
    | { kind: 'custom' } & CustomEntryType

/** 返回用作 Entry.type 值的稳定标识符 */
export function entryTypeKey(et: EntryTypeView): string {
    return et.kind === 'builtin' ? et.key : et.id
}

export interface CreateEntryTypeInput {
    projectId: string
    name: string
    description?: string | null
    icon?: string | null
    color?: string | null
}

export interface UpdateEntryTypeInput {
    id: string
    projectId: string
    name?: string | null
    description?: string | null | undefined
    icon?: string | null | undefined
    color?: string | null | undefined
}

export const db_list_all_entry_types = (projectId: string) =>
    command<EntryTypeView[]>('db_list_all_entry_types', {projectId})

export const db_list_custom_entry_types = (projectId: string) =>
    command<CustomEntryType[]>('db_list_custom_entry_types', {projectId})

export const db_create_entry_type = ({projectId, name, description, icon, color}: CreateEntryTypeInput) =>
    command<CustomEntryType>('db_create_entry_type', {projectId, name, description, icon, color})

export const db_get_entry_type = (id: string, projectId?: string) =>
    command<CustomEntryType>('db_get_entry_type', {id, projectId: projectId ?? null})

export const db_update_entry_type = ({id, projectId, name, description, icon, color}: UpdateEntryTypeInput) =>
    command<CustomEntryType>('db_update_entry_type', {id, projectId, name, description, icon, color})

export const db_delete_entry_type = (id: string, projectId: string) =>
    command<void>('db_delete_entry_type', {id, projectId})
