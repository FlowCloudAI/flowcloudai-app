import {command} from './base'
import type {ApiError} from './error'
import type {Entry, FCImage} from './worldflow'

export type AiPluginKind = 'llm' | 'image' | 'tts'

export interface PluginInfo {
  id: string
  name: string
  kind: string
  models: string[]
  model_infos: PluginModelInfo[]
  default_model: string | null
    supported_sizes: string[]
    supported_voices: string[]
}

export interface PluginModelInfo {
  id: string
  name?: string | null
  description?: string | null
  context_window_tokens?: number | null
  max_output_tokens?: number | null
  prompt_price_per_m?: number | null
  completion_price_per_m?: number | null
  currency?: string | null
}

export interface AiCreateLlmSessionParams {
  sessionId: string
  pluginId: string
  model?: string | null
  temperature?: number | null
  maxTokens?: number | null
    maxToolRounds?: number | null
  /** 续聊已有对话时传入其 ID，App 后端将回放历史并覆写原文件 */
  conversationId?: string | null
    clientTraceId?: string | null
    settings?: StoredConversationSettings | null
    toolAccess?: 'reader' | 'assistant' | 'writer' | null
    webSearchEnabled?: boolean | null
}

export interface AiCreateLlmSessionResult {
  session_id: string
  conversation_id: string
  run_id: string
}

export interface CharacterChatProjectMeta {
    id: string
    name: string
    description?: string | null
}

export interface CharacterChatCategorySnapshot {
    id: string
    name: string
    parentId?: string | null
    path: string[]
}

export interface CharacterChatTagSchemaSnapshot {
    id: string
    name: string
    description?: string | null
    type: string
    target: string[]
}

export interface CharacterChatTagSnapshot {
    schemaId?: string | null
    name: string
    value: string
}

export interface CharacterChatEntrySnapshot {
    id: string
    title: string
    summary?: string | null
    content?: string | null
    entryType?: string | null
    categoryId?: string | null
    categoryPath: string[]
    tags: CharacterChatTagSnapshot[]
}

export interface CharacterChatRelationSnapshot {
    id: string
    fromEntryId: string
    toEntryId: string
    relation: string
    content: string
}

export interface CharacterChatProjectSnapshot {
    project: CharacterChatProjectMeta
    targetCharacter: CharacterChatEntrySnapshot
    categories: CharacterChatCategorySnapshot[]
    tagSchemas: CharacterChatTagSchemaSnapshot[]
    entries: CharacterChatEntrySnapshot[]
    relations: CharacterChatRelationSnapshot[]
}

export interface AiCreateCharacterSessionParams {
    sessionId: string
    pluginId: string
    characterName: string
    projectSnapshot: CharacterChatProjectSnapshot
    model?: string | null
    temperature?: number | null
    maxTokens?: number | null
    maxToolRounds?: number | null
}

export interface AiBuildCharacterProjectSnapshotResult {
    snapshot: CharacterChatProjectSnapshot
    characterEntry: Entry
    backgroundImage?: FCImage | null
    characterVoicePluginId?: string | null
    characterVoiceModel?: string | null
    characterVoiceId?: string | null
    characterAutoPlay?: boolean | null
}

export interface ImageData {
  url: string | null
  size: string | null
}

export interface AiImageParams {
  pluginId: string
  model: string
  prompt: string
    size?: string | null
}

export interface AiEditImageParams extends AiImageParams {
  imageUrl: string
}

export interface AiMergeImagesParams extends AiImageParams {
  imageUrls: string[]
}

export interface TtsResult {
  audio_base64: string
    audio_url: string | null
  format: string
  duration_ms: number | null
}

export interface AiSpeakParams {
  pluginId: string
  model: string
  text: string
  voiceId: string
}

export interface AiPlayTtsParams extends AiSpeakParams {
  conversationId?: string | null
  trigger?: 'auto' | 'manual'
}

export interface AiEventReady {
  session_id: string
  run_id: string
}

export interface AiEventDelta {
  session_id: string
  run_id: string
  text: string
}

export interface AiEventReasoning {
  session_id: string
  run_id: string
  text: string
}

export interface AiEventToolCall {
  session_id: string
  run_id: string
  index: number
  name: string
  arguments?: string
}

