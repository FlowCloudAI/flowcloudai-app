/*
 * 移动端外壳的最小复现：固定顶栏 + 内部滚动区 + 常驻输入区 + 底部 Tab。
 * 只有布局，没有任何键盘处理——待实现的需求本身就是让这块布局在键盘弹出时表现正确。
 */

export default function LabShell() {
    return (
        <div className="lab-shell">
            <header className="lab-topbar">固定顶栏 — 必须永远可见</header>

            <div className="lab-scroller">
                <p className="lab-hint">内部滚动区。下面是一个比键盘上方可视区更高的输入框。</p>
                <textarea className="lab-long-input" placeholder="长输入框"/>
                <p className="lab-hint">滚动区里的其他内容。</p>
            </div>

            <div className="lab-composer">
                <textarea className="lab-composer-input" placeholder="底部常驻输入框"/>
            </div>

            <nav className="lab-tabbar">底部 Tab</nav>
        </div>
    )
}
