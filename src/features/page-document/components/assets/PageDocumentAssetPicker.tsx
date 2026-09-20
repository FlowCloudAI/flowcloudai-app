// 本面板从项目资产库选择或导入图片；预览只绘制宿主解码的像素，不暴露文件路径。

import {useEffect, useRef, useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {FloatingPanel} from '../../../../shared/ui/overlay'
import {
    pageDocumentAssetErrorMessage,
    pageDocumentReadAssetFrame,
    type PageDocumentAsset,
} from '../../../../api/pageDocument.ts'
import './PageDocumentAssetPicker.css'
import {pageDocumentAssetDisplayName, pageDocumentAssetSummary} from './assetPresentation.ts'

export function PageDocumentAssetThumbnail({asset}: {asset: PageDocumentAsset}) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [status, setStatus] = useState('正在读取…')
    useEffect(() => {
        let active = true
        void pageDocumentReadAssetFrame(asset.projectId, asset.id).then(frame => {
            if (!active) return
            const canvas = canvasRef.current
            const context = canvas?.getContext('2d')
            if (!canvas || !context) return
            const decoded = atob(frame.rgbaBase64)
            if (decoded.length !== frame.width * frame.height * 4) throw new TypeError('图片像素长度无效')
            const pixels = Uint8ClampedArray.from(decoded, character => character.charCodeAt(0))
            canvas.width = frame.width
            canvas.height = frame.height
            context.putImageData(new ImageData(new Uint8ClampedArray(pixels), frame.width, frame.height), 0, 0)
            setStatus('')
        }).catch(error => {
            if (active) setStatus(pageDocumentAssetErrorMessage(error))
        })
        return () => { active = false }
    }, [asset.id, asset.projectId])
    return <span className="page-document-asset-picker__thumbnail">
        <canvas ref={canvasRef} hidden={status !== ''} aria-label="项目图片预览" role="img" />
        {status && <span role="status">{status}</span>}
    </span>
}

export function PageDocumentAssetPicker({
    mode,
    assets,
    busy,
    error,
    onChoose,
    onImport,
    onClose,
}: {
    mode: 'insert' | 'replace'
    assets: readonly PageDocumentAsset[]
    busy: boolean
    error: string | null
    onChoose: (asset: PageDocumentAsset) => void
    onImport: () => void
    onClose: () => void
}) {
    return <FloatingPanel
        open
        title={mode === 'insert' ? '插入项目图片' : '替换图片资源'}
        onClose={onClose}
        dismissible={!busy}
        className="page-document-asset-picker"
    >
        <div className="page-document-asset-picker__body">
            <p>图片属于当前项目资产库；取消或撤销页面修改不会删除已导入原件。</p>
            <Button type="button" size="sm" disabled={busy} onClick={onImport}>导入本地图片</Button>
            {error && <p role="alert">{error}</p>}
            {assets.length === 0 ? <p>项目还没有页面图片。先导入一张图片。</p> : (
                <div className="page-document-asset-picker__list">
                    {assets.map((asset, index) => <button
                        key={asset.id}
                        type="button"
                        disabled={busy}
                        onClick={() => onChoose(asset)}
                    >
                        <PageDocumentAssetThumbnail asset={asset} />
                        <span>{pageDocumentAssetDisplayName(index)}<small>{pageDocumentAssetSummary(asset)}</small></span>
                    </button>)}
                </div>
            )}
        </div>
    </FloatingPanel>
}
