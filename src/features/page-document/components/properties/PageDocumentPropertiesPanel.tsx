// 本组件呈现“所有宽度”的有限调节控件；所有结构化修改均由内核适配层序列化和校验。

import {useEffect, useMemo, useRef, useState} from 'react'
import {Button, Input, Select} from 'flowcloudai-ui'
import type {PageDocumentAsset} from '../../../../api/pageDocument.ts'
import {
    selectPublicComponentDefinition,
    type PublicComponentDefinitionContract,
} from '../../domain/kernel/contracts/publicComponent.ts'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import type {
    InspectVisualComponent,
    VisualFontWeight,
    VisualPropertyChange,
    VisualPropertyEditValue,
    VisualPropertyGroup,
    VisualPropertyName,
    VisualPropertyState,
} from '../../application/visualPropertyEditing.ts'
import {
    createVisualPropertyEditRequest,
    inspectVisualProperties,
    VISUAL_FONT_WEIGHTS,
} from '../../application/visualPropertyEditing.ts'
import type {KernelDraftEditRequest} from '../../application/documentKernelDraftRuntime.ts'
import {inferOpaqueAdoptionKind} from '../../application/opaqueElementAdoption.ts'
import {
    createImageDescriptionEditRequest,
    readManagedImageDescription,
    type ManagedImageDescription,
} from '../../application/imageSemanticEditing.ts'
import {BoxSpacingControls} from './BoxSpacingControls.tsx'
import {ColorPropertyControl} from './ColorPropertyControl.tsx'
import {NumericPropertyControl, type PropertyChangeOptions} from './NumericPropertyControl.tsx'
import {
    BackgroundPropertyControl,
    BoxShadowPropertyControl,
    DimensionPropertyControl,
    KeywordPropertyControl,
} from './StructuredPropertyControls.tsx'
import './PageDocumentPropertiesPanel.css'
import {createPublicComponentInstanceEditRequest} from '../../application/publicComponentEditing.ts'
import {InteractionStatePropertyControls} from './InteractionStatePropertyControls.tsx'
import {GridLayoutPropertyControls} from './GridLayoutPropertyControls.tsx'
import {PropertyDisclosure} from './PropertyDisclosure.tsx'
import {
    propertyDockVisualTab,
    type PropertyDockNavigationRequest,
} from '../../application/propertyDockNavigation.ts'

interface PageDocumentPropertiesPanelProps {
    node: LayerProjectionNode | null
    gridParent: LayerProjectionNode | null
    articleHtml: string
    assets: readonly PageDocumentAsset[]
    componentDefinitions: readonly PublicComponentDefinitionContract[]
    entryStyleCss: string
    inspectComponent: InspectVisualComponent
    applyKernelEntry: (
        request: KernelDraftEditRequest,
        label: string,
        options?: PropertyChangeOptions,
    ) => Promise<boolean>
    flushPendingChanges: () => void
    onAdopt: (node: LayerProjectionNode) => Promise<string | null>
    onReplaceImage: () => void
    onManagePublicComponent: (node: LayerProjectionNode) => void
    onSaveAsPublicComponent: (node: LayerProjectionNode) => void
    visualError: string | null
    styleContext: 'mobile' | 'desktop'
    navigationRequest: PropertyDockNavigationRequest | null
}

