/** 订阅子编辑页回递的结果（见 stores/mobileEditorHandoff）。 */
import {useEffect} from 'react'
import {subscribeMobileEditorResult} from '../stores/mobileEditorHandoff'

export function useMobileEditorResult<T>(
    token: string | undefined,
    onResult: (value: T) => void,
): void {
    useEffect(() => {
        if (!token) return
        return subscribeMobileEditorResult(token, value => onResult(value as T))
    }, [onResult, token])
}
