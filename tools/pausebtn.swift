import AppKit

let workDir = "__WORKDIR__"
let flagPath = "__WORKDIR__/.runtime/PAUSED"

func uiLog(_ msg: String) {
    let line = "\(Date().description(with: .current)) \(msg)\n"
    let path = workDir + "/.runtime/ui.log"
    if let h = FileHandle(forWritingAtPath: path) {
        h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); h.closeFile()
    } else {
        try? line.write(toFile: path, atomically: true, encoding: .utf8)
    }
}

func sh(_ cmd: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = ["-lc", "export PATH=\"__NODEBIN__:/usr/bin:/bin:/usr/sbin:/sbin:$PATH\"; " + cmd]
    try? p.run()
}
func running(_ pat: String) -> Bool {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    p.arguments = ["-f", pat]
    p.standardOutput = Pipe(); p.standardError = Pipe()
    try? p.run(); p.waitUntilExit()
    return p.terminationStatus == 0
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var bCollect: NSButton!, bRaid: NSButton!, bLoop: NSButton!
    var label: NSTextField!
    var timer: Timer?

    func applicationDidFinishLaunching(_ n: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 250),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "三角洲抢购"
        window.level = .floating
        window.center()
        window.isReleasedWhenClosed = false
        func mk(_ y: CGFloat, _ h: CGFloat, _ font: CGFloat, _ action: Selector) -> NSButton {
            let b = NSButton(frame: NSRect(x: 20, y: y, width: 280, height: h))
            b.bezelStyle = .rounded
            b.font = NSFont.systemFont(ofSize: font, weight: .semibold)
            b.target = self; b.action = action
            window.contentView?.addSubview(b)
            return b
        }
        bCollect = mk(178, 42, 15, #selector(toggleCollect))
        bRaid    = mk(122, 46, 18, #selector(toggleRaid))
        bLoop    = mk(72,  42, 15, #selector(toggleLoop))
        label = NSTextField(labelWithString: "")
        label.font = NSFont.systemFont(ofSize: 12)
        label.alignment = .center
        label.frame = NSRect(x: 20, y: 20, width: 280, height: 40)
        label.maximumNumberOfLines = 2
        label.lineBreakMode = .byWordWrapping
        window.contentView?.addSubview(label)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in self.refresh() }
    }

    // 点 Dock 图标 → 重新显示窗口
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    func stopAll() {
        sh("pkill -f \"loop[.]sh\"; pkill -f \"raidb[.]mjs\"; pkill -f \"collect3[.]mjs\"")
        try? FileManager.default.removeItem(atPath: flagPath)
    }

    @objc func toggleCollect() {
        if running("collect3.mjs") { sh("pkill -f \"collect3[.]mjs\""); return }
        sh("cd '\(workDir)' && { pkill -f \"loop[.]sh\"; pkill -f \"raidb[.]mjs\"; rm -f .runtime/PAUSED; } ; sleep 0.5; OCR_BIN='\(workDir)/ocrl' nohup node collect3.mjs >> .runtime/btn.log 2>&1 &")
    }
    @objc func toggleRaid() {
        let fm = FileManager.default
        if fm.fileExists(atPath: flagPath) {                 // 暂停中 → 继续
            try? fm.removeItem(atPath: flagPath)
            if !running("raidb.mjs") {
                sh("pkill -f loop.sh; pkill -f collect3.mjs")
                sh("cd '\(workDir)' && OCR_BIN='\(workDir)/ocrl' nohup node raidb.mjs >> .runtime/btn.log 2>&1 &")
            }
        } else if running("raidb.mjs") {
            fm.createFile(atPath: flagPath, contents: Data()) // 运行中 → 暂停
        } else {
            sh("pkill -f loop.sh; pkill -f collect3.mjs")
            sh("cd '\(workDir)' && OCR_BIN='\(workDir)/ocrl' nohup node raidb.mjs >> .runtime/btn.log 2>&1 &")
        }
    }
    @objc func toggleLoop() {
        let wasRunning = running("loop.sh")
        uiLog("点击循环：当前 running=\(wasRunning)")
        if wasRunning { sh("pkill -f \"loop[.]sh\"; pkill -f \"raidb[.]mjs\"; pkill -f \"collect3[.]mjs\""); uiLog("已停止循环"); return }
        sh("cd '\(workDir)' && { pkill -f \"loop[.]sh\"; pkill -f \"raidb[.]mjs\"; pkill -f \"collect3[.]mjs\"; rm -f .runtime/PAUSED; } ; sleep 0.5; nohup ./loop.sh >> .runtime/loop.log 2>&1 &")
        uiLog("已发出启动命令")
    }

    func refresh() {
        let paused = FileManager.default.fileExists(atPath: flagPath)
        let coll = running("collect3.mjs"), raid = running("raidb.mjs"), loop = running("loop.sh")

        bCollect.title = coll ? "⏹ 暂停采集" : "① 灌关注（采集 50 件）"
        bCollect.contentTintColor = coll ? .systemOrange : .systemBlue
        bLoop.title = loop ? "⏹ 停止循环" : "🔁 循环（灌 → 抢 → 没货再灌）"
        bLoop.contentTintColor = loop ? .systemOrange : .systemIndigo

        if raid || paused {
            bRaid.title = paused ? "▶︎  继续抢购" : "⏸  暂停抢购"
            bRaid.contentTintColor = paused ? .systemGreen : .systemRed
        } else {
            bRaid.title = "▶︎  开始抢购"
            bRaid.contentTintColor = .systemGreen
        }

        if loop { label.stringValue = coll ? "循环中：正在采集" : "循环中：正在抢购" }
        else if coll { label.stringValue = "正在采集（再点上面可暂停）" }
        else if paused { label.stringValue = "已暂停" }
        else { label.stringValue = raid ? "抢购运行中" : "未运行" }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
