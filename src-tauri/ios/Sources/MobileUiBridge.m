/*
 * iOS 系统 UI 桥接：把 Dynamic Type、降低透明度和键盘原生事务写入共享 WebView。
 * React 仍负责界面；原生层只提供系统事实，不承载业务状态，也不改 WKWebView 几何。
 */

#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <math.h>

static NSString *const FCAMobileUiMessageHandlerName = @"flowcloudaiMobileUi";

/* 键盘实验桥的安装入口，实现在文件末尾的实验段落里 */
static void FCAInstallKeyboardLab(void);

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

#pragma mark - 正式键盘桥

/*
 * iOS 没有 Android WindowInsets 的清零入口。正式方案保持 WKWebView 全屏，摘掉它自己注册的
 * frame 观察器，再把 UIKeyboard 目标/时长/曲线发布给 Web 内容。收起方向 duration=0 时，
 * keyboardLayoutGuide 探针只作为逐帧兜底；任何路径都不改 webView.frame/contentOffset。
 */
@interface FCAKeyboardInsetCoordinator : NSObject

@property (nonatomic, weak) WKWebView *webView;
@property (nonatomic, weak) WKWebView *suppressedWebView;
@property (nonatomic, weak) UIView *probe;
@property (nonatomic, weak) UIView *probeHost;
@property (nonatomic, strong) CADisplayLink *link;
@property (nonatomic, assign) BOOL active;
@property (nonatomic, assign) BOOL keyboardVisible;
@property (nonatomic, assign) CGFloat probeFloor;
@property (nonatomic, assign) CGFloat lastPushedInset;
@property (nonatomic, assign) NSTimeInterval sampleUntil;

- (void)enableWithWebView:(WKWebView *)webView;
- (CGFloat)probeKeyboardHeightUsingPresentation:(BOOL)usePresentation;
- (void)publishKind:(NSString *)kind
               inset:(CGFloat)inset
            duration:(NSTimeInterval)duration
               curve:(NSInteger)curve;
- (void)publishKind:(NSString *)kind
               inset:(CGFloat)inset
            duration:(NSTimeInterval)duration
               curve:(NSInteger)curve
          nativeTime:(NSTimeInterval)nativeTime;

@end

@implementation FCAKeyboardInsetCoordinator

+ (instancetype)shared {
    static FCAKeyboardInsetCoordinator *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[FCAKeyboardInsetCoordinator alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
        for (NSNotificationName name in @[
            UIKeyboardWillChangeFrameNotification,
            UIKeyboardWillHideNotification,
            UIKeyboardDidHideNotification,
        ]) {
            [center addObserver:self
                       selector:@selector(handleKeyboardNotification:)
                           name:name
                         object:nil];
        }
    }
    return self;
}

- (void)enableWithWebView:(WKWebView *)webView {
    if (!webView) {
        return;
    }
    if (self.webView != webView) {
        [self.probe removeFromSuperview];
        self.probe = nil;
        self.probeHost = nil;
        self.webView = webView;
        self.probeFloor = 0.0;
        self.lastPushedInset = 0.0;
    }
    self.active = YES;
    [self installProbeIfNeeded];
    webView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    [self suppressWebKitKeyboardAvoidanceIfNeeded];

    /* React 安装全局接收函数后才发送 ready，保证初始 available 快照不会丢。 */
    CGFloat rawInset = self.keyboardVisible ? [self probeKeyboardHeightUsingPresentation:NO] : 0.0;
    CGFloat initialInset = rawInset <= self.probeFloor + 0.75 ? 0.0 : rawInset;
    [self publishKind:@"ready" inset:initialInset duration:0.0 curve:7];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.4 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        [self calibrateProbeFloorIfHidden];
    });
}

- (void)installProbeIfNeeded {
    if (self.probe || !self.webView) {
        return;
    }
    UIView *host = self.webView.window.rootViewController.view ?: self.webView.superview;
    if (!host) {
        return;
    }
    UIView *probe = [[UIView alloc] initWithFrame:CGRectZero];
    probe.userInteractionEnabled = NO;
    probe.alpha = 0.0;
    probe.backgroundColor = UIColor.clearColor;
    probe.translatesAutoresizingMaskIntoConstraints = NO;
    [host addSubview:probe];

    UILayoutGuide *guide = host.keyboardLayoutGuide;
    if (@available(iOS 17.0, *)) {
        host.keyboardLayoutGuide.usesBottomSafeArea = NO;
    }
    [NSLayoutConstraint activateConstraints:@[
        [probe.leadingAnchor constraintEqualToAnchor:host.leadingAnchor],
        [probe.widthAnchor constraintEqualToConstant:1.0],
        [probe.heightAnchor constraintEqualToConstant:1.0],
        [probe.topAnchor constraintEqualToAnchor:guide.topAnchor],
    ]];
    self.probe = probe;
    self.probeHost = host;
    [host layoutIfNeeded];
}

