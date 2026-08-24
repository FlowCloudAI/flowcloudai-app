/**
 * 移动端词条属性页的标签区：标签值列表 + 一条「添加已有标签」控件。
 * 分组标题与「新建标签」入口由属性页的分组标题行提供，本组件不自带 header，
 * 保证属性页五个分组用同一种标题语言（2026-08-24 真机核对）。
 */
import {type ComponentProps, type Dispatch, type SetStateAction} from 'react'
import {Select} from 'flowcloudai-ui'
import {type TagSchema} from '../../../api'
import HighLightTagItem from '../../../features/entries/components/HighLightTagItem'
import {
    getComparableTagValue,
    normalizeComparableTagValue,
} from '../../../features/entries/lib/entryTag'
import {type TagValueMap} from './MobileEntryDetailUtils'

type SelectOptions = NonNullable<ComponentProps<typeof Select>['options']>

interface MobileEntryTagsSectionProps {
    hasTagDefinitions: boolean
    availableTagSchemaOptions: SelectOptions
    tagSchemaPickerValue?: string
    editTagSchemas: TagSchema[]
    implantedTagSchemaIdSet: Set<string>
    tagDraft: TagValueMap
    onAddVisibleTagSchema: (schemaId: string) => void
    onTagDraftChange: Dispatch<SetStateAction<TagValueMap>>
}

export function MobileEntryTagsSection({
    hasTagDefinitions,
    availableTagSchemaOptions,
    tagSchemaPickerValue,
    editTagSchemas,
    implantedTagSchemaIdSet,
    tagDraft,
    onAddVisibleTagSchema,
    onTagDraftChange,
}: MobileEntryTagsSectionProps) {
    return (
        <div className="mobile-entry-detail__tags">
            {!hasTagDefinitions ? (
                <div className="mobile-page__empty mobile-entry-detail__tags-empty">当前项目还没有标签定义</div>
            ) : editTagSchemas.length > 0 ? (
                <div className="mobile-entry-detail__tags-list">
                    {editTagSchemas.map(schema => (
                        <HighLightTagItem
                            key={schema.id}
                            schema={{
                                id: schema.id,
                                name: schema.name,
                                type: schema.type as 'number' | 'string' | 'boolean',
                                range_min: schema.range_min ?? null,
                                range_max: schema.range_max ?? null,
                            }}
                            value={tagDraft[schema.id] ?? tagDraft[schema.name] ?? null}
                            implanted={implantedTagSchemaIdSet.has(schema.id)}
                            mode="edit"
                            onChange={(value) => onTagDraftChange(prev => {
                                const nextValue = normalizeComparableTagValue(value)
                                if (getComparableTagValue(prev, schema) === nextValue) return prev
                                return {...prev, [schema.id]: nextValue}
                            })}
                        />
                    ))}
                </div>
            ) : (
                <div className="mobile-page__empty mobile-entry-detail__tags-empty">当前词条还没有已添加标签</div>
            )}

            {availableTagSchemaOptions.length > 0 && (
                <Select
                    value={tagSchemaPickerValue}
                    onValueChange={(value) => {
                        if (typeof value !== 'string') return
                        onAddVisibleTagSchema(value)
                    }}
                    options={availableTagSchemaOptions}
                    placeholder="添加已有标签"
                    searchable
                    className="mobile-entry-detail__tag-select"
                />
            )}
        </div>
    )
}