export interface AiEventToolRetrying {
  session_id: string
  run_id: string
  index: number
  name: string
  attempt: number
  max_retries: number
  delay_ms: number
}

export interface AiEventWorldCheckRetrying {
  session_id: string
  run_id: string
  attempt: number
  max_attempts: number
  error: string
}

export interface AiEventContextTrimmed {
  session_id: string
  run_id: string
  dropped_rounds: number
  truncated_messages: number
  before: number
  after: number
  suggest_compaction: boolean
  estimate_source: 'baseline' | 'full'
}

export interface AiUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_prompt_tokens?: number | null
  cache_creation_prompt_tokens?: number | null
  request_count?: number
  cache_usage_known_requests?: number
  cache_creation_usage_known_requests?: number
}

export interface AiEventRequestUsage {
  session_id: string
  run_id: string
  turn_id: number
  request_id: number
  attempt: number
  usage: AiUsage
}

export interface AiEventTurnEnd {
  session_id: string
  run_id: string
  status: string
  error?: ApiError | null
  node_id?: number | null
  finish_reason?: string | null
  continuation_of?: number | null
  usage?: AiUsage | null
  calibration_factor?: number | null
  calibration_key: string
}

export interface AiEventTurnBegin {
  session_id: string
  run_id: string
  turn_id: number
  node_id: number
}

export interface AiEventBranchChanged {
  session_id: string
  run_id: string
  node_id: number
}

export interface AiEventToolResult {
  session_id: string
  run_id: string
  index: number
  output: string
  result?: string
  is_error: boolean
}

export interface AiEventError {
  session_id: string
  run_id: string
  /**
   * 结构化错误对象。
   *
   * 兼容性：早期版本可能仍是字符串文案；前端读取时建议经过
   * `toApiError` 规范化，避免后续切版本破坏。
   */
  error: ApiError
}

export interface ToolStatus {
    name: string
    enabled: boolean
}

export const ai_list_plugins = (kind: AiPluginKind) =>
  command<PluginInfo[]>('ai_list_plugins', { kind })

export const ai_create_llm_session = ({
  sessionId,
  pluginId,
  model,
  temperature,
  maxTokens,
                                           maxToolRounds,
                                           conversationId,
                                           clientTraceId,
                                           settings,
                                           toolAccess,
                                           webSearchEnabled,
}: AiCreateLlmSessionParams) =>
    command<AiCreateLlmSessionResult>('ai_create_llm_session', {
    sessionId,
    pluginId,
    model,
    temperature,
    maxTokens,
        maxToolRounds,
        conversationId,
        clientTraceId,
        settings,
        toolAccess,
        webSearchEnabled,
  })

export const ai_create_character_session = ({
                                                sessionId,
                                                pluginId,
                                                characterName,
                                                projectSnapshot,
                                                model,
                                                temperature,
                                                maxTokens,
                                                maxToolRounds,
                                            }: AiCreateCharacterSessionParams) =>
    command<AiCreateLlmSessionResult>('ai_create_character_session', {
        input: {
            sessionId,
            pluginId,
            characterName,
            projectSnapshot,
            model,
            temperature,
            maxTokens,
            maxToolRounds,
        },
    })

export const ai_build_character_project_snapshot = (projectId: string, entryId: string) =>
    command<AiBuildCharacterProjectSnapshotResult>('ai_build_character_project_snapshot', {projectId, entryId})

export const ai_send_message = (
  sessionId: string,
  message: string,
  clientTraceId?: string,
  ctx?: TaskContextPayload,
) => command<void>('ai_send_message', {sessionId, message, clientTraceId, ctx})

export const ai_continue_generation = (sessionId: string, nodeId: number, clientTraceId?: string) =>
  command<void>('ai_continue_generation', { sessionId, nodeId, clientTraceId })

export const ai_close_session = (sessionId: string) =>
  command<void>('ai_close_session', { sessionId })

export const ai_close_all_sessions = () =>
    command<number>('ai_close_all_sessions')

export const ai_cancel_session = (sessionId: string) =>
    command<void>('ai_cancel_session', {sessionId})

export const ai_checkout = (sessionId: string, nodeId: number) =>
    command<void>('ai_checkout', {sessionId, nodeId})

