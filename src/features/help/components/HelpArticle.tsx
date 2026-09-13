import type {RefObject} from 'react'
import MarkdownPreview, {type MarkdownPreviewProps} from '@uiw/react-markdown-preview'
import {Button, useTheme} from 'flowcloudai-ui'
import {
    getHelpModule,
    getHelpSectionDomId,
    type HelpTopic,
} from '../../../shared/help/helpCatalog'
import {getHelpSectionMarkdown} from '../../../shared/help/helpMarkdown'
import './HelpArticle.css'

interface HelpArticleProps {
    topic: HelpTopic
    bodyRef: RefObject<HTMLDivElement | null>
    onSelectHome: () => void
    onSelectSection: (sectionId: string) => void
}

const markdownComponents: MarkdownPreviewProps['components'] = {
    img: ({node, ...props}) => {
        void node
        return <img {...props} loading="lazy" decoding="async"/>
    },
}

function resolveMarkdownColorMode(theme: string): 'light' | 'dark' {
    if (theme === 'dark') return 'dark'
    if (theme === 'light') return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function HelpArticle({
    topic,
    bodyRef,
    onSelectHome,
    onSelectSection,
}: HelpArticleProps) {
    const module = getHelpModule(topic.moduleKey)
    const {theme} = useTheme()
    const colorMode = resolveMarkdownColorMode(theme)
    const tocItems = topic.sections.map((section, index) => (
        <button
            key={section.id}
            type="button"
            className="help-doc__toc-item"
            onClick={() => onSelectSection(section.id)}
        >
            <span>{String(index + 1).padStart(2, '0')}</span>
            {section.title}
        </button>
    ))

    return (
        <div className="help-main__body" ref={bodyRef}>
            <article className="help-doc">
                <Button
                    type="button"
                    className="help-content-home-button"
                    variant="ghost"
                    size="sm"
                    onClick={onSelectHome}
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M9.5 3.5 5 8l4.5 4.5"/>
                    </svg>
                    返回帮助首页
                </Button>
                <header className="help-doc__header">
                    <div className="help-doc__crumb">帮助中心 / {module.label} / {topic.category}</div>
                    <h2>{topic.label}</h2>
                    <p>{topic.summary}</p>
                    <div className="help-doc__meta" aria-label="文档信息">
                        <span>{topic.readingTime}</span>
                        <span>{topic.sections.length} 个小节</span>
                    </div>
                </header>

                <details className="help-doc__toc">
                    <summary className="help-doc__toc-title">本篇目录</summary>
                    <div className="help-doc__toc-list">{tocItems}</div>
                </details>

                <div className="help-doc__sections">
                    {topic.sections.map((section, index) => (
                        <section
                            className="help-doc__section"
                            id={getHelpSectionDomId(topic.key, section.id)}
                            key={section.id}
                        >
                            <div className="help-doc__section-number">{String(index + 1).padStart(2, '0')}</div>
                            <div className="help-doc__section-content">
                                <h3>{section.title}</h3>
                                <MarkdownPreview
                                    source={getHelpSectionMarkdown(topic.key, section.id)}
                                    className="help-doc__markdown"
                                    components={markdownComponents}
                                    wrapperElement={{'data-color-mode': colorMode}}
                                />
                            </div>
                        </section>
                    ))}
                </div>

                <aside className="help-doc__tips" aria-label="注意事项">
                    <h3>注意事项</h3>
                    <ul>
                        {topic.tips.map(tip => <li key={tip}>{tip}</li>)}
                    </ul>
                </aside>
            </article>
        </div>
    )
}
