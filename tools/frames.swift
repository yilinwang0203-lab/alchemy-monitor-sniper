import Foundation
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

// usage: frames <video> <outdir> <fps> [start] [end] [maxWidth]
let argv = CommandLine.arguments
guard argv.count >= 4 else {
    FileHandle.standardError.write("usage: frames <video> <outdir> <fps> [start] [end] [maxWidth]\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: argv[1])
let outDir = URL(fileURLWithPath: argv[2])
let fps = max(0.1, Double(argv[3]) ?? 1)
let start = argv.count > 4 ? (Double(argv[4]) ?? 0) : 0
var end = argv.count > 5 ? (Double(argv[5]) ?? -1) : -1
let maxW = argv.count > 6 ? (Int(argv[6]) ?? 1280) : 1280

let asset = AVURLAsset(url: url)
let dur = CMTimeGetSeconds(asset.duration)
if end <= 0 { end = dur }

if let track = asset.tracks(withMediaType: .video).first {
    let sz = track.naturalSize.applying(track.preferredTransform)
    print("duration=\(String(format: "%.2f", dur)) size=\(Int(abs(sz.width)))x\(Int(abs(sz.height))) nomfps=\(String(format: "%.1f", track.nominalFrameRate))")
} else {
    print("duration=\(String(format: "%.2f", dur))")
}

try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: maxW, height: maxW)

let step = 1.0 / fps
var t = start
var n = 0
while t < end {
    let time = CMTime(seconds: t, preferredTimescale: 600)
    do {
        let cg = try gen.copyCGImage(at: time, actualTime: nil)
        let name = String(format: "f_%06.2f.jpg", t)
        let out = outDir.appendingPathComponent(name)
        guard let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { continue }
        CGImageDestinationAddImage(dest, cg, [kCGImageDestinationLossyCompressionQuality: 0.72] as CFDictionary)
        CGImageDestinationFinalize(dest)
        n += 1
    } catch {
        FileHandle.standardError.write("t=\(t) \(error.localizedDescription)\n".data(using: .utf8)!)
    }
    t += step
}
print("wrote \(n) frames to \(outDir.path)")