export const ai_get_conversation_tree = (sessionId: string) =>
    command<ConversationNode[]>('ai_get_conversation_tree', {sessionId})

export const ai_switch_plugin = (sessionId: string, pluginId: string) =>
    command<void>('ai_switch_plugin', {sessionId, pluginId})

export interface UpdateSessionParams {
  model?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  thinking?: boolean
  frequencyPenalty?: number
  presencePenalty?: number
  topP?: number
  stop?: string[]
  responseFormat?: Record<string, unknown>
  n?: number
  toolChoice?: string
  logprobs?: boolean
  topLogprobs?: number
}

export const ai_update_session = (sessionId: string, params: UpdateSessionParams) =>
    command<void>('ai_update_session', {sessionId, params})

export const ai_text_to_image = ({pluginId, model, prompt, size}: AiImageParams) =>
    command<ImageData[]>('ai_text_to_image', {pluginId, model, prompt, size})

export const ai_edit_image = ({
  pluginId,
  model,
  prompt,
  imageUrl,
}: AiEditImageParams) =>
    command<ImageData[]>('ai_edit_image', {pluginId, model, prompt, imageUrl})

export const ai_merge_images = ({
  pluginId,
  model,
  prompt,
  imageUrls,
}: AiMergeImagesParams) =>
    command<ImageData[]>('ai_merge_images', {pluginId, model, prompt, imageUrls})

export const ai_speak = ({pluginId, model, text, voiceId}: AiSpeakParams) =>
    command<TtsResult>('ai_speak', {pluginId, model, text, voiceId})

export const ai_play_tts = ({pluginId, model, text, voiceId, conversationId, trigger}: AiPlayTtsParams) =>
    command<void>('ai_play_tts', {pluginId, model, text, voiceId, conversationId, trigger})

export const ai_cancel_tts = () => command<void>('ai_cancel_tts')

// ── 对话历史管理 ──────────────────────────────────────────────────────────────

export interface ConversationMeta {
  id: string
  title: string
  plugin_id: string
  model: string
  created_at: string
  updated_at: string
}

export interface CharacterConversationMeta {
    mode?: 'character' | 'report' | null
    characterEntryId: string | null
    characterName: string | null
    backgroundImageUrl: string | null
    characterVoicePluginId: string | null
    characterVoiceModel: string | null
    characterVoiceId: string | null
    characterAutoPlay: boolean | null
    reportContext?: unknown | null
    reportSeeded?: boolean | null
}

export interface ConversationUiState {
    pinnedAt?: string | null
    archivedAt?: string | null
}

export type ConversationExportFormat = 'markdown' | 'json'

export interface ConversationNodeMessage {
  role: string
  content: string | null
  reasoning_content?: string | null
  tool_call_id?: string | null
  tool_calls?: {
    id?: string | null
    index: number
    type?: string | null
    name?: string
    arguments?: string
    function?: {
      name?: string
      arguments?: string
    }
  }[] | null
}

export interface ConversationNode {
  id: number
  message: ConversationNodeMessage
  parent: number | null
  turn_id: number
  timestamp: string
}

export interface StoredMessage {
  message_id?: string | null
  node_id?: number | null
  turn_id?: number | null
  parent?: number | null
  role: string
  content: string | null
  reasoning: string | null
  timestamp: string
  work_seconds?: number | null
  turn_status?: string | null
  finish_reason?: string | null
  continuation_of?: number | null
  tool_call_id?: string | null
  tool_calls?: {
    id?: string | null
    index: number
    type?: string | null
    name?: string
    arguments?: string
    function?: {
      name?: string
      arguments?: string
    }
  }[]
  attachments?: StoredMessageAttachment[]
}

export interface StoredMessageAttachment {
    attachmentId: string
    documentContextItemId: string
    fileName: string
    extension: string
    sha256: string
    status: string
}

export interface StoredCompact {
  position_node_id: number
  text: string
  created_at: string
  context_snapshot?: TurnContextSnapshot | null
}

export interface StoredConversationSettings {
  temperature: number
  topP: number
  frequencyPenaltyEnabled: boolean
  frequencyPenalty: number
  presencePenaltyEnabled: boolean
  presencePenalty: number
  systemPrompt: string
}

