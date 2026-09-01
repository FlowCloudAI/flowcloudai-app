import type {CSSProperties} from 'react'
import type {FcThemeTokenPreview} from '../../features/settings/fcThemeRecipe'
import './FcPrimaryToneGuide.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

interface FcPrimaryToneGuideProps {
    tokens: FcThemeTokenPreview[]
}

export default function FcPrimaryToneGuide({tokens}: FcPrimaryToneGuideProps) {
    return (
        <div className="fc-primary-tone-guide">
            <div className="fc-primary-tone-guide__header">
                <strong>FC 主题令牌建议映射</strong>
                <span>功能状态色保持不变，只覆盖主色、背景、边框和文字。</span>
            </div>
            <div className="fc-primary-tone-guide__token-list">
                {tokens.map((item) => (
                    <FcPrimaryToken key={item.token} item={item}/>
                ))}
            </div>
        </div>
    )
}

function FcPrimaryToken({item}: { item: FcThemeTokenPreview }) {
    return (
        <div className="fc-primary-tone-guide__token">
            <div className="fc-primary-tone-guide__token-name">
                <strong>{item.label}</strong>
                <span>{item.group}</span>
                <code>{item.token}</code>
            </div>
            <ColorValue label={item.light.label} value={item.light.value} swatch={item.light.swatch}/>
            <ColorValue label={item.dark.label} value={item.dark.value} swatch={item.dark.swatch}/>
        </div>
    )
}

function ColorValue({label, value, swatch}: { label: string; value: string; swatch: string }) {
    return (
        <div className="fc-primary-tone-guide__value">
            <span className="fc-primary-tone-guide__swatch" style={colorStyle(swatch)} aria-hidden="true"/>
            <span>{label}</span>
            <code>{value}</code>
        </div>
    )
}

function colorStyle(color: string): ColorVariableStyle {
    return {'--fc-primary-tone-guide-swatch': color}
}
