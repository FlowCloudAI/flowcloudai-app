// 本 hook 复用既有词条图片导入和草稿更新规则；外壳改造不改变资产保存时机。

import {useCallback} from 'react'
import {import_entry_images} from '../../../api'
import {openFileDialog} from '../../../api/dialog.ts'
import type {EntryDraft} from '../components/entryEditorModel.ts'
import type {EntryImage} from '../lib/entryImage.ts'
import {removeEntryImages} from '../lib/entryImageCollection.ts'

interface UseEntryImageDraftActionsOptions {
    projectId: string
    updateDraft: (updater: (current: EntryDraft) => EntryDraft) => void
    reportError: (message: string) => void
}

export default function useEntryImageDraftActions({
    projectId,
    updateDraft,
    reportError,
}: UseEntryImageDraftActionsOptions) {
    const uploadImages = useCallback(async (): Promise<EntryImage[]> => {
        try {
            const selected = await openFileDialog({
                multiple: true,
                filters: [{name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']}],
            })
            const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
            if (!paths.length) return []
            const imported = await import_entry_images(projectId, paths)
            const normalized = imported.map((image, index) => ({
                ...image,
                alt: image.alt || (image.path?.split(/[\\/]/).pop() ?? `图片 ${index + 1}`),
            }))
            updateDraft(current => {
                const images = [...current.images]
                normalized.forEach((image, index) => images.push({
                    ...image,
                    is_cover: images.length === 0 && index === 0,
                }))
                return {...current, images}
            })
            return normalized
        } catch (error) {
            reportError(String(error))
            return []
        }
    }, [projectId, reportError, updateDraft])

    const addAiImages = useCallback((aiImages: EntryImage[]) => {
        updateDraft(current => {
            const images = [...current.images]
            aiImages.forEach((image, index) => images.push({
                ...image,
                is_cover: images.length === 0 && index === 0,
            }))
            return {...current, images}
        })
    }, [updateDraft])

    const setCover = useCallback((targetIndex: number) => updateDraft(current => ({
        ...current,
        images: current.images.map((image, index) => ({...image, is_cover: index === targetIndex})),
    })), [updateDraft])

    const removeImages = useCallback((indices: number[]) => updateDraft(current => ({
        ...current,
        images: removeEntryImages(current.images, indices),
    })), [updateDraft])

    return {
        uploadImages,
        addAiImages,
        setCover,
        removeImage: (targetIndex: number) => removeImages([targetIndex]),
        removeImages,
    }
}
