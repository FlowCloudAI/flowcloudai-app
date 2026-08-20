/*
 * iOS 系统可访问性桥接：把 Dynamic Type 与降低透明度写入共享 WebView 的 CSS 环境。
 * React 仍负责界面；本文件不承载业务状态，也不依赖生成目录中的具体 WebView 层级。
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
        FCAScheduleMobileUiEnvironmentRefresh();
    });
}