function ComponentInstanceControls({
    node,
    definition,
    applyKernelEntry,
    onManage,
}: {
    node: LayerProjectionNode
    definition: PublicComponentDefinitionContract
    applyKernelEntry: PageDocumentPropertiesPanelProps['applyKernelEntry']
    onManage: () => void
}) {
    const readProperties = () => Object.fromEntries(
        definition.propertySchema.map(property => [
            property.name,
            node.attributes[`data-fc-prop-${property.name}`] ?? '',
        ]),
    )
    const readVariables = () => {
        const declarations = (node.attributes.style ?? '').split(';').flatMap(item => {
            const at = item.indexOf(':')
            return at > 0 ? [[item.slice(0, at).trim(), item.slice(at + 1).trim()] as const] : []
        })
        const styles = new Map(declarations)
        return Object.fromEntries(definition.styleVariableSchema.map(variable => [variable.name, styles.get(variable.name) ?? '']))
    }
    const [properties, setProperties] = useState<Record<string, string>>(readProperties)
    const [variables, setVariables] = useState<Record<string, string>>(readVariables)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        setProperties(readProperties())
        setVariables(readVariables())
        setError(null)
        // 节点或定义变化时重置表单；定义对象本身由会话快照保持稳定。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id, definition.componentId, definition.revision])
    const commit = async (kind: 'property' | 'style', name: string) => {
        const value = kind === 'property' ? properties[name] : variables[name]
        setBusy(true)
        setError(null)
        try {
            const request = createPublicComponentInstanceEditRequest(
                node.id,
                kind === 'property' ? {[name]: value || null} : {},
                kind === 'style' ? {[name]: value || null} : {},
            )
            if (!await applyKernelEntry(request, kind === 'property' ? `修改组件属性 ${name}` : `修改组件样式变量 ${name}`, {immediate: true})) {
                setError('公共组件实例未修改；当前源码保持不变。')
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : '公共组件实例未修改。')
        } finally {
            setBusy(false)
        }
    }
    return <section className="page-document-component-details" aria-label="公共组件实例">
        <strong>{definition.name}</strong>
        <p>此组件来自公共模板；实例只允许修改定义公开的属性与样式变量。</p>
        {definition.propertySchema.map(property => <label key={property.name}>
            {property.name}{property.required ? ' · 必填' : ''}
            <Input
                aria-label={`组件属性 ${property.name}`}
                disabled={busy}
                value={properties[property.name] ?? ''}
                onValueChange={value => setProperties(current => ({...current, [property.name]: value}))}
                onBlur={() => void commit('property', property.name)}
            />
        </label>)}
        {definition.styleVariableSchema.map(variable => <label key={variable.name}>
            {variable.name}
            <Input
                aria-label={`组件样式变量 ${variable.name}`}
                disabled={busy}
                value={variables[variable.name] ?? ''}
                onValueChange={value => setVariables(current => ({...current, [variable.name]: value}))}
                onBlur={() => void commit('style', variable.name)}
            />
        </label>)}
        <div className="page-document-component-details__advanced">
            <strong>高级</strong>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onManage}>编辑公共组件</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onManage}>仅为当前内容创建本地副本</Button>
        </div>
        {error && <p role="alert">{error}</p>}
    </section>
}

function ImageDescriptionControls({
    image,
    applyKernelEntry,
    onReplaceImage,
}: {
    image: ManagedImageDescription
    applyKernelEntry: PageDocumentPropertiesPanelProps['applyKernelEntry']
    onReplaceImage: () => void
}) {
    const [alt, setAlt] = useState(image.alt)
    const [caption, setCaption] = useState(image.caption ?? '')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const nextCaption = caption === '' && image.caption !== '' ? null : caption
    const changed = alt !== image.alt || (image.captionEditable && nextCaption !== image.caption)
    const commit = async () => {
        if (!changed || busy) return
        try {
            const request = createImageDescriptionEditRequest(image, {
                alt,
                caption: image.captionEditable ? nextCaption : image.caption,
            })
            if (!request) return
            setBusy(true)
            setError(null)
            const accepted = await applyKernelEntry(request, '修改图片说明', {immediate: true})
            if (!accepted) setError('图片说明未写入草稿；原有源码保持不变。')
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : '图片说明未写入草稿。')
        } finally {
            setBusy(false)
        }
    }
    return (
        <section className="page-document-image-details" aria-label="图片说明">
            <div className="page-document-image-details__header">
                <strong>图片</strong>
                <Button type="button" size="sm" variant="outline" onClick={onReplaceImage}>替换图片</Button>
            </div>
            <p data-asset-status={image.reference.status} role="status">{image.reference.message}</p>
            <details className="page-document-image-details__description">
                <summary>替代文本与图注</summary>
                <div>
                    <label>
                        替代文本
                        <Input value={alt} onValueChange={setAlt} aria-label="图片替代文本" />
                    </label>
                    <label>
                        图注
                        <textarea
                            value={caption}
                            onChange={event => setCaption(event.target.value)}
                            disabled={!image.captionEditable}
                            aria-label="图片图注"
                            rows={3}
                        />
                    </label>
                    {image.captionReason && <p>{image.captionReason}</p>}
                    {image.captionKind === 'structured' && <p>复杂图注的替换会先要求确认。</p>}
                    <Button type="button" size="sm" disabled={!changed || busy} onClick={() => void commit()}>
                        {busy ? '正在应用…' : '应用图片说明'}
                    </Button>
                    {error && <p role="alert">{error}</p>}
                </div>
            </details>
        </section>
    )
}

