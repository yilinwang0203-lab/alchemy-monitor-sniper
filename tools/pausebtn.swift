import AppKit

let workDir = "__WORKDIR__"
let flagPath = "__WORKDIR__/.runtime/PAUSED"
let tunePath = "__WORKDIR__/.runtime/tuning.json"

func sh(_ cmd: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = ["-lc", "export PATH=\"/Users/macmini/.local/share/nodejs/node-v24.22.0-darwin-arm64/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH\"; " + cmd]
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
func readTune() -> (Int, Int) {
    guard let d = FileManager.default.contents(atPath: tunePath),
          let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return (5200, 300) }
    return (j["lead"] as? Int ?? 5200, j["dlgPause"] as? Int ?? 300)
}
func writeTune(_ lead: Int, _ dlg: Int) {
    let j: [String: Any] = ["lead": lead, "dlgPause": dlg]
    if let d = try? JSONSerialization.data(withJSONObject: j) {
        try? d.write(to: URL(fileURLWithPath: tunePath))
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var bCollect: NSButton!, bRaid: NSButton!, bLoop: NSButton!
    var leadLabel: NSTextField!, dlgLabel: NSTextField!
    var label: NSTextField!
    var timer: Timer?

    func applicationDidFinishLaunching(_ n: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 380),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "炼金材料监控抢购"
        window.level = .floating
        window.center()
        window.isReleasedWhenClosed = false
        func mk(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ font: CGFloat, _ t: String, _ a: Selector) -> NSButton {
            let b = NSButton(frame: NSRect(x: x, y: y, width: w, height: h))
            b.bezelStyle = .rounded; b.title = t
            b.font = NSFont.systemFont(ofSize: font, weight: .semibold)
            b.target = self; b.action = a
            window.contentView?.addSubview(b)
            return b
        }
        bCollect = mk(20, 320, 320, 40, 15, "① 灌关注（采集）", #selector(toggleCollect))
        bRaid    = mk(20, 268, 320, 44, 18, "▶︎ 开始抢购", #selector(toggleRaid))
        bLoop    = mk(20, 222, 320, 38, 15, "🔁 循环（灌 → 抢）", #selector(toggleLoop))

        // 提前量：[-] 值 [+]
        _ = mk(20, 172, 46, 34, 20, "−", #selector(leadMinus))
        leadLabel = NSTextField(labelWithString: "提前量 5.2s")
        leadLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        leadLabel.alignment = .center
        leadLabel.frame = NSRect(x: 74, y: 178, width: 212, height: 22)
        window.contentView?.addSubview(leadLabel)
        _ = mk(294, 172, 46, 34, 20, "+", #selector(leadPlus))

        // 弹窗等待：[-] 值 [+]
        _ = mk(20, 128, 46, 34, 20, "−", #selector(dlgMinus))
        dlgLabel = NSTextField(labelWithString: "弹窗等待 0.3s")
        dlgLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        dlgLabel.alignment = .center
        dlgLabel.frame = NSRect(x: 74, y: 134, width: 212, height: 22)
        window.contentView?.addSubview(dlgLabel)
        _ = mk(294, 128, 46, 34, 20, "+", #selector(dlgPlus))

        label = NSTextField(labelWithString: "")
        label.font = NSFont.systemFont(ofSize: 12); label.alignment = .center
        label.frame = NSRect(x: 20, y: 20, width: 320, height: 96)
        label.maximumNumberOfLines = 5
        label.lineBreakMode = .byWordWrapping
        window.contentView?.addSubview(label)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in self.refresh() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return true
    }

    func killAll(_ extra: String = "") {
        sh("cd '\(workDir)' && { pkill -f \"loop[.]sh\"; pkill -f \"raidb[.]mjs\"; pkill -f \"collect3[.]mjs\"; rm -f .runtime/PAUSED; } ; \(extra)")
    }

    @objc func toggleCollect() {
        if running("collect3.mjs") { sh("pkill -f \"collect3[.]mjs\""); return }
        killAll("sleep 0.5; OCR_BIN='\(workDir)/ocrl' nohup node collect3.mjs >> .runtime/btn.log 2>&1 &")
    }
    @objc func toggleRaid() {
        let fm = FileManager.default
        if fm.fileExists(atPath: flagPath) {
            try? fm.removeItem(atPath: flagPath)
            if !running("raidb.mjs") {
                killAll("sleep 0.5; OCR_BIN='\(workDir)/ocrl' nohup node raidb.mjs >> .runtime/btn.log 2>&1 &")
            }
        } else if running("raidb.mjs") {
            fm.createFile(atPath: flagPath, contents: Data())
        } else {
            killAll("sleep 0.5; OCR_BIN='\(workDir)/ocrl' nohup node raidb.mjs >> .runtime/btn.log 2>&1 &")
        }
    }
    @objc func toggleLoop() {
        if running("loop.sh") { killAll(); return }
        killAll("sleep 0.5; nohup ./loop.sh >> .runtime/loop.log 2>&1 &")
    }

    @objc func leadMinus() { let (l, d) = readTune(); writeTune(max(0, l - 100), d) }
    @objc func leadPlus()  { let (l, d) = readTune(); writeTune(l + 100, d) }
    @objc func dlgMinus()  { let (l, d) = readTune(); writeTune(l, max(0, d - 100)) }
    @objc func dlgPlus()   { let (l, d) = readTune(); writeTune(l, d + 100) }

    func refresh() {
        let paused = FileManager.default.fileExists(atPath: flagPath)
        let coll = running("collect3.mjs"), raid = running("raidb.mjs"), loop = running("loop.sh")

        bCollect.title = coll ? "⏹ 暂停采集" : "① 灌关注（采集）"
        bCollect.contentTintColor = coll ? .systemOrange : .systemBlue
        bLoop.title = loop ? "⏹ 停止循环" : "🔁 循环（灌 → 抢）"
        bLoop.contentTintColor = loop ? .systemOrange : .systemIndigo
        if raid || paused {
            bRaid.title = paused ? "▶︎  继续抢购" : "⏸  暂停抢购"
            bRaid.contentTintColor = paused ? .systemGreen : .systemRed
        } else {
            bRaid.title = "▶︎  开始抢购"; bRaid.contentTintColor = .systemGreen
        }

        let (l, d) = readTune()
        leadLabel.stringValue = String(format: "提前量 %.1fs", Double(l) / 1000.0)
        dlgLabel.stringValue = String(format: "弹窗等待 %.1fs", Double(d) / 1000.0)

        if loop { label.stringValue = coll ? "循环中：正在采集" : "循环中：正在抢购" }
        else if coll { label.stringValue = "正在采集" }
        else if paused { label.stringValue = "已暂停" }
        else { label.stringValue = raid ? "抢购运行中" : "未运行" }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