- (CGFloat)probeKeyboardHeightUsingPresentation:(BOOL)usePresentation {
    WKWebView *webView = self.webView;
    UIView *probe = self.probe;
    UIWindow *window = webView.window;
    if (!probe || !window) {
        return 0.0;
    }
    CGRect frame = probe.frame;
    if (usePresentation) {
        CALayer *presentation = probe.layer.presentationLayer;
        if (presentation) {
            frame = presentation.frame;
        }
    }
    CGPoint top = [probe.superview convertPoint:CGPointMake(0.0, CGRectGetMinY(frame)) toView:nil];
    return MAX(0.0, CGRectGetHeight(window.bounds) - top.y);
}

- (void)calibrateProbeFloorIfHidden {
    if (!self.active || self.keyboardVisible || !self.probeHost) {
        return;
    }
    [self.probeHost layoutIfNeeded];
    self.probeFloor = [self probeKeyboardHeightUsingPresentation:NO];
}

- (void)suppressWebKitKeyboardAvoidanceIfNeeded {
    WKWebView *webView = self.webView;
    if (!webView || self.suppressedWebView == webView) {
        return;
    }
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    /*
     * 只摘会修改 frame/inset 的四个观察者。DidShow 必须保留，WebKit 仍用它完成
     * RevealFocusedElementDeferrer，普通滚动表单才能在键盘到位后显现焦点元素。
     */
    for (NSNotificationName name in @[
        UIKeyboardWillShowNotification,
        UIKeyboardWillHideNotification,
        UIKeyboardWillChangeFrameNotification,
        UIKeyboardDidChangeFrameNotification,
    ]) {
        [center removeObserver:webView name:name object:nil];
    }
    self.suppressedWebView = webView;
}

