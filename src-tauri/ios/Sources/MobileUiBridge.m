/*
 * iOS 系统可访问性桥接：把 Dynamic Type 与降低透明度写入共享 WebView 的 CSS 环境。
 * React 仍负责界面；本文件不承载业务状态，也不依赖生成目录中的具体 WebView 层级。
 */

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

static NSString *const FCAMobileUiMessageHandlerName = @"flowcloudaiMobileUi";
static const CGFloat FCAMinimumKeyboardOcclusion = 80.0;
static CGRect FCALastKeyboardScreenFrame = {{0, 0}, {0, 0}};
static __weak UIScreen *FCALastKeyboardScreen;
static BOOL FCAKeyboardForceHidden = YES;
static NSTimeInterval FCALastKeyboardAnimationDuration = 0;
static UIViewAnimationCurve FCALastKeyboardAnimationCurve = UIViewAnimationCurveEaseInOut;

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

static NSString *FCAKeyboardAnimationCurveName(UIViewAnimationCurve curve) {
    switch (curve) {
        case UIViewAnimationCurveEaseIn:
            return @"ease-in";
        case UIViewAnimationCurveEaseOut:
            return @"ease-out";
        case UIViewAnimationCurveLinear:
            return @"linear";
        case UIViewAnimationCurveEaseInOut:
        default:
            return @"ease-in-out";
    }
}

static void FCAResetKeyboardState(void) {
    FCAKeyboardForceHidden = YES;
    FCALastKeyboardScreenFrame = CGRectNull;
    FCALastKeyboardScreen = nil;
    FCALastKeyboardAnimationDuration = 0;
    FCALastKeyboardAnimationCurve = UIViewAnimationCurveEaseInOut;
}

static void FCAPushKeyboardMetricsToWebView(WKWebView *webView) {
    UIWindow *window = webView.window;
    UIView *parentView = webView.superview;
    if (window == nil || parentView == nil) {
        return;
    }

    /*
     * WKWebView 保持父视图尺寸，但 iOS 会把键盘变化反映到 Web 布局视口。
     * 原生指标只控制 Tab/输入态，不能再让 Web 根重复预留同一份遮挡。
     */
    const CGRect fullFrame = parentView.bounds;
    CGRect intersection = CGRectNull;
    if (!FCAKeyboardForceHidden
        && FCALastKeyboardScreen != nil
        && window.screen == FCALastKeyboardScreen) {
        CGRect frameInWindow = [window convertRect:FCALastKeyboardScreenFrame
                               fromCoordinateSpace:window.screen.coordinateSpace];
        CGRect frameInParent = [parentView convertRect:frameInWindow fromView:window];
        intersection = CGRectIntersection(fullFrame, frameInParent);
    }

    const BOOL visible = !CGRectIsNull(intersection)
        && !CGRectIsEmpty(intersection)
        && intersection.size.width > 0
        && intersection.size.height >= FCAMinimumKeyboardOcclusion;
    const CGFloat bottomDelta = visible
        ? fabs(CGRectGetMaxY(intersection) - CGRectGetMaxY(fullFrame))
        : CGFLOAT_MAX;
    const BOOL docked = visible
        && bottomDelta <= 1.0
        && intersection.size.width >= fullFrame.size.width * 0.8
        && intersection.size.height >= FCAMinimumKeyboardOcclusion;

    id frame = [NSNull null];
    if (visible) {
        frame = @{
            @"x": @(MAX(0, CGRectGetMinX(intersection) - CGRectGetMinX(fullFrame))),
            @"y": @(MAX(0, CGRectGetMinY(intersection) - CGRectGetMinY(fullFrame))),
            @"width": @(MAX(0, intersection.size.width)),
            @"height": @(MAX(0, intersection.size.height)),
        };
    }
    NSDictionary *payload = @{
        @"visible": @(visible),
        @"docked": @(docked),
        @"viewportAdjusted": @YES,
        @"occludedBottom": @(docked ? intersection.size.height : 0),
        @"frame": frame,
        @"animationDurationMs": @(MAX(0, FCALastKeyboardAnimationDuration * 1000)),
        @"animationCurve": FCAKeyboardAnimationCurveName(FCALastKeyboardAnimationCurve),
    };
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (jsonData == nil) {
        return;
    }
    NSString *json = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *script = [NSString stringWithFormat:
        @"(() => {"
         "const metrics = %@;"
         "window.__flowcloudaiPendingMobileKeyboardMetrics = metrics;"
         "window.__flowcloudaiReceiveMobileKeyboardMetrics?.(metrics);"
         "})();",
        json];
    [webView evaluateJavaScript:script completionHandler:nil];
}

