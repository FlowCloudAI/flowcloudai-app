// 本模块集中定义隔离画布协议的版本、预算与输入白名单，宿主和画布运行时不得各自放宽。

export const PAGE_DOCUMENT_CANVAS_CHANNEL = 'flowcloudai-page-document-canvas' as const
export const PAGE_DOCUMENT_CANVAS_VERSION = 1 as const

export const CANVAS_MESSAGE_MAX_BYTES = 2 * 1024 * 1024
export const CANVAS_SOURCE_MAX_CODE_UNITS = 768 * 1024
export const CANVAS_TEXT_FIELD_MAX_CODE_UNITS = 65_536
export const CANVAS_HREF_MAX_CODE_UNITS = 2_048
export const CANVAS_ERROR_MAX_CODE_UNITS = 2_048
export const CANVAS_DIMENSION_MAX = 100_000
export const CANVAS_PIXEL_RATIO_MAX = 16
export const CANVAS_ASSET_FRAME_MAX_EDGE = 512
export const CANVAS_ASSET_ORIGINAL_MAX_PIXELS = 24_000_000
export const CANVAS_ASSET_REQUEST_MAX_COUNT = 4_096

export const CANVAS_EDITABLE_KINDS = Object.freeze([
    'paragraph',
    'heading',
    'list-item',
    'table-cell',
] as const)

export const CANVAS_INPUT_TYPES = [
    'insertText',
    'insertReplacementText',
    'insertParagraph',
    'insertLineBreak',
    'insertFromPaste',
    // 组合输入只由 compositionend 生成，beforeinput 不会直接提交中间态。
    'insertCompositionText',
    'deleteContentBackward',
    'deleteContentForward',
    'deleteWordBackward',
    'deleteWordForward',
    'deleteSoftLineBackward',
    'deleteSoftLineForward',
    'deleteHardLineBackward',
    'deleteHardLineForward',
    'deleteByCut',
    'deleteContent',
] as const

export const CANVAS_INPUT_BLOCKED_REASONS = [
    'invalid-selection',
    'unsupported-input-type',
    'input-too-large',
] as const