export interface StoredConversation extends ConversationMeta {
  schema_version?: number
  settings?: StoredConversationSettings
  messages: StoredMessage[]
  context_snapshots?: TurnContextSnapshot[]
  head?: number | null
  compact?: StoredCompact | null
}

export interface ContextSnapshotSource {
  source: string
  version: number
  content_hash: string
  content: string
}

export interface TurnContextSnapshot {
  owner_node_id: number
  placement?: 'user_message' | 'after_node'
  assembly_version: number
  content_hash: string
  sources: ContextSnapshotSource[]
}

export interface CompactConversationRequest {
  conversationId: string
  pluginId?: string | null
  model?: string | null
  headNodeId?: number | null
  recentMessages?: number | null
  detail?: 'brief' | 'balanced' | 'detailed' | null
}

export interface CompactConversationResult {
  applied: boolean
  positionNodeId?: number | null
  retainedMessages: number
  summaryChars: number
  reason?: string | null
}

export interface SummaryResult {
    summaryMarkdown: string
    highlights: string[]
    sourceEntryIds: string[]
    warnings: string[]
}

export interface SummaryDraftEntry {
    entryId: string
    title?: string | null
    summary?: string | null
    content?: string | null
    entryType?: string | null
}

export interface GenerateEntrySummaryParams {
    pluginId: string
    projectId: string
    entryIds: string[]
    focus?: string | null
    outputMode?: string | null
    draftEntry?: SummaryDraftEntry | null
    model?: string | null
    maxTokens?: number | null
}

export interface FillImagePromptParams {
    pluginId: string
    model?: string | null
    currentPrompt?: string | null
    usage?: 'entry_image' | 'project_cover' | null
    projectName?: string | null
    entryTitle?: string | null
    entrySummary?: string | null
    entryType?: string | null
}

export interface FillImagePromptResult {
    prompt: string
}

export const ai_generate_entry_summary = ({
                                              pluginId,
                                              projectId,
                                              entryIds,
                                              focus,
                                              outputMode,
                                              draftEntry,
                                              model,
                                              maxTokens,
                                          }: GenerateEntrySummaryParams) =>
    command<SummaryResult>('ai_generate_entry_summary', {
        request: {
            pluginId,
            projectId,
            entryIds,
            focus,
            outputMode,
            draftEntry,
            model,
            maxTokens,
        },
    })

export const ai_fill_image_prompt = ({
                                          pluginId,
                                          model,
                                          currentPrompt,
                                          usage,
                                          projectName,
                                          entryTitle,
                                          entrySummary,
                                          entryType,
                                      }: FillImagePromptParams) =>
    command<FillImagePromptResult>('ai_fill_image_prompt', {
        request: {
            pluginId,
            model,
            currentPrompt,
            usage,
            projectName,
            entryTitle,
            entrySummary,
            entryType,
        },
    })

export const ai_list_conversations = () =>
    command<ConversationMeta[]>('ai_list_conversations')

export const ai_get_conversation = (id: string) =>
    command<StoredConversation | null>('ai_get_conversation', {id})

export const ai_update_conversation_settings = (id: string, settings: StoredConversationSettings) =>
    command<StoredConversationSettings>('ai_update_conversation_settings', {id, settings})

export const ai_update_message_attachments = (
    conversationId: string,
    nodeId: number,
    attachments: StoredMessageAttachment[],
) =>
    command<void>('ai_update_message_attachments', {
        request: {
            conversationId,
            nodeId,
            attachments,
        },
    })

export const ai_compact_conversation = (request: CompactConversationRequest) =>
    command<CompactConversationResult>('ai_compact_conversation', {request})

export const ai_export_conversation = (id: string, path: string, format: ConversationExportFormat) =>
    command<void>('ai_export_conversation', {id, path, format})

export const ai_delete_conversation = (id: string) =>
    command<void>('ai_delete_conversation', {id})

export const ai_rename_conversation = (id: string, title: string) =>
    command<void>('ai_rename_conversation', {id, title})

export const ai_get_character_conversation_meta = () =>
    command<Record<string, CharacterConversationMeta>>('ai_get_character_conversation_meta')

export const ai_save_character_conversation_meta = (metadata: Record<string, CharacterConversationMeta>) =>
    command<void>('ai_save_character_conversation_meta', {metadata})