static void FCAPushKeyboardMetricsToAllWebViews(void) {
    for (WKWebView *webView in FCAAllWebViews()) {
        FCAPushKeyboardMetricsToWebView(webView);
    }
}

static void FCAResetOuterDocumentOffsetAtStableBoundary(void) {
    for (WKWebView *webView in FCAAllWebViews()) {
        /*
         * iOS 会为露出大 textarea 平移 WKWebView 的外层 scroll view；页面本身并不可滚动，
         * 这份偏移只会把固定顶栏和元数据推出屏幕。只在键盘终态复位外层，不能逐帧执行，
         * 也不能改 textarea 的 scrollTop。
         */
        UIScrollView *scrollView = webView.scrollView;
        UIEdgeInsets inset = scrollView.adjustedContentInset;
        CGPoint origin = CGPointMake(-inset.left, -inset.top);
        if (fabs(scrollView.contentOffset.x - origin.x) > 0.5
            || fabs(scrollView.contentOffset.y - origin.y) > 0.5) {
            [scrollView setContentOffset:origin animated:NO];
        }
        [webView evaluateJavaScript:
            @"if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);"
                   completionHandler:nil];
    }
}

static void FCAHandleKeyboardNotification(NSNotification *notification) {
    NSDictionary *userInfo = notification.userInfo;
    NSValue *frameValue = userInfo[UIKeyboardFrameEndUserInfoKey];
    NSNumber *durationValue = userInfo[UIKeyboardAnimationDurationUserInfoKey];
    NSNumber *curveValue = userInfo[UIKeyboardAnimationCurveUserInfoKey];
    const BOOL hiding = [notification.name isEqualToString:UIKeyboardWillHideNotification]
        || [notification.name isEqualToString:UIKeyboardDidHideNotification];
    UIScreen *screen = [notification.object isKindOfClass:[UIScreen class]]
        ? (UIScreen *)notification.object
        : UIScreen.mainScreen;

    if (hiding) {
        /* 第三方键盘可能不给出可靠的最终 frame；Hide 是终态，必须清除全部缓存。 */
        FCAResetKeyboardState();
        FCAPushKeyboardMetricsToAllWebViews();
        if ([notification.name isEqualToString:UIKeyboardDidHideNotification]) {
            FCAResetOuterDocumentOffsetAtStableBoundary();
        }
        return;
    }

    if (frameValue != nil && screen != nil) {
        /* 是否仍在屏内必须先换算到各 WebView 坐标，不能用可能旋转过的 UIScreen.bounds 预判。 */
        FCAKeyboardForceHidden = NO;
        FCALastKeyboardScreenFrame = frameValue.CGRectValue;
        FCALastKeyboardScreen = screen;
    }
    FCALastKeyboardAnimationDuration = durationValue != nil ? durationValue.doubleValue : 0;
    FCALastKeyboardAnimationCurve = curveValue != nil
        ? (UIViewAnimationCurve)curveValue.integerValue
        : UIViewAnimationCurveEaseInOut;
    FCAPushKeyboardMetricsToAllWebViews();
    if ([notification.name isEqualToString:UIKeyboardDidChangeFrameNotification]) {
        FCAResetOuterDocumentOffsetAtStableBoundary();
    }
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
        FCAPushKeyboardMetricsToWebView(webView);
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
        [center addObserverForName:UIKeyboardWillChangeFrameNotification
                            object:nil
                             queue:NSOperationQueue.mainQueue
                        usingBlock:^(NSNotification *notification) {
            FCAHandleKeyboardNotification(notification);
        }];
        [center addObserverForName:UIKeyboardDidChangeFrameNotification
                            object:nil
                             queue:NSOperationQueue.mainQueue
                        usingBlock:^(NSNotification *notification) {
            FCAHandleKeyboardNotification(notification);
        }];
        [center addObserverForName:UIKeyboardWillHideNotification
                            object:nil
                             queue:NSOperationQueue.mainQueue
                        usingBlock:^(NSNotification *notification) {
            FCAHandleKeyboardNotification(notification);
        }];
        [center addObserverForName:UIKeyboardDidHideNotification
                            object:nil
                             queue:NSOperationQueue.mainQueue
                        usingBlock:^(NSNotification *notification) {
            FCAHandleKeyboardNotification(notification);
        }];
        [center addObserverForName:UIApplicationDidEnterBackgroundNotification
                            object:nil
                             queue:NSOperationQueue.mainQueue
                        usingBlock:^(__unused NSNotification *notification) {
            /* 后台不会保留可交互软键盘；只清状态，前台刷新再发布统一隐藏指标。 */
            FCAResetKeyboardState();
        }];
        FCAScheduleMobileUiEnvironmentRefresh();
    });
}
