/**
 * 移动端词条属性页的图片区：一行横滑缩略图，末尾常驻「添加」瓦片。
 * 分组标题由属性页统一提供，本组件不再自带 header——2026-08-24 真机核对发现
 * 页面标题与组件内标题会同时出现，且「添加图片」按钮与空状态各自一种对齐。
 */
import {type EntryImage, toEntryImageSrc} from '../../../features/entries/lib/entryImage'
import {MobileAddIcon} from '../components/MobileTopControls'
import {getImageLabel} from './MobileEntryDetailUtils'

interface MobileEntryImagesSectionProps {
    images: EntryImage[]
    onAddImage: () => void
    onOpenImage: (index: number) => void
}

export function MobileEntryImagesSection({
    images,
    onAddImage,
    onOpenImage,
}: MobileEntryImagesSectionProps) {
    return (
        <div className="mobile-entry-detail__image-grid" data-mobile-horizontal-scroll="true">
            {images.map((image, index) => {
                const src = toEntryImageSrc(image)
                return (
                    <button
                        type="button"
                        className="mobile-entry-detail__image-thumb"
                        key={`${image.path ?? image.url ?? index}-${index}`}
                        onClick={() => onOpenImage(index)}
                    >
                        {src ? (
                            <img src={src} alt={getImageLabel(image, index)}/>
                        ) : (
                            <span>无预览</span>
                        )}
                        {image.is_cover && <span className="mobile-entry-detail__image-badge">主图</span>}
                    </button>
                )
            })}
            <button
                type="button"
                className="mobile-entry-detail__image-thumb mobile-entry-detail__image-thumb--add"
                onClick={onAddImage}
                aria-label="添加图片"
            >
                <MobileAddIcon/>
                <span>添加</span>
            </button>
        </div>
    )
}
