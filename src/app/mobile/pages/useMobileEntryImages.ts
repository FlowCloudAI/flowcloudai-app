/** 移动端词条图片操作：统一文件导入、系统拍照、封面与删除，草稿归属由调用方决定。 */
import {type Dispatch, type SetStateAction, useCallback, useMemo, useState} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {
    captureSystemPhoto,
    discardCapturedPhoto,
    formatApiError,
    import_entry_images,
    isCameraCaptureCancelled,
    toApiError,
} from '../../../api'
import {openFileDialog} from '../../../api/dialog'
import {type EntryImage, toEntryImageSrc} from '../../../features/entries/lib/entryImage'
import {removeEntryImages} from '../../../features/entries/lib/entryImageCollection'
import {logger} from '../../../shared/logger'
import {appendImages} from './MobileEntryDetailUtils'

interface Options {
    projectId: string
    images: EntryImage[]
    setImages: Dispatch<SetStateAction<EntryImage[]>>
}

export default function useMobileEntryImages({projectId, images, setImages}: Options) {
    const {showAlert} = useAlert()
    const [imageAddModalOpen, setImageAddModalOpen] = useState(false)
    const [lightboxOpen, setLightboxOpen] = useState(false)
    const [lightboxIndex, setLightboxIndex] = useState(0)

    const lightboxImages = useMemo(() => images.map(image => ({
        ...image,
        src: toEntryImageSrc(image),
    })), [images])

    const handleUploadImages = useCallback(async (): Promise<EntryImage[]> => {
        try {
            const selected = await openFileDialog({
                multiple: true,
                filters: [{
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
                }],
            })
            const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
            if (!paths.length) return []
            const imported = await import_entry_images(projectId, paths)
            const nextImportedImages: EntryImage[] = imported.map((image, index) => ({
                ...image,
                alt: image.alt || (image.path?.split(/[\\/]/).pop() ?? `图片 ${index + 1}`),
                is_cover: false,
            }))
            setImages(current => appendImages(current, nextImportedImages))
            return nextImportedImages
        } catch (error) {
            await showAlert(`导入图片失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
            return []
        }
    }, [projectId, setImages, showAlert])

    const handleCaptureImage = useCallback(async (): Promise<EntryImage[]> => {
        let capturedTempPath: string | null = null
        try {
            const captured = await captureSystemPhoto()
            capturedTempPath = captured.tempPath
            const imported = await import_entry_images(projectId, [captured.tempPath])
            const nextImportedImages: EntryImage[] = imported.map((image, index) => ({
                ...image,
                alt: image.alt || (image.path?.split(/[\\/]/).pop() ?? `照片 ${index + 1}`),
                is_cover: false,
            }))
            setImages(current => appendImages(current, nextImportedImages))
            return nextImportedImages
        } catch (error) {
            if (isCameraCaptureCancelled(error)) return []
            await showAlert(`拍照失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
            return []
        } finally {
            if (capturedTempPath) {
                try {
                    await discardCapturedPhoto(capturedTempPath)
                } catch (error) {
                    logger.warn('[MobileEntryImages] 清理相机临时文件失败:', error)
                }
            }
        }
    }, [projectId, setImages, showAlert])

    const handleAddAiImages = useCallback((aiImages: EntryImage[]) => {
        setImages(current => appendImages(current, aiImages))
    }, [setImages])

    const handleSetCover = useCallback((targetIndex: number) => {
        setImages(current => current.map((image, index) => ({
            ...image,
            is_cover: index === targetIndex,
        })))
    }, [setImages])

    const handleRemoveImage = useCallback((targetIndex: number) => {
        setImages(current => removeEntryImages(current, [targetIndex]))
        setLightboxIndex(current => Math.min(current, Math.max(0, images.length - 2)))
    }, [images.length, setImages])

    const handleRemoveImages = useCallback((indices: number[]) => {
        setImages(current => removeEntryImages(current, indices))
        setLightboxIndex(0)
    }, [setImages])

    const openImage = useCallback((index: number) => {
        setLightboxIndex(index)
        setLightboxOpen(true)
    }, [])

    return {
        imageAddModalOpen,
        setImageAddModalOpen,
        lightboxOpen,
        setLightboxOpen,
        lightboxIndex,
        setLightboxIndex,
        lightboxImages,
        handleUploadImages,
        handleCaptureImage,
        handleAddAiImages,
        handleSetCover,
        handleRemoveImage,
        handleRemoveImages,
        openImage,
    }
}
