import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react'
import {
    DockPanelIconButton,
    DockPanelMain,
    DockPanelTitle,
    DockPanelTopbar,
} from '../../shared/ui/layout/DockPanelScaffold'
import '../../shared/ui/layout/DockPanelScaffold.css'
import {
    filterHelpTopics,
    getHelpModule,
    getHelpSectionDomId,
    groupHelpTopicsByModule,
    HELP_TOPICS,
    type HelpModuleKey,
    type HelpTopicKey,
    normalizeHelpTopicKey,
} from '../../shared/help/helpCatalog'
import HelpArticle from './components/HelpArticle'
import HelpHome from './components/HelpHome'
import HelpModuleHome from './components/HelpModuleHome'
import './components/HelpPanel.css'

export interface HelpPanelRequest {
    topicKey?: string | null
    sectionId?: string | null
    requestId: number
}

interface UseHelpPanelOptions {
    request?: HelpPanelRequest | null
    onToggleCollapsed?: () => void
}

export interface HelpPanelSlots {
    main: ReactNode
}

function scrollToSection(topicKey: HelpTopicKey, sectionId: string | null, bodyEl: HTMLDivElement | null) {
    if (!sectionId) {
        bodyEl?.scrollTo({top: 0, behavior: 'smooth'})
        return
    }

    document
        .getElementById(getHelpSectionDomId(topicKey, sectionId))
        ?.scrollIntoView({block: 'start', behavior: 'smooth'})
}

export function useHelpPanel({
    request,
    onToggleCollapsed,
}: UseHelpPanelOptions = {}): HelpPanelSlots {
    const [activeModuleKey, setActiveModuleKey] = useState<HelpModuleKey | null>(null)
    const [activeTopicKey, setActiveTopicKey] = useState<HelpTopicKey | null>(null)
    const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const articleBodyRef = useRef<HTMLDivElement | null>(null)
    const requestId = request?.requestId
    const requestTopicKey = request?.topicKey
    const requestSectionId = request?.sectionId

    useEffect(() => {
        if (requestId === undefined) return
        const nextTopicKey = normalizeHelpTopicKey(requestTopicKey)
        const nextTopic = HELP_TOPICS.find(topic => topic.key === nextTopicKey) ?? HELP_TOPICS[0]
        setActiveModuleKey(nextTopic.moduleKey)
        setActiveTopicKey(nextTopic.key)
        setActiveSectionId(requestSectionId ?? null)
    }, [requestId, requestSectionId, requestTopicKey])

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            if (!activeTopicKey) {
                articleBodyRef.current?.scrollTo({top: 0, behavior: 'smooth'})
                return
            }
            scrollToSection(activeTopicKey, activeSectionId, articleBodyRef.current)
        })
        return () => window.cancelAnimationFrame(frame)
    }, [activeModuleKey, activeSectionId, activeTopicKey])

    const activeTopic = useMemo(
        () => activeTopicKey ? HELP_TOPICS.find(topic => topic.key === activeTopicKey) ?? HELP_TOPICS[0] : null,
        [activeTopicKey],
    )

    const activeModule = useMemo(
        () => activeModuleKey ? getHelpModule(activeModuleKey) : null,
        [activeModuleKey],
    )

    const activeModuleTopics = useMemo(
        () => activeModuleKey ? HELP_TOPICS.filter(topic => topic.moduleKey === activeModuleKey) : [],
        [activeModuleKey],
    )

    const topicGroups = useMemo(
        () => groupHelpTopicsByModule(filterHelpTopics(HELP_TOPICS, searchText)),
        [searchText],
    )

    const handleSelectTopic = (topicKey: HelpTopicKey, sectionId: string | null = null) => {
        const nextTopic = HELP_TOPICS.find(topic => topic.key === topicKey) ?? HELP_TOPICS[0]
        setActiveModuleKey(nextTopic.moduleKey)
        setActiveTopicKey(nextTopic.key)
        setActiveSectionId(sectionId)
    }

    const handleSelectHome = () => {
        setActiveModuleKey(null)
        setActiveTopicKey(null)
        setActiveSectionId(null)
    }

    const handleSelectModule = (moduleKey: HelpModuleKey) => {
        setActiveModuleKey(moduleKey)
        setActiveTopicKey(null)
        setActiveSectionId(null)
    }

    const handleSelectSection = (sectionId: string) => {
        if (!activeTopicKey) return
        setActiveSectionId(sectionId)
        window.requestAnimationFrame(() => {
            scrollToSection(activeTopicKey, sectionId, articleBodyRef.current)
        })
    }

    const mainContent = (
        <DockPanelMain className="help-main help-main--floating">
            <DockPanelTopbar className="help-main__topbar">
                <div className="help-main__topbar-left">
                    <DockPanelTitle>帮助中心</DockPanelTitle>
                </div>
                <div className="help-main__topbar-actions">
                    <DockPanelIconButton
                        type="button"
                        onClick={() => onToggleCollapsed?.()}
                        title="最小化"
                        aria-label="最小化帮助中心"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                            <path d="M6 4l4 4-4 4"/>
                        </svg>
                    </DockPanelIconButton>
                </div>
            </DockPanelTopbar>
            {activeTopic ? (
                <HelpArticle
                    topic={activeTopic}
                    bodyRef={articleBodyRef}
                    onSelectHome={handleSelectHome}
                    onSelectSection={handleSelectSection}
                />
            ) : activeModule ? (
                <HelpModuleHome
                    module={activeModule}
                    topics={activeModuleTopics}
                    bodyRef={articleBodyRef}
                    onSelectHome={handleSelectHome}
                    onSelectTopic={handleSelectTopic}
                />
            ) : (
                <HelpHome
                    groups={topicGroups}
                    bodyRef={articleBodyRef}
                    searchText={searchText}
                    onSearchTextChange={setSearchText}
                    onSelectModule={handleSelectModule}
                    onSelectTopic={handleSelectTopic}
                />
            )}
        </DockPanelMain>
    )

    return {main: mainContent}
}