- (void)startFrameSamplingFor:(NSTimeInterval)seconds {
    self.sampleUntil = MAX(self.sampleUntil, CACurrentMediaTime() + seconds);
    if (self.link) {
        return;
    }
    self.link = [CADisplayLink displayLinkWithTarget:self selector:@selector(tick:)];
    self.link.preferredFrameRateRange = CAFrameRateRangeMake(60.0, 120.0, 120.0);
    [self.link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}

- (void)stopFrameSampling {
    [self.link invalidate];
    self.link = nil;
}

- (void)tick:(CADisplayLink *)link {
    if (!self.active || !self.webView.window) {
        [self stopFrameSampling];
        return;
    }
    CGFloat rawInset = [self probeKeyboardHeightUsingPresentation:YES];
    CGFloat inset = rawInset <= self.probeFloor + 0.75 ? 0.0 : rawInset;
    if (fabs(inset - self.lastPushedInset) > 0.4) {
        self.lastPushedInset = inset;
        [self publishKind:@"frame" inset:inset duration:0.0 curve:7 nativeTime:link.timestamp * 1000.0];
    }
    if (CACurrentMediaTime() > self.sampleUntil) {
        [self stopFrameSampling];
    }
}

- (void)handleKeyboardNotification:(NSNotification *)notification {
    if (!self.active || !self.webView.window) {
        return;
    }
    if ([notification.name isEqualToString:UIKeyboardDidHideNotification]) {
        self.keyboardVisible = NO;
        self.lastPushedInset = 0.0;
        [self stopFrameSampling];
        [self publishKind:@"didHide" inset:0.0 duration:0.0 curve:7];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.4 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            [self calibrateProbeFloorIfHidden];
        });
        return;
    }

    NSDictionary *info = notification.userInfo;
    CGRect endFrame = [info[UIKeyboardFrameEndUserInfoKey] CGRectValue];
    UIWindow *window = self.webView.window;
    CGFloat windowHeight = CGRectGetHeight(window.bounds);
    CGFloat target = MAX(0.0, windowHeight - CGRectGetMinY(endFrame));
    if ([notification.name isEqualToString:UIKeyboardWillHideNotification]) {
        target = 0.0;
    }
    self.keyboardVisible = target > 0.0;
    NSTimeInterval duration = [info[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
    NSInteger curve = [info[UIKeyboardAnimationCurveUserInfoKey] integerValue];
    [self publishKind:@"willChange" inset:target duration:duration curve:curve];
    [self startFrameSamplingFor:MAX(2.0, duration + 0.8)];
}

- (void)publishKind:(NSString *)kind
               inset:(CGFloat)inset
            duration:(NSTimeInterval)duration
               curve:(NSInteger)curve {
    [self publishKind:kind
                inset:inset
             duration:duration
                curve:curve
           nativeTime:CACurrentMediaTime() * 1000.0];
}

- (void)publishKind:(NSString *)kind
               inset:(CGFloat)inset
            duration:(NSTimeInterval)duration
               curve:(NSInteger)curve
          nativeTime:(NSTimeInterval)nativeTime {
    WKWebView *webView = self.webView;
    if (!webView) {
        return;
    }
    NSDictionary *payload = @{
        @"kind": kind,
        @"inset": @(MAX(0.0, inset)),
        @"duration": @(MAX(0.0, duration)),
        @"curve": @(curve),
        @"nativeTime": @(nativeTime),
        @"probeFloor": @(MAX(0.0, self.probeFloor)),
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (!data) {
        return;
    }
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSString *script = [NSString stringWithFormat:
        @"window.__flowcloudaiApplyIosKeyboardInset&&window.__flowcloudaiApplyIosKeyboardInset(%@);",
        json];
    [webView evaluateJavaScript:script completionHandler:nil];
}

@end

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
    } else if ([type isEqualToString:@"keyboard"] && [value isEqualToString:@"enable"]) {
        [[FCAKeyboardInsetCoordinator shared] enableWithWebView:message.webView];
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

    FCAInstallKeyboardLab();
}

static void FCAScheduleMobileUiEnvironmentRefresh(void) {
    /* Tauri 创建 WKWebView 与 UIApplication 激活并非固定先后，短重试覆盖冷启动与恢复。 */
    const NSTimeInterval delays[] = {0.0, 0.25, 1.0, 2.0, 4.0, 8.0};
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

#pragma mark - 键盘布局实验桥（src/lab 专用，实验结束应整体删除）

/*
 * 本段只服务于 src/lab 的移动端键盘实验，不参与任何业务逻辑。全部使用公开 API。
 *
 * 存在的理由是三件 Web 侧拿不到的事实：
 *
 * 1. 键盘的**中间态**位置。visualViewport 与 rAF 在键盘事务期间会被 WebKit 稀疏化，
 *    采不到动画过程；而 UIView.keyboardLayoutGuide（iOS 15+）的约束是在键盘自己的
 *    动画块里更新的，把一个探针视图钉在它的顶边上，逐帧读探针的 presentationLayer
 *    就得到键盘每一帧的真实位置。CADisplayLink 跑在 UI 进程，与 Web 内容进程互不阻塞。
 *
 * 2. WebKit 自带的键盘避让。WKWebView 在 -_keyboardChangedWithInfo: 里调用
 *    -[UIScrollView _adjustForAutomaticKeyboardInfo:]，把整页（含 position:fixed 顶栏）
 *    顶出屏幕。它是 WKWebView 自己用 NSNotificationCenter 注册的观察者，
 *    移除这几个观察者即可关闭该行为——只用到公开的 removeObserver:name:object:，
 *    不触碰任何私有符号（Capacitor 的 iOS 键盘插件用的是同一手法）。
 *
 * 3. 滚动视图的真实几何（contentOffset / contentInset / 帧位置），
 *    用于证明"顶栏没有离开屏幕"这件事的**前提**始终成立，而不是只观察结果。
 */

static NSString *const FCAKbLabHandlerName = @"flowcloudaiKeyboardLab";
static const NSUInteger FCAKbLabMaxFrames = 2400; /* 约 20 秒 @120Hz */

@interface FCAKeyboardLab : NSObject <WKScriptMessageHandler>

@property (nonatomic, weak) WKWebView *webView;
@property (nonatomic, weak) UIView *probe;          /* 钉在 keyboardLayoutGuide 顶边的 1x1 探针 */
@property (nonatomic, weak) UIView *probeHost;
@property (nonatomic, strong) CADisplayLink *link;
@property (nonatomic, strong) NSMutableArray *frames;
@property (nonatomic, strong) NSMutableArray *events;

/* 运行期开关，全部由实验页通过 postMessage 设置，避免为每个方案重新编译原生代码 */
@property (nonatomic, assign) BOOL pushPerFrame;      /* 逐帧把键盘高度推给页面 */
@property (nonatomic, assign) BOOL clampScrollView;   /* 每帧强制 contentInset/contentOffset 归零 */
@property (nonatomic, assign) BOOL resizeWebViewFrame;/* 对照方案：直接压缩 WKWebView 自身高度 */
@property (nonatomic, assign) BOOL sampling;
@property (nonatomic, assign) BOOL observersRemoved;
@property (nonatomic, assign) NSUInteger clampCorrections;
@property (nonatomic, assign) NSTimeInterval sampleUntil;
@property (nonatomic, assign) CGFloat originalWebViewHeight;
@property (nonatomic, assign) CGFloat lastPushedKb;
@property (nonatomic, assign) BOOL autoLog;
@property (nonatomic, assign) BOOL labActive;
@property (nonatomic, assign) NSUInteger flushFrom;
@property (nonatomic, assign) NSUInteger eventFlushFrom;
@property (nonatomic, assign) NSUInteger transitionIndex;

@end

@implementation FCAKeyboardLab

+ (instancetype)shared {
    static FCAKeyboardLab *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[FCAKeyboardLab alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _frames = [NSMutableArray array];
        _events = [NSMutableArray array];
        /* 真机 syslog 可达（tauri ios dev 会挂 idevicesyslog），逐帧轨迹直接走 stderr，
           不必依赖人工复制。为了不干扰被测时序，采样期间只入缓冲，结束后一次性 flush。 */
        _autoLog = YES;
        NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
        NSArray<NSNotificationName> *names = @[
            UIKeyboardWillShowNotification,
            UIKeyboardDidShowNotification,
            UIKeyboardWillHideNotification,
            UIKeyboardDidHideNotification,
            UIKeyboardWillChangeFrameNotification,
            UIKeyboardDidChangeFrameNotification,
        ];
        for (NSNotificationName name in names) {
            [center addObserver:self
                       selector:@selector(handleKeyboardNotification:)
                           name:name
                         object:nil];
        }
    }
    return self;
}

#pragma mark 几何

- (UIWindow *)hostWindow {
    return self.webView.window;
}

/* 键盘顶边在 window 坐标系中的 y；没有键盘时等于 window 高度 */
- (CGFloat)probeKeyboardTopUsingPresentation:(BOOL)usePresentation {
    UIView *probe = self.probe;
    UIWindow *window = [self hostWindow];
    if (!probe || !window) {
        return window ? CGRectGetHeight(window.bounds) : 0.0;
    }
    CGRect frame = probe.frame;
    if (usePresentation) {
        CALayer *presentation = probe.layer.presentationLayer;
        if (presentation) {
            frame = presentation.frame;
        }
    }
    CGPoint topInWindow = [probe.superview convertPoint:CGPointMake(0.0, CGRectGetMinY(frame)) toView:nil];
    return topInWindow.y;
}

- (CGFloat)keyboardHeightUsingPresentation:(BOOL)usePresentation {
    UIWindow *window = [self hostWindow];
    if (!window) {
        return 0.0;
    }
    CGFloat height = CGRectGetHeight(window.bounds) - [self probeKeyboardTopUsingPresentation:usePresentation];
    return height > 0.0 ? height : 0.0;
}

- (void)installProbeIfNeeded {
    if (self.probe || !self.webView) {
        return;
    }
    UIView *host = self.webView.window.rootViewController.view ?: self.webView.superview;
    if (!host) {
        return;
    }
    UIView *probe = [[UIView alloc] initWithFrame:CGRectZero];
    probe.userInteractionEnabled = NO;
    probe.alpha = 0.0;
    probe.backgroundColor = UIColor.clearColor;
    probe.translatesAutoresizingMaskIntoConstraints = NO;
    [host addSubview:probe];

    UILayoutGuide *guide = host.keyboardLayoutGuide;
    if (@available(iOS 17.0, *)) {
        /* 键盘收起时让导轨落到屏幕最底部，这样"无键盘"就是干净的 0 */
        host.keyboardLayoutGuide.usesBottomSafeArea = NO;
    }
    [NSLayoutConstraint activateConstraints:@[
        [probe.leadingAnchor constraintEqualToAnchor:host.leadingAnchor],
        [probe.widthAnchor constraintEqualToConstant:1.0],
        [probe.heightAnchor constraintEqualToConstant:1.0],
        [probe.topAnchor constraintEqualToAnchor:guide.topAnchor],
    ]];
    self.probe = probe;
    self.probeHost = host;
}

#pragma mark 采样

- (void)startSamplingFor:(NSTimeInterval)seconds {
    self.sampleUntil = MAX(self.sampleUntil, CACurrentMediaTime() + seconds);
    if (self.sampling) {
        return;
    }
    self.sampling = YES;
    /* 新一轮采样前丢掉已经 flush 过的帧：既限住内存，也让 flushFrom 永远是有效下标 */
    if (self.flushFrom > 0 && self.flushFrom <= self.frames.count) {
        [self.frames removeObjectsInRange:NSMakeRange(0, self.flushFrom)];
    }
    self.flushFrom = self.frames.count;
    self.link = [CADisplayLink displayLinkWithTarget:self selector:@selector(tick:)];
    /*
     * ProMotion 机器上 CADisplayLink 默认只跑 60Hz。
     * 实测后果：一次 320ms / 332px 的键盘升起只采到 20 个点，步长 17px，
     * 而键盘自己按 120fps 走——看到的就是台阶而不是"帧率低"。
     * 光设这个区间还不够，Info.plist 必须同时有 CADisableMinimumFrameDurationOnPhone，
     * 否则系统仍然把上限钉在 60Hz。两者缺一不可。
     */
    self.link.preferredFrameRateRange = CAFrameRateRangeMake(60.0, 120.0, 120.0);
    [self.link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}

- (void)stopSampling {
    self.sampling = NO;
    [self.link invalidate];
    self.link = nil;
    [self flushTraceToLog];
}

/*
 * 一次键盘事务结束后把缓冲里的帧打到 stderr。
 *
 * 实测 idevicesyslog 在连续突发下会丢半行（694 行掉了 28 行），所以：
 * 快照先在主线程取好，再挪到后台串行队列逐行打印并留出间隔。
 * 这样既不丢行，也不把打印开销压回被测的主线程。
 */
- (void)flushTraceToLog {
    if (!self.autoLog || self.frames.count <= self.flushFrom) {
        return;
    }
    self.transitionIndex++;
    NSUInteger index = self.transitionIndex;
    NSArray *frames = [self.frames subarrayWithRange:
        NSMakeRange(self.flushFrom, self.frames.count - self.flushFrom)];
    NSUInteger eventStart = MIN(self.eventFlushFrom, self.events.count);
    NSArray *events = [self.events subarrayWithRange:
        NSMakeRange(eventStart, self.events.count - eventStart)];
    self.eventFlushFrom = self.events.count;
    self.flushFrom = self.frames.count;

    NSString *header = [NSString stringWithFormat:
        @"FCKB|begin|%lu|frames=%lu|observersRemoved=%d|clamp=%d|push=%d|resizeWV=%d",
        (unsigned long)index, (unsigned long)frames.count,
        self.observersRemoved, self.clampScrollView, self.pushPerFrame, self.resizeWebViewFrame];

    dispatch_async([FCAKeyboardLab logQueue], ^{
        NSLog(@"%@", header);
        usleep(1200);
        for (NSDictionary *event in events) {
            NSLog(@"FCKB|evt|%lu|%@|target=%.1f|dur=%.3f|curve=%@|local=%@|t=%.1f",
                  (unsigned long)index,
                  [event[@"name"] stringByReplacingOccurrencesOfString:@"UIKeyboard" withString:@""],
                  [event[@"target"] doubleValue], [event[@"duration"] doubleValue],
                  event[@"curve"], event[@"isLocal"], [event[@"t"] doubleValue]);
            usleep(1200);
        }
        for (NSArray *frame in frames) {
            NSLog(@"FCKB|frm|%lu|%.1f|%.2f|%.2f|%.1f|%.1f|%.2f|%.2f|%.2f|%.1f|%.1f",
                  (unsigned long)index,
                  [frame[0] doubleValue], [frame[1] doubleValue], [frame[2] doubleValue],
                  [frame[3] doubleValue], [frame[4] doubleValue], [frame[7] doubleValue],
                  [frame[8] doubleValue], [frame[9] doubleValue], [frame[10] doubleValue],
                  [frame[11] doubleValue]);
            usleep(1200);
        }
        NSLog(@"FCKB|end|%lu", (unsigned long)index);
    });
}

+ (dispatch_queue_t)logQueue {
    static dispatch_queue_t queue;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        queue = dispatch_queue_create("cn.flowcloudai.kblab.log", DISPATCH_QUEUE_SERIAL);
    });
    return queue;
}

- (void)tick:(CADisplayLink *)sender {
    WKWebView *webView = self.webView;
    UIWindow *window = [self hostWindow];
    if (!webView || !window) {
        [self stopSampling];
        return;
    }

    UIScrollView *scrollView = webView.scrollView;

    if (self.clampScrollView) {
        if (!UIEdgeInsetsEqualToEdgeInsets(scrollView.contentInset, UIEdgeInsetsZero)) {
            scrollView.contentInset = UIEdgeInsetsZero;
            self.clampCorrections++;
        }
        if (!CGPointEqualToPoint(scrollView.contentOffset, CGPointZero)) {
            scrollView.contentOffset = CGPointZero;
            self.clampCorrections++;
        }
    }

    CGRect modelFrame = webView.frame;
    CGRect presentationFrame = modelFrame;
    CALayer *presentation = webView.layer.presentationLayer;
    if (presentation) {
        presentationFrame = presentation.frame;
    }

    CGFloat kbModel = [self keyboardHeightUsingPresentation:NO];
    CGFloat kbPresentation = [self keyboardHeightUsingPresentation:YES];

    [self.frames addObject:@[
        @(sender.timestamp * 1000.0),
        @(kbPresentation),
        @(kbModel),
        @(CGRectGetMinY(presentationFrame)),
        @(CGRectGetHeight(presentationFrame)),
        @(CGRectGetMinY(modelFrame)),
        @(CGRectGetHeight(modelFrame)),
        @(scrollView.contentOffset.y),
        @(scrollView.contentInset.bottom),
        @(scrollView.adjustedContentInset.bottom),
        @(scrollView.contentSize.height),
        @(CGRectGetHeight(scrollView.bounds)),
    ]];
    if (self.frames.count > FCAKbLabMaxFrames) {
        NSUInteger dropped = self.frames.count - FCAKbLabMaxFrames;
        [self.frames removeObjectsInRange:NSMakeRange(0, dropped)];
        self.flushFrom = self.flushFrom > dropped ? self.flushFrom - dropped : 0;
    }

    if (self.pushPerFrame && fabs(kbPresentation - self.lastPushedKb) > 0.4) {
        self.lastPushedKb = kbPresentation;
        [self evaluate:[NSString stringWithFormat:
            @"window.__fcKbLab&&window.__fcKbLab.onFrame(%.2f,%.3f);", kbPresentation, sender.timestamp * 1000.0]];
    }

    if (CACurrentMediaTime() > self.sampleUntil) {
        [self stopSampling];
    }
}

#pragma mark 键盘通知

- (void)handleKeyboardNotification:(NSNotification *)notification {
    if (!self.labActive) {
        return;
    }
    UIWindow *window = [self hostWindow];
    NSDictionary *info = notification.userInfo;
    CGRect endFrame = [info[UIKeyboardFrameEndUserInfoKey] CGRectValue];
    CGRect beginFrame = [info[UIKeyboardFrameBeginUserInfoKey] CGRectValue];
    double duration = [info[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
    NSInteger curve = [info[UIKeyboardAnimationCurveUserInfoKey] integerValue];
    BOOL isLocal = [info[UIKeyboardIsLocalUserInfoKey] boolValue];

    CGFloat windowHeight = window ? CGRectGetHeight(window.bounds) : UIScreen.mainScreen.bounds.size.height;
    CGFloat targetHeight = MAX(0.0, windowHeight - CGRectGetMinY(endFrame));
    if ([notification.name isEqualToString:UIKeyboardWillHideNotification]) {
        targetHeight = 0.0;
    }

    [self.events addObject:@{
        @"t": @(CACurrentMediaTime() * 1000.0),
        @"name": notification.name,
        @"beginTop": @(CGRectGetMinY(beginFrame)),
        @"endTop": @(CGRectGetMinY(endFrame)),
        @"endHeight": @(CGRectGetHeight(endFrame)),
        @"target": @(targetHeight),
        @"duration": @(duration),
        @"curve": @(curve),
        @"isLocal": @(isLocal),
        @"windowHeight": @(windowHeight),
    }];
    if (self.events.count > 200) {
        [self.events removeObjectsInRange:NSMakeRange(0, self.events.count - 200)];
    }

    [self startSamplingFor:2.0];

    if (self.resizeWebViewFrame && window) {
        [self applyWebViewResize:targetHeight duration:duration curve:curve];
    }

    NSString *payload = [NSString stringWithFormat:
        @"{name:'%@',target:%.2f,duration:%.4f,curve:%ld,isLocal:%@,endTop:%.2f,endHeight:%.2f,windowHeight:%.2f,t:%.3f}",
        notification.name, targetHeight, duration, (long)curve, isLocal ? @"true" : @"false",
        CGRectGetMinY(endFrame), CGRectGetHeight(endFrame), windowHeight, CACurrentMediaTime() * 1000.0];
    [self evaluate:[NSString stringWithFormat:@"window.__fcKbLab&&window.__fcKbLab.onEvent(%@);", payload]];
}

- (void)applyWebViewResize:(CGFloat)keyboardHeight duration:(double)duration curve:(NSInteger)curve {
    WKWebView *webView = self.webView;
    UIView *host = webView.superview;
    if (!webView || !host) {
        return;
    }
    if (self.originalWebViewHeight <= 0.0) {
        self.originalWebViewHeight = CGRectGetHeight(host.bounds);
    }
    CGRect frame = webView.frame;
    frame.size.height = self.originalWebViewHeight - keyboardHeight;
    UIViewAnimationOptions options = (UIViewAnimationOptions)(curve << 16) | UIViewAnimationOptionBeginFromCurrentState;
    [UIView animateWithDuration:duration
                          delay:0.0
                        options:options
                     animations:^{ webView.frame = frame; }
                     completion:nil];
}

#pragma mark WebKit 自带键盘避让的抑制

- (void)removeWebKitKeyboardObservers {
    WKWebView *webView = self.webView;
    if (!webView || self.observersRemoved) {
        return;
    }
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    /*
     * 只摘 WKWebView 自己注册的这四个。UIKeyboardDidShow 必须保留：
     * WebKit 用它兑现 RevealFocusedElementDeferrer，摘掉会影响焦点元素的显现流程。
     */
    for (NSNotificationName name in @[UIKeyboardWillShowNotification,
                                      UIKeyboardWillHideNotification,
                                      UIKeyboardWillChangeFrameNotification,
                                      UIKeyboardDidChangeFrameNotification]) {
        [center removeObserver:webView name:name object:nil];
    }
    self.observersRemoved = YES;
}

#pragma mark JS 通道

- (void)evaluate:(NSString *)script {
    WKWebView *webView = self.webView;
    if (!webView) {
        return;
    }
    [webView evaluateJavaScript:script completionHandler:nil];
}

- (void)dumpToPage {
    NSDictionary *snapshot = [self snapshot];
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{
        @"frames": self.frames,
        @"events": self.events,
        @"state": snapshot,
    } options:0 error:nil];
    if (!data) {
        return;
    }
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    [self evaluate:[NSString stringWithFormat:@"window.__fcKbLab&&window.__fcKbLab.onDump(%@);", json]];
}

- (NSDictionary *)snapshot {
    WKWebView *webView = self.webView;
    UIWindow *window = [self hostWindow];
    UIScrollView *scrollView = webView.scrollView;
    UIEdgeInsets safe = window ? window.safeAreaInsets : UIEdgeInsetsZero;
    return @{
        @"windowHeight": @(window ? CGRectGetHeight(window.bounds) : 0.0),
        @"windowWidth": @(window ? CGRectGetWidth(window.bounds) : 0.0),
        @"screenScale": @(UIScreen.mainScreen.scale),
        @"webViewFrame": @[@(webView.frame.origin.x), @(webView.frame.origin.y),
                           @(webView.frame.size.width), @(webView.frame.size.height)],
        @"webViewClass": NSStringFromClass(webView.class) ?: @"?",
        @"hostClass": webView.superview ? NSStringFromClass(webView.superview.class) : @"?",
        @"safeArea": @[@(safe.top), @(safe.bottom)],
        @"contentOffsetY": @(scrollView.contentOffset.y),
        @"contentInsetBottom": @(scrollView.contentInset.bottom),
        @"adjustedInsetBottom": @(scrollView.adjustedContentInset.bottom),
        @"contentSizeHeight": @(scrollView.contentSize.height),
        @"insetBehavior": @(scrollView.contentInsetAdjustmentBehavior),
        @"bounces": @(scrollView.bounces),
        @"probeInstalled": @(self.probe != nil),
        @"probeKeyboardHeight": @([self keyboardHeightUsingPresentation:NO]),
        @"observersRemoved": @(self.observersRemoved),
        @"clampScrollView": @(self.clampScrollView),
        @"clampCorrections": @(self.clampCorrections),
        @"pushPerFrame": @(self.pushPerFrame),
        @"resizeWebViewFrame": @(self.resizeWebViewFrame),
        @"frameCount": @(self.frames.count),
        @"systemVersion": UIDevice.currentDevice.systemVersion,
        @"model": UIDevice.currentDevice.model,
    };
}

- (void)userContentController:(__unused WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) {
        return;
    }
    NSDictionary *payload = (NSDictionary *)message.body;
    NSString *command = payload[@"cmd"];
    if (![command isKindOfClass:[NSString class]]) {
        return;
    }
    if (!self.labActive) {
        self.labActive = YES;
        NSLog(@"FCKB|active|webview=%@|host=%@|probe=%d|window=%.0fx%.0f|safeBottom=%.0f",
              NSStringFromClass(self.webView.class),
              self.webView.superview ? NSStringFromClass(self.webView.superview.class) : @"nil",
              self.probe != nil,
              self.webView.window ? CGRectGetWidth(self.webView.window.bounds) : 0.0,
              self.webView.window ? CGRectGetHeight(self.webView.window.bounds) : 0.0,
              self.webView.window ? self.webView.window.safeAreaInsets.bottom : 0.0);
    }

    if ([command isEqualToString:@"configure"]) {
        NSNumber *pushPerFrame = payload[@"pushPerFrame"];
        NSNumber *clamp = payload[@"clampScrollView"];
        NSNumber *resize = payload[@"resizeWebViewFrame"];
        NSNumber *insetNever = payload[@"insetAdjustmentNever"];
        if ([pushPerFrame isKindOfClass:[NSNumber class]]) {
            self.pushPerFrame = pushPerFrame.boolValue;
        }
        if ([clamp isKindOfClass:[NSNumber class]]) {
            self.clampScrollView = clamp.boolValue;
        }
        if ([resize isKindOfClass:[NSNumber class]]) {
            BOOL next = resize.boolValue;
            if (!next && self.resizeWebViewFrame) {
                [self applyWebViewResize:0.0 duration:0.0 curve:0];
            }
            self.resizeWebViewFrame = next;
        }
        if ([insetNever isKindOfClass:[NSNumber class]] && insetNever.boolValue) {
            self.webView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
        }
        if ([payload[@"removeWebKitObservers"] boolValue]) {
            [self removeWebKitKeyboardObservers];
        }
        [self startSamplingFor:1.0];
        [self evaluate:@"window.__fcKbLab&&window.__fcKbLab.onConfigured&&window.__fcKbLab.onConfigured();"];
    } else if ([command isEqualToString:@"dump"]) {
        [self dumpToPage];
    } else if ([command isEqualToString:@"clear"]) {
        [self.frames removeAllObjects];
        [self.events removeAllObjects];
        self.flushFrom = 0;
        self.eventFlushFrom = 0;
        self.clampCorrections = 0;
    } else if ([command isEqualToString:@"sample"]) {
        double seconds = [payload[@"seconds"] doubleValue];
        [self startSamplingFor:seconds > 0.0 ? seconds : 2.0];
    } else if ([command isEqualToString:@"log"]) {
        NSString *text = payload[@"text"];
        if ([text isKindOfClass:[NSString class]]) {
            /* syslog 单行有长度上限，按行切分后再分块 */
            NSArray<NSString *> *lines = [text componentsSeparatedByString:@"\n"];
            dispatch_async([FCAKeyboardLab logQueue], ^{
                for (NSString *line in lines) {
                    if (line.length == 0) continue;
                    NSUInteger cursor = 0;
                    while (cursor < line.length) {
                        NSUInteger length = MIN((NSUInteger)800, line.length - cursor);
                        NSLog(@"FCKB|js|%@", [line substringWithRange:NSMakeRange(cursor, length)]);
                        cursor += length;
                        usleep(1200);
                    }
                }
            });
        }
    } else if ([command isEqualToString:@"autoLog"]) {
        self.autoLog = [payload[@"enabled"] boolValue];
    } else if ([command isEqualToString:@"state"]) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:[self snapshot] options:0 error:nil];
        NSString *json = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
        [self evaluate:[NSString stringWithFormat:@"window.__fcKbLab&&window.__fcKbLab.onState(%@);", json]];
    }
}

@end

static void FCAInstallKeyboardLab(void) {
    FCAKeyboardLab *lab = [FCAKeyboardLab shared];
    NSArray<WKWebView *> *webViews = FCAAllWebViews();
    if (webViews.count == 0) {
        return;
    }
    WKWebView *webView = webViews.firstObject;
    lab.webView = webView;
    [lab installProbeIfNeeded];

    WKUserContentController *controller = webView.configuration.userContentController;
    [controller removeScriptMessageHandlerForName:FCAKbLabHandlerName];
    [controller addScriptMessageHandler:lab name:FCAKbLabHandlerName];
    [lab evaluate:@"window.__fcKbLabNativeReady=true;window.__fcKbLab&&window.__fcKbLab.onNativeReady&&window.__fcKbLab.onNativeReady();"];
}