export const ai_get_conversation_ui_state = () =>
    command<Record<string, ConversationUiState>>('ai_get_conversation_ui_state')

export const ai_save_conversation_ui_state = (state: Record<string, ConversationUiState>) =>
    command<void>('ai_save_conversation_ui_state', {state})

// ── 编辑确认 ──────────────────────────────────────────────────────────────────

export interface EntryEditRequestEvent {
  request_id: string
  entry_id: string
  entry_title: string
  before_content: string
  after_content: string
}

export interface EntryUpdatedEvent {
  entry_id: string
  source_id?: string | null
}

export interface EntryDeleteRequestEvent {
    request_id: string
    entry_id: string
    entry_title: string
    entry_summary: string | null
}

export interface EntryDeletedEvent {
    entry_id: string
}

export interface EntryCreatedEvent {
    entry_id: string
    project_id: string
}

export interface CategoryCreatedEvent {
    category_id: string
    project_id: string
}

export interface CategoryDeletedEvent {
    category_id: string
}

export interface CategoryDeleteRequestEvent {
    request_id: string
    category_id: string
    category_name: string
    mode: 'move_to_parent'
}

export interface CategoryCascadeDeleteRequestEvent {
    request_id: string
    category_id: string
    category_name: string
    entry_count: number
    subcategory_count: number
    step: 1 | 2
}

export interface AiWriteRequestEvent {
    request_id: string
    operation: string
    title: string
    summary: string | null
    details: string[]
    warning: string | null
}

export const ENTRY_EDIT_REQUEST = 'entry:edit-request'
export const ENTRY_UPDATED = 'entry:updated'
export const ENTRY_DELETE_REQUEST = 'entry:delete-request'
export const ENTRY_DELETED = 'entry:deleted'
export const ENTRY_CREATED = 'entry:created'
export const CATEGORY_DELETE_REQUEST = 'category:delete-request'
export const CATEGORY_CASCADE_DELETE_REQUEST = 'category:cascade-delete-request'
export const AI_WRITE_REQUEST = 'ai:write-request'
export const CATEGORY_CREATED = 'category:created'
export const CATEGORY_DELETED = 'category:deleted'

/** 统一确认回调，所有 AI 确认类型均复用此命令 */
export const confirm_entry_edit = (requestId: string, confirmed: boolean) =>
    command<boolean>('confirm_entry_edit', {requestId, confirmed})

// ── Token 估算 ────────────────────────────────────────────────────────────────

export interface AiTokenEstimateMessage {
    content: string | null
    reasoning_content: string | null
    tool_payloads: string[]
}

export interface AiTokenEstimateRequest {
    messages: AiTokenEstimateMessage[]
    calibration_factor: number | null
    plugin_id?: string | null
    model?: string | null
}

export const ai_estimate_tokens = (request: AiTokenEstimateRequest) =>
    command<number>('ai_estimate_tokens', {request})

export interface AiRequestPreflight {
    estimated_input_tokens: number
    context_window_tokens: number | null
    output_reserve_tokens: number | null
    safety_reserve_tokens: number | null
    input_budget_tokens: number | null
    suggest_compaction: boolean | null
    head_node_id: number | null
    request_fingerprint: string
    estimate_source: 'baseline' | 'full'
}

export const ai_preflight_request = (sessionId: string, pendingUserMessage: string) =>
    command<AiRequestPreflight>('ai_preflight_request', {sessionId, pendingUserMessage})

// ── 工具管理 ──────────────────────────────────────────────────────────────────

export const ai_enable_tool = (name: string) =>
    command<boolean>('ai_enable_tool', {name})

export const ai_disable_tool = (name: string) =>
    command<boolean>('ai_disable_tool', {name})

export const ai_is_enabled = (name: string) =>
    command<boolean>('ai_is_enabled', {name})

export const ai_list_tools = () =>
    command<ToolStatus[]>('ai_list_tools')

// ── 编排上下文 ────────────────────────────────────────────────────────────────

export interface TaskContextPayload {
    projectId?: string | null
    taskType?: string | null
    attributes?: Record<string, string>
    instructionAttributes?: Record<string, string>
    flags?: Record<string, boolean>
}

export const ai_set_task_context = (sessionId: string, ctx: TaskContextPayload) =>
    command<void>('ai_set_task_context', {sessionId, ctx})