const TABS: readonly {key: VisualPropertyGroup; label: string}[] = [
    {key: 'text', label: '文字'},
    {key: 'layout', label: '布局'},
    {key: 'appearance', label: '颜色与效果'},
]

const TEXT_PRIMARY_PROPERTIES = ['font-size', 'font-weight', 'line-height'] as const
const TEXT_DETAIL_PROPERTIES = [
    'letter-spacing',
    'word-spacing',
    'text-decoration-line',
    'text-decoration-color',
    'text-decoration-style',
] as const
const LAYOUT_STRUCTURE_PROPERTIES = [
    'display',
    'grid-template-columns',
    'align-items',
    'justify-content',
    'align-self',
    'justify-self',
] as const
const LAYOUT_SPACING_PROPERTIES = [
    'margin-block-start',
    'margin-block-end',
    'margin-inline-start',
    'margin-inline-end',
    'padding-block-start',
    'padding-block-end',
    'padding-inline-start',
    'padding-inline-end',
    'gap',
    'row-gap',
    'column-gap',
] as const
const LAYOUT_SIZE_PROPERTIES = [
    'width',
    'height',
    'min-width',
    'max-width',
    'min-height',
    'max-height',
    'float',
    'object-fit',
    'object-position',
    'list-style-type',
    'list-style-position',
] as const
const APPEARANCE_COLOR_PROPERTIES = ['color', 'background-color', 'background-image'] as const
const APPEARANCE_BORDER_PROPERTIES = [
    'border-width',
    'border-style',
    'border-color',
    'border-radius',
] as const
const APPEARANCE_EFFECT_PROPERTIES = ['box-shadow', 'opacity', 'rotate'] as const

export const PAGE_DOCUMENT_NODE_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
    container: '容器',
    paragraph: '段落',
    heading: '标题',
    image: '图片',
    asset: '图片',
    gallery: '画廊',
    link: '链接',
    list: '列表',
    'list-item': '列表项',
    table: '表格',
    'table-cell': '表格单元格',
    quote: '引用',
    divider: '分隔线',
})

function fieldFor(fields: readonly VisualPropertyState[], property: VisualPropertyName): VisualPropertyState {
    const field = fields.find(item => item.property === property)
    if (!field) throw new TypeError(`属性面板缺少 ${property}。`)
    return field
}

function FontWeightControl({
    field,
    onChange,
}: {
    field: VisualPropertyState
    onChange: (value: VisualPropertyEditValue, options?: PropertyChangeOptions) => Promise<boolean>
}) {
    const localOrEffective = field.localValue ?? field.value
    const supported = VISUAL_FONT_WEIGHTS.includes(localOrEffective as VisualFontWeight)
    return (
        <section className={`page-document-property${field.disabled ? ' is-disabled' : ''}`}>
            <div className="page-document-property__heading">
                <span>{field.label}</span>
                <span data-source-state={field.sourceState}>{field.statusText}</span>
            </div>
            {!supported && localOrEffective && (
                <p className="page-document-property__message">复杂源码值会原样保留，请在代码模式调整。</p>
            )}
            <Select
                aria-label="字重"
                disabled={field.disabled}
                value={supported ? localOrEffective : '400'}
                options={VISUAL_FONT_WEIGHTS.map(value => ({value, label: value}))}
                onValueChange={value => void onChange(
                    {kind: 'font-weight', value: String(value) as VisualFontWeight},
                    {immediate: true},
                )}
            />
            {field.localValue !== null && (
                <Button
                    aria-label="清除"
                    className="page-document-property__clear"
                    size="sm"
                    title={field.clearTitle}
                    variant="ghost"
                    disabled={field.disabled}
                    onClick={() => void onChange({kind: 'clear-override'}, {immediate: true})}
                >
                    清除
                </Button>
            )}
            {field.reason && <p className="page-document-property__message">{field.reason}</p>}
        </section>
    )
}

