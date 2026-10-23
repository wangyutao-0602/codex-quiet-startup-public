import AppKit
import WebKit
import UniformTypeIdentifiers

// A short-lived, local-only player. No CDP, theme daemon, or changes to Codex.
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var target: NSRunningApplication?
    private var launchMode = false
    private var animationDone = false
    private var opening = false
    private var terminating = false
    private var watchdog: Timer?
    private var previewFrame: NSRect?
    private let smokeTest = CommandLine.arguments.contains("--smoke-test")
    private var smokePassed = false
    private var shouldLaunch: Bool {
        if smokeTest || CommandLine.arguments.contains("--preview") || CommandLine.arguments.contains("--settings") { return false }
        return CommandLine.arguments.contains("--launch") || Bundle.main.object(forInfoDictionaryKey: "QuietStartupLaunchByDefault") as? Bool == true
    }
    private var snapshotPath: String? {
        guard let i = CommandLine.arguments.firstIndex(of: "--snapshot"), i + 1 < CommandLine.arguments.count else { return nil }
        return CommandLine.arguments[i + 1]
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let menu = NSMenu()
        let item = NSMenuItem(); menu.addItem(item)
        let appMenu = NSMenu(); item.submenu = appMenu
        appMenu.addItem(withTitle: "退出Codex Quiet Startup", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        NSApp.mainMenu = menu

        let available = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width = min(1000, available.width - 80, (available.height - 80) * 1.52)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: width / 1.52), styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Codex · Quiet Intelligence"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.backgroundColor = .clear
        window.isOpaque = false
        window.delegate = self
        window.center()

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(self, name: "launcher")
        if !smokeTest && CommandLine.arguments.contains("--full-motion") {
            configuration.userContentController.addUserScript(WKUserScript(source: "window.AEMEATH_FULL_MOTION=true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // WKWebView file origins can taint Canvas. A data URL keeps pixel reads local and origin-clean.
        if let url = Bundle.main.resourceURL?.appendingPathComponent("web/assets/character.png"),
           let data = try? Data(contentsOf: url) {
            let source = "window.AEMEATH_ASSETS={character:'data:image/png;base64,\(data.base64EncodedString())'};"
            configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if smokeTest {
            if CommandLine.arguments.contains("--full-motion") {
                let motionScript = """
                const systemMatchMedia=window.matchMedia.bind(window);
                window.matchMedia=query=>{const result=systemMatchMedia(query);if(query==='(prefers-reduced-motion: reduce)')Object.defineProperty(result,'matches',{value:false});return result;};
                """
                configuration.userContentController.addUserScript(WKUserScript(source: motionScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            let profileScript = """
            window.__startupProfile={draw:[],gaps:[],last:0};
            const nativeRAF=window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame=callback=>nativeRAF(now=>{
              const start=performance.now();callback(now);
              const elapsed=Number(document.querySelector('.window')?.dataset.elapsed||0),p=window.__startupProfile;
              if(elapsed>=6.8&&elapsed<=8.98){p.draw.push(performance.now()-start);if(p.last)p.gaps.push(now-p.last);p.last=now;}
            });
            """
            configuration.userContentController.addUserScript(WKUserScript(source: profileScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView!.addSubview(webView)
        guard let resources = Bundle.main.resourceURL else { NSApp.terminate(nil); return }
        let page = resources.appendingPathComponent("web/index.html")
        webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        // An unresponsive renderer must never leave a blocking splash indefinitely.
        watchdog = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in
            guard let self else { return }
            if self.launchMode { self.revealAndQuit() }
            else if self.smokeTest { print("SMOKE FAIL: renderer timeout"); NSApp.terminate(nil) }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let action = message.body as? String else { return }
        switch action {
        case "ready":
            print("PLAYER READY")
            if smokeTest { webView.evaluateJavaScript("window.addEventListener('error', event => window.webkit.messageHandlers.launcher.postMessage('SMOKE JS ERROR: ' + event.message))") }
            if CommandLine.arguments.contains("--settings") { webView.evaluateJavaScript("window.launcherUI.openSettings()") }
            if shouldLaunch { startLaunch() }
            if let path = snapshotPath {
                for (index, seconds) in [0.5, 3.0, 4.22, 4.34, 4.55, 6.1, 7.5].enumerated() {
                    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in self?.snapshot(to: path.replacingOccurrences(of: ".png", with: "-\(index).png")) }
                }
            }
        case "settings-open": watchdog?.invalidate()
        case "settings-close":
            if launchMode { watchdog = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in self?.revealAndQuit() } }
        case "launch": if !smokeTest { startLaunch() }
        case "reveal":
            // Legacy renderer notification: keep Codex behind the splash until completion.
            break
        case "complete":
            animationDone = true
            print("ANIMATION COMPLETE")
            if launchMode { finishIfReady() }
            else if smokeTest {
                webView.evaluateJavaScript("JSON.stringify({elapsed:document.querySelector('.window').dataset.elapsed,playing:document.querySelector('.window').dataset.playing,completed:document.querySelector('.window').dataset.completed,canvas:document.querySelector('.line-art').dataset,profile:window.__startupProfile})") { result, error in
                    print("SMOKE RESULT: \(result ?? "missing") \(error?.localizedDescription ?? "")")
                    if let json = result as? String, let data = json.data(using: .utf8),
                       let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                       let canvas = record["canvas"] as? [String: Any] {
                        self.smokePassed = error == nil && record["completed"] as? String == "true"
                            && record["playing"] as? String == "false"
                            && (Int(canvas["imageWidth"] as? String ?? "0") ?? 0) > 0
                            && (Int(canvas["paths"] as? String ?? "0") ?? 0) > 0
                    }
                    print(self.smokePassed ? "SMOKE PASS" : "SMOKE FAIL")
                    NSApp.terminate(nil)
                }
            }
        case "assetError":
            print("ASSET ERROR")
            if launchMode { revealAndQuit() }
            else if smokeTest { NSApp.terminate(nil) }
        default:
            if smokeTest && action.hasPrefix("SMOKE JS ERROR:") { print(action); NSApp.terminate(nil) }
        }
    }

    private func startLaunch() {
        guard !opening && !launchMode else { return }
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.openai.codex") else {
            reportError("没有找到已安装的 Codex / ChatGPT 桌面应用。"); return
        }
        launchMode = true; opening = true; animationDone = false
        previewFrame = window.frame
        if let screen = window.screen ?? NSScreen.main {
            window.styleMask = [.borderless]
            window.setFrame(screen.frame, display: true)
            NSApp.presentationOptions = [.autoHideDock, .autoHideMenuBar]
        }
        window.level = .floating
        webView.evaluateJavaScript("window.launcherUI.beginLaunch()")
        watchdog?.invalidate()
        watchdog = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in self?.revealAndQuit() }
        if let existing = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex").first {
            target = existing
            existing.hide()
            print("CODEX REUSED; hidden=\(existing.isHidden)")
            opening = false
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.hides = true
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { [weak self] app, error in
            DispatchQueue.main.async {
                guard let self else { app?.unhide(); return }
                self.opening = false
                if let error {
                    self.launchMode = false
                    self.window.level = .normal
                    self.restorePreviewWindow()
                    self.watchdog?.invalidate()
                    self.reportError("启动失败：\(error.localizedDescription)")
                    return
                }
                self.target = app
                if self.terminating { app?.unhide(); app?.activate(options: [.activateAllWindows]); return }
                app?.hide()
                self.finishIfReady()
            }
        }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .webP]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    private func finishIfReady() {
        guard animationDone else { return }
        guard !opening, let target, !target.isTerminated else {
            webView.evaluateJavaScript("window.launcherUI.waiting()")
            return
        }
        // LaunchServices completion confirms app launch, not renderer/chat readiness.
        revealAndQuit()
    }

    private func revealAndQuit() {
        guard !terminating else { return }
        terminating = true
        watchdog?.invalidate()
        // Remove the splash before activating Codex: no overlapping crossfade windows.
        window.orderOut(nil)
        NSApp.presentationOptions = []
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.openai.codex") else {
            handoffFailed("找不到官方 Codex 应用。"); return
        }
        // Reopen through LaunchServices, including when the app is running without a window.
        // Keep this process alive until the asynchronous activation has actually completed.
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.hides = false
        watchdog = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
            self?.handoffFailed("Codex 窗口交接超时。请从官方应用图标打开后重试。")
        }
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { [weak self] app, error in
            DispatchQueue.main.async {
                guard let self, self.terminating else { return }
                if let error { self.handoffFailed("打开 Codex 失败：\(error.localizedDescription)"); return }
                guard let app else { self.handoffFailed("系统没有返回 Codex 进程。"); return }
                self.target = app
                app.unhide()
                app.activate(options: [.activateAllWindows])
                self.verifyHandoff(attempt: 0)
            }
        }
    }

    private func verifyHandoff(attempt: Int) {
        guard terminating else { return }
        if let target, !target.isTerminated, !target.isHidden, target.isActive {
            print("HANDOFF VERIFIED; hidden=false; active=true; pid=\(target.processIdentifier)")
            watchdog?.invalidate()
            NSApp.terminate(nil)
            return
        }
        guard attempt < 40 else {
            handoffFailed("Codex 已启动，但没有成功显示在前台。请从官方应用图标打开后重试。")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.verifyHandoff(attempt: attempt + 1)
        }
    }

    private func handoffFailed(_ message: String) {
        print("HANDOFF FAILED: \(message)")
        watchdog?.invalidate()
        target?.unhide()
        terminating = false
        launchMode = false
        opening = false
        window.level = .normal
        restorePreviewWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        reportError(message)
    }

    private func restorePreviewWindow() {
        NSApp.presentationOptions = []
        window.styleMask = [.titled, .closable, .miniaturizable, .fullSizeContentView]
        if let previewFrame { window.setFrame(previewFrame, display: true) }
    }

    private func reportError(_ message: String) {
        let data = try! JSONSerialization.data(withJSONObject: [message])
        let json = String(data: data, encoding: .utf8)!
        webView.evaluateJavaScript("window.launcherUI.error(\(json)[0])")
    }

    private func snapshot(to path: String) {
        webView.takeSnapshot(with: nil) { image, error in
            guard let data = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) else {
                print("SNAPSHOT ERROR: \(error?.localizedDescription ?? "no image")"); return
            }
            do { try png.write(to: URL(fileURLWithPath: path)); print("SNAPSHOT SAVED") }
            catch { print("SNAPSHOT ERROR: \(error.localizedDescription)") }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if launchMode { revealAndQuit() }
        else { print("RENDERER TERMINATED"); NSApp.terminate(nil) }
    }
    func windowWillClose(_ notification: Notification) {
        if launchMode {
            animationDone = true
            finishIfReady()
        } else { NSApp.terminate(nil) }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Do not abandon a pending LaunchServices callback with the target hidden.
        if opening && launchMode && !terminating {
            animationDone = true
            window.orderOut(nil)
            return .terminateCancel
        }
        return .terminateNow
    }
    func applicationWillTerminate(_ notification: Notification) {
        terminating = true
        watchdog?.invalidate()
        if launchMode { target?.unhide() }
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "launcher")
        if smokeTest && !smokePassed { exit(1) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
