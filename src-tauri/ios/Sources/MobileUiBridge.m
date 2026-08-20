/*
 * iOS 系统可访问性桥接：把 Dynamic Type 与降低透明度写入共享 WebView 的 CSS 环境。
 * React 仍负责界面；本文件不承载业务状态，也不依赖生成目录中的具体 WebView 层级。
 *
 * 另含键盘布局所有权的实验实现：软键盘出现时直接把 WKWebView 的 frame 收缩到键盘上方。
 * 这样键盘完全落在 WebView 之外，WebKit 认为没有遮挡，就不会为了露出光标而平移整页
 * （2026-08-20 实测：不收缩时它会把页面连同 position:fixed 外壳一起推走，顶栏离屏）。
 * 布局视口随之变小，Web 侧无需消费任何键盘高度——这是唯一的消费者。
 */

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

static NSString *const FCAMobileUiMessageHandlerName = @"flowcloudaiMobileUi";

static NSArray<WKWebView *> *FCACollectWebViews(UIView *rootView) {
    NSMutableArray<WKWebView *> *webViews = [NSMutableArray array];
    if ([rootView isKindOfClass:[WKWebView class]]) {
        [webViews addObject:(WKWebView *)rootView];
    }
    for (UIView *subview in rootView.subviews) {
        [webViews addObjectsFromArray:FCACollectWebViews(subview)];
    }
    return webViews;
}

static NSArray<WKWebView *> *FCAAllWebViews(void) {
    NSMutableArray<WKWebView *> *webViews = [NSMutableArray array];
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) {
            continue;
        }
        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
            [webViews addObjectsFromArray:FCACollectWebViews(window)];
        }
    }
    return webViews;
}

/*
 * 键盘遮挡必须达到这个高度才认为是「有效停靠键盘」。
 * 外接键盘的快捷栏、第三方键盘的残余工具条都低于它，不应触发整页收缩。
 */
static const CGFloat FCAMinimumKeyboardOcclusion = 80.0;

static void FCAResizeWebViewsForKeyboard(NSNotification *notification, BOOL hiding) {
    NSDictionary *info = notification.userInfo;
    const CGRect endFrame = [info[UIKeyboardFrameEndUserInfoKey] CGRectValue];
    const NSTimeInterval duration = [info[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
    const UIViewAnimationCurve curve =
        (UIViewAnimationCurve)[info[UIKeyboardAnimationCurveUserInfoKey] integerValue];

    for (WKWebView *webView in FCAAllWebViews()) {
        UIWindow *window = webView.window;
        UIView *parent = webView.superview;
        if (window == nil || parent == nil) {
            continue;
        }

        const CGRect full = parent.bounds;
        CGRect target = full;

        if (!hiding) {
            /* 键盘 frame 用的是屏幕坐标系，必须换算到父视图，不能直接和局部尺寸相减。 */
            const CGRect inWindow = [window convertRect:endFrame
                                    fromCoordinateSpace:window.screen.coordinateSpace];
            const CGRect inParent = [parent convertRect:inWindow fromView:window];
            const CGRect hit = CGRectIntersection(full, inParent);
            const BOOL docked = !CGRectIsNull(hit)
                && hit.size.height >= FCAMinimumKeyboardOcclusion
                && hit.size.width >= full.size.width * 0.8
                && fabs(CGRectGetMaxY(hit) - CGRectGetMaxY(full)) <= 1.0;
            if (docked) {
                target.size.height = MAX(0, CGRectGetMinY(hit) - CGRectGetMinY(full));
            }
        }

        if (CGRectEqualToRect(webView.frame, target)) {
            continue;
        }

        /*
         * 保留 wry 设定的 FlexibleWidth/FlexibleHeight：旋转与分屏靠它跟随父视图，
         * 而键盘期间父视图 bounds 不变，我们设的 frame 不会被改写。
         *
         * AllowUserInteraction 必须给：UIView 动画默认会禁用被动画视图的交互，
         * 键盘动画那两百多毫秒里 WebView 收不到点击，表现为「点了没反应」。
         * BeginFromCurrentState 让第三方键盘中途改高度时从当前位置接上，不跳回起点。
         */
        const UIViewAnimationOptions options =
            ((UIViewAnimationOptions)curve << 16)
            | UIViewAnimationOptionBeginFromCurrentState
            | UIViewAnimationOptionAllowUserInteraction;
        /* 用系统给的时长与曲线，让 WebView 收缩和键盘走同一条动画，避免两套时钟。 */
        if (duration > 0) {
            [UIView animateWithDuration:duration
                                  delay:0
                                options:options
                             animations:^{ webView.frame = target; }
                             completion:nil];
        } else {
            webView.frame = target;
        }
    }
}

static void FCAApplyTheme(NSString *theme) {
    UIUserInterfaceStyle style = UIUserInterfaceStyleUnspecified;
    if ([theme isEqualToString:@"dark"]) {
        style = UIUserInterfaceStyleDark;
    } else if ([theme isEqualToString:@"light"]) {
        style = UIUserInterfaceStyleLight;
    }
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) {
            continue;
        }
        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
            window.overrideUserInterfaceStyle = style;
            [window.rootViewController setNeedsStatusBarAppearanceUpdate];
        }
    }
}