export function PageDocumentPropertiesPanel({
    node,
    gridParent,
    articleHtml,
    assets,
    componentDefinitions,
    entryStyleCss,
    inspectComponent,
    applyKernelEntry,
    flushPendingChanges,
    onAdopt,
    onReplaceImage,
    onManagePublicComponent,
    onSaveAsPublicComponent,
    visualError,
    styleContext,
    navigationRequest,
}: PageDocumentPropertiesPanelProps) {
    const [tab, setTab] = useState<VisualPropertyGroup>('text')
    const panelRef = useRef<HTMLElement | null>(null)
    const fields = useMemo(
        () => node ? inspectVisualProperties(node, inspectComponent, entryStyleCss, styleContext) : [],
        [entryStyleCss, inspectComponent, node, styleContext],
    )
    const adoptKind = node ? inferOpaqueAdoptionKind(node) : null
    const image = useMemo(() => node?.managed && node.kind === 'asset'
        ? readManagedImageDescription(articleHtml, node.id, assets.map(asset => asset.id))
        : null, [articleHtml, assets, node])
    const selectedNodeId = node?.id ?? null
    const componentDefinition = node?.managed && node.kind === 'component'
        ? selectPublicComponentDefinition(
            componentDefinitions,
            node.attributes['data-fc-component'],
            node.attributes['data-fc-component-revision'],
        )
        : null
    useEffect(
        () => () => flushPendingChanges(),
        [flushPendingChanges, selectedNodeId],
    )
    useEffect(() => {
        if (!navigationRequest) return
        setTab(propertyDockVisualTab(navigationRequest.tab))
        const frame = requestAnimationFrame(() => {
            const target = panelRef.current
                ?.querySelector<HTMLElement>(`[data-property-section="${navigationRequest.section}"]`)
            const disclosure = target?.closest<HTMLDetailsElement>('.page-document-property-disclosure')
            if (disclosure) disclosure.open = true
            target?.scrollIntoView({block: 'nearest'})
        })
        return () => cancelAnimationFrame(frame)
    }, [navigationRequest])
    const applyChanges = (
        changes: readonly VisualPropertyChange[],
        label: string,
        options: PropertyChangeOptions = {},
    ) => {
        if (!node) return Promise.resolve(false)
        const request = createVisualPropertyEditRequest(node.id, changes, {...options, styleContext})
        return applyKernelEntry(request, label, options)
    }
    const applyOne = (
        field: VisualPropertyState,
        value: VisualPropertyEditValue,
        options?: PropertyChangeOptions,
    ) => applyChanges([{property: field.property, value}], `调整${field.label}`, options)
    const applicable = (property: VisualPropertyName) =>
        fieldFor(fields, property).sourceState !== 'not-applicable'

    return (
        <section className="page-document-properties-panel" ref={panelRef}>
            <header>
                <strong>属性 · {node ? (PAGE_DOCUMENT_NODE_KIND_LABELS[node.kind] ?? node.kind) : '未选择'}</strong>
                <span>修改范围 · {styleContext === 'desktop' ? '桌面覆盖' : '移动基础'}</span>
            </header>
            {image && <div data-property-section="content"><ImageDescriptionControls
                    key={`${image.nodeId}:${image.reference.assetId ?? image.reference.status}:${image.alt}:${image.caption ?? ''}`}
                    image={image}
                    applyKernelEntry={applyKernelEntry}
                    onReplaceImage={onReplaceImage}
                /></div>}
            {componentDefinition && node && <ComponentInstanceControls
                node={node}
                definition={componentDefinition}
                applyKernelEntry={applyKernelEntry}
                onManage={() => onManagePublicComponent(node)}
            />}
            {node?.managed && node.kind === 'asset' && !image && (
                <p className="page-document-image-details" role="alert">
                    当前图片结构没有唯一的受管图片，不能安全编辑说明或替换资源。
                </p>
            )}
            {node?.managed && node.kind !== 'component' && (
                <div className="page-document-properties-panel__tabs" role="tablist" aria-label="属性分类">
                    {TABS.map(item => (
                        <button
                            key={item.key}
                            type="button"
                            role="tab"
                            aria-selected={tab === item.key}
                            className={tab === item.key ? 'is-active' : ''}
                            onClick={() => setTab(item.key)}
                        >{item.label}</button>
                    ))}
                </div>
            )}
            {!node ? (
                <p className="page-document-properties-panel__empty">在画布或图层中选择一个元素</p>
            ) : !node.managed ? (
                <div className="page-document-properties-panel__adoption">
                    <strong>该元素尚未纳入可视编辑</strong>
                    <p>{adoptKind ? '纳入只会增加组件身份，不会改写元素内部内容。' : '无法从当前元素安全推断可视组件类型，请在代码模式处理。'}</p>
                    {adoptKind && (
                        <Button type="button" size="sm" onClick={() => void onAdopt(node)}>
                            转为{PAGE_DOCUMENT_NODE_KIND_LABELS[adoptKind] ?? adoptKind}
                        </Button>
                    )}
                </div>
            ) : node.kind === 'component' ? (
                !componentDefinition && <p className="page-document-component-details" role="alert">
                    公共组件定义缺失，当前实例只能保留引用，不能编辑属性。
                </p>
            ) : (
                <div
                    className="page-document-properties-panel__fields"
                    data-property-section={tab === 'text' ? 'text' : tab === 'appearance' ? 'appearance' : 'responsive-layout'}
                >
                    <Button type="button" size="sm" variant="outline" onClick={() => onSaveAsPublicComponent(node)}>
                        保存选中内容为公共组件
                    </Button>
                    {tab === 'text' && (
                        <>
                            <PropertyDisclosure key={`${node.id}:text-primary`} title="基础文字" fields={fields} properties={TEXT_PRIMARY_PROPERTIES}>
                                <NumericPropertyControl field={fieldFor(fields, 'font-size')} onChange={(value, options) => applyOne(fieldFor(fields, 'font-size'), value, options)}/>
                                <FontWeightControl field={fieldFor(fields, 'font-weight')} onChange={(value, options) => applyOne(fieldFor(fields, 'font-weight'), value, options)}/>
                                <NumericPropertyControl field={fieldFor(fields, 'line-height')} onChange={(value, options) => applyOne(fieldFor(fields, 'line-height'), value, options)}/>
                            </PropertyDisclosure>
                            <PropertyDisclosure key={`${node.id}:text-detail`} title="字距与装饰" fields={fields} properties={TEXT_DETAIL_PROPERTIES}>
                                <NumericPropertyControl field={fieldFor(fields, 'letter-spacing')} onChange={(value, options) => applyOne(fieldFor(fields, 'letter-spacing'), value, options)}/>
                                <NumericPropertyControl field={fieldFor(fields, 'word-spacing')} onChange={(value, options) => applyOne(fieldFor(fields, 'word-spacing'), value, options)}/>
                                <KeywordPropertyControl field={fieldFor(fields, 'text-decoration-line')} onChange={(value, options) => applyOne(fieldFor(fields, 'text-decoration-line'), value, options)}/>
                                <ColorPropertyControl field={fieldFor(fields, 'text-decoration-color')} onChange={(value, options) => applyOne(fieldFor(fields, 'text-decoration-color'), value, options)}/>
                                <KeywordPropertyControl field={fieldFor(fields, 'text-decoration-style')} onChange={(value, options) => applyOne(fieldFor(fields, 'text-decoration-style'), value, options)}/>
                            </PropertyDisclosure>
                        </>
                    )}
                    {tab === 'layout' && (
                        <>
                            <PropertyDisclosure key={`${node.id}:layout-structure`} title="布局结构" fields={fields} properties={LAYOUT_STRUCTURE_PROPERTIES}>
                                <div data-property-section="container-layout-preset">
                                    <div data-property-section="grid-layout">
                                        <GridLayoutPropertyControls
                                            node={node}
                                            gridParent={gridParent}
                                            viewport={styleContext}
                                            inspectComponent={inspectComponent}
                                            applyKernelEntry={(request, label) => applyKernelEntry(request, label, {immediate: true})}
                                        />
                                    </div>
                                    {node.kind === 'container' && (['align-items', 'justify-content'] as const).map(property => applicable(property) ? <KeywordPropertyControl
                                        key={property}
                                        field={fieldFor(fields, property)}
                                        onChange={(value, options) => applyOne(fieldFor(fields, property), value, options)}
                                    /> : null)}
                                </div>
                                {gridParent && (['align-self', 'justify-self'] as const).map(property => applicable(property) ? <KeywordPropertyControl
                                    key={property}
                                    field={fieldFor(fields, property)}
                                    onChange={(value, options) => applyOne(fieldFor(fields, property), value, options)}
                                /> : null)}
                            </PropertyDisclosure>
                            <PropertyDisclosure key={`${node.id}:layout-spacing`} title="间距" fields={fields} properties={LAYOUT_SPACING_PROPERTIES}>
                                <BoxSpacingControls label="外距" fields={fields} onChange={applyChanges}/>
                                <BoxSpacingControls label="内距" fields={fields} onChange={applyChanges}/>
                                <div data-property-section="container-layout-spacing">
                                    {(['gap', 'row-gap', 'column-gap'] as const).map(property => applicable(property) ? <NumericPropertyControl
                                        key={property}
                                        field={fieldFor(fields, property)}
                                        onChange={(value, options) => applyOne(fieldFor(fields, property), value, options)}
                                    /> : null)}
                                </div>
                            </PropertyDisclosure>
                            <PropertyDisclosure key={`${node.id}:layout-size`} title="尺寸与环绕" fields={fields} properties={LAYOUT_SIZE_PROPERTIES}>
                                {(['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'] as const).map(property => <DimensionPropertyControl
                                    key={property}
                                    field={fieldFor(fields, property)}
                                    onChange={(value, options) => applyOne(fieldFor(fields, property), value, options)}
                                />)}
                                {(['float'] as const).map(property => applicable(property) ? <KeywordPropertyControl
                                    key={property}
                                    field={fieldFor(fields, property)}
                                    onChange={(value, options) => applyOne(fieldFor(fields, property), value, options)}
                                /> : null)}
                                {node.kind === 'asset' && (['object-fit', 'object-position'] as const).map(property => applicable(property) ? <KeywordPropertyControl
                                    key={property}
                                    field={fieldFor(fields, property)}
                                    onChange={(value, options) => applyOne(fieldFor(fields, property), value, options)}
                                /> : null)}
                                {(node.kind === 'list' || node.kind === 'list-item') && (['list-style-type', 'list-style-position'] as const).map(property => applicable(property) ? <KeywordPropertyControl
                                    key={property}
                                    field={fieldFor(fields, property)}
                                    onChange={(value, options) => applyOne(fieldFor(fields, property), value, options)}
                                /> : null)}
                            </PropertyDisclosure>
                        </>
                    )}
                    {tab === 'appearance' && (
                        <>
                            <PropertyDisclosure key={`${node.id}:appearance-color`} title="颜色与交互" fields={fields} properties={APPEARANCE_COLOR_PROPERTIES}>
                                <InteractionStatePropertyControls
                                    node={node}
                                    entryStyleCss={entryStyleCss}
                                    inspectComponent={inspectComponent}
                                    applyKernelEntry={applyKernelEntry}
                                />
                                <ColorPropertyControl field={fieldFor(fields, 'color')} onChange={(value, options) => applyOne(fieldFor(fields, 'color'), value, options)}/>
                                <BackgroundPropertyControl
                                    assets={assets}
                                    colorField={fieldFor(fields, 'background-color')}
                                    imageField={fieldFor(fields, 'background-image')}
                                    onColorChange={(value, options) => applyOne(fieldFor(fields, 'background-color'), value, options)}
                                    onImageChange={(value, options) => applyOne(fieldFor(fields, 'background-image'), value, options)}
                                />
                            </PropertyDisclosure>
                            <PropertyDisclosure key={`${node.id}:appearance-border`} title="边框与圆角" fields={fields} properties={APPEARANCE_BORDER_PROPERTIES}>
                                <NumericPropertyControl field={fieldFor(fields, 'border-width')} onChange={(value, options) => applyOne(fieldFor(fields, 'border-width'), value, options)}/>
                                <KeywordPropertyControl field={fieldFor(fields, 'border-style')} onChange={(value, options) => applyOne(fieldFor(fields, 'border-style'), value, options)}/>
                                <ColorPropertyControl field={fieldFor(fields, 'border-color')} onChange={(value, options) => applyOne(fieldFor(fields, 'border-color'), value, options)}/>
                                <NumericPropertyControl field={fieldFor(fields, 'border-radius')} onChange={(value, options) => applyOne(fieldFor(fields, 'border-radius'), value, options)}/>
                            </PropertyDisclosure>
                            <PropertyDisclosure key={`${node.id}:appearance-effect`} title="阴影与效果" fields={fields} properties={APPEARANCE_EFFECT_PROPERTIES}>
                                <BoxShadowPropertyControl field={fieldFor(fields, 'box-shadow')} onChange={(value, options) => applyOne(fieldFor(fields, 'box-shadow'), value, options)}/>
                                <NumericPropertyControl field={fieldFor(fields, 'opacity')} onChange={(value, options) => applyOne(fieldFor(fields, 'opacity'), value, options)}/>
                                <NumericPropertyControl field={fieldFor(fields, 'rotate')} onChange={(value, options) => applyOne(fieldFor(fields, 'rotate'), value, options)}/>
                            </PropertyDisclosure>
                        </>
                    )}
                </div>
            )}
            {visualError && <p className="page-document-properties-panel__error" role="alert">{visualError}</p>}
        </section>
    )
}