static void FCAPerformHaptic(NSString *kind) {
    if ([kind isEqualToString:@"success"] || [kind isEqualToString:@"warning"]) {
        UINotificationFeedbackGenerator *generator = [[UINotificationFeedbackGenerator alloc] init];
        [generator prepare];
        [generator notificationOccurred:[kind isEqualToString:@"success"]
            ? UINotificationFeedbackTypeSuccess
            : UINotificationFeedbackTypeWarning];
        return;
    }

    UISelectionFeedbackGenerator *generator = [[UISelectionFeedbackGenerator alloc] init];
    [generator prepare];
    [generator selectionChanged];
}

@interface FCAMobileUiMessageHandler : NSObject <WKScriptMessageHandler>
@end

@implementation FCAMobileUiMessageHandler

- (void)userContentController:(__unused WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) {
        return;
    }
    NSDictionary *payload = (NSDictionary *)message.body;
    NSString *type = payload[@"type"];
    NSString *value = payload[@"value"];
    if (![type isKindOfClass:[NSString class]] || ![value isKindOfClass:[NSString class]]) {
        return;
    }

    if ([type isEqualToString:@"theme"]) {
        FCAApplyTheme(value);
    } else if ([type isEqualToString:@"haptic"]) {
        FCAPerformHaptic(value);
    }
}

@end

static FCAMobileUiMessageHandler *FCAMobileUiHandler(void) {
    static FCAMobileUiMessageHandler *handler;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        handler = [[FCAMobileUiMessageHandler alloc] init];
    });
    return handler;
}

static void FCAApplyMobileUiEnvironment(void) {
    const CGFloat baseBodySize = 17.0;
    const CGFloat scaledBodySize = [[UIFontMetrics metricsForTextStyle:UIFontTextStyleBody]
        scaledValueForValue:baseBodySize];
    const CGFloat fontScale = MIN(MAX(scaledBodySize / baseBodySize, 1.0), 2.0);
    const BOOL highContrast = UIAccessibilityIsReduceTransparencyEnabled()
        || UIAccessibilityDarkerSystemColorsEnabled();
    NSString *script = [NSString stringWithFormat:
        @"(() => {"
         "const root = document.documentElement;"
         "root.style.setProperty('--mobile-font-scale', '%.4f');"
         "root.dataset.mobileHighContrast = '%@';"
         "const syncNativeTheme = () => {"
         "const preference = root.dataset.themePreference;"
         "const value = preference === 'light' || preference === 'dark' ? preference : 'system';"
         "window.webkit?.messageHandlers?.flowcloudaiMobileUi?.postMessage({type: 'theme', value});"
         "};"
         "if (!window.__flowcloudaiMobileThemeObserver) {"
         "window.__flowcloudaiMobileThemeObserver = new MutationObserver(syncNativeTheme);"
         "window.__flowcloudaiMobileThemeObserver.observe(root, {"
         "attributes: true, attributeFilter: ['data-theme', 'data-theme-preference']"
         "});"
         "}"
         "syncNativeTheme();"
         "})();",
        fontScale,
        highContrast ? @"true" : @"false"];

    for (WKWebView *webView in FCAAllWebViews()) {
        WKUserContentController *controller = webView.configuration.userContentController;
        [controller removeScriptMessageHandlerForName:FCAMobileUiMessageHandlerName];
        [controller addScriptMessageHandler:FCAMobileUiHandler()
                                     name:FCAMobileUiMessageHandlerName];
        [webView evaluateJavaScript:script completionHandler:nil];
    }
}

static void FCAScheduleMobileUiEnvironmentRefresh(void) {
    /* Tauri 创建 WKWebView 与 UIApplication 激活并非固定先后，短重试覆盖冷启动与恢复。 */
    const NSTimeInterval delays[] = {0.0, 0.25, 1.0, 2.0};
    for (NSUInteger index = 0; index < sizeof(delays) / sizeof(delays[0]); index++) {
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delays[index] * NSEC_PER_SEC)),
            dispatch_get_main_queue(),
            ^{ FCAApplyMobileUiEnvironment(); }
        );
    }
}

__attribute__((constructor))
static void FCAInstallMobileUiBridge(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
        NSArray<NSNotificationName> *notifications = @[
            UIApplicationDidBecomeActiveNotification,
            UIContentSizeCategoryDidChangeNotification,
            UIAccessibilityReduceTransparencyStatusDidChangeNotification,
            UIAccessibilityDarkerSystemColorsStatusDidChangeNotification,
        ];
        for (NSNotificationName name in notifications) {
            [center addObserverForName:name
                                object:nil
                                 queue:NSOperationQueue.mainQueue
                            usingBlock:^(__unused NSNotification *notification) {
                FCAScheduleMobileUiEnvironmentRefresh();
            }];
        }

        /*
         * WillChangeFrame 覆盖第三方键盘中途改高度；WillHide 是唯一可靠的收起终态，
         * 只靠 ChangeFrame 会在第三方键盘上留下旧 frame 并让 WebView 一直保持收缩。
         */
        [center addObserverForName:UIKeyboardWillChangeFrameNotification
                            object:nil
                             queue:NSOperationQueue.mainQueue
                        usingBlock:^(NSNotification *notification) {
            FCAResizeWebViewsForKeyboard(notification, NO);
        }];
        [center addObserverForName:UIKeyboardWillHideNotification
                            object:nil
                             queue:NSOperationQueue.mainQueue
                        usingBlock:^(NSNotification *notification) {
            FCAResizeWebViewsForKeyboard(notification, YES);
        }];

        FCAScheduleMobileUiEnvironmentRefresh();
    });
}
