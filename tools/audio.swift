// 从视频里提取音轨为 16bit 单声道 WAV
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else { print("用法: audio <视频> <输出.wav>"); exit(1) }
let url = URL(fileURLWithPath: args[1])
let out = URL(fileURLWithPath: args[2])

let asset = AVURLAsset(url: url)
guard let track = asset.tracks(withMediaType: .audio).first else { print("没有音轨"); exit(2) }

let reader = try! AVAssetReader(asset: asset)
let settings: [String: Any] = [
    AVFormatIDKey: kAudioFormatLinearPCM,
    AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsFloatKey: false,
    AVLinearPCMIsBigEndianKey: false,
    AVLinearPCMIsNonInterleaved: false,
    AVNumberOfChannelsKey: 1,
    AVSampleRateKey: 44100
]
let output = try! AVAssetReaderTrackOutput(track: track, outputSettings: settings)
reader.add(output)
reader.startReading()

var samples = [Int16]()
while let buf = output.copyNextSampleBuffer() {
    guard let block = CMSampleBufferGetDataBuffer(buf) else { continue }
    var len = 0; var ptr: UnsafeMutablePointer<Int8>?
    CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &len, dataPointerOut: &ptr)
    if let p = ptr {
        let n = len / 2
        p.withMemoryRebound(to: Int16.self, capacity: n) { sp in
            for i in 0..<n { samples.append(sp[i]) }
        }
    }
}
reader.cancelReading()

// 写 WAV
var data = Data()
func append32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
func append16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
let byteRate = UInt32(44100 * 2)
data.append("RIFF".data(using: .ascii)!); append32(UInt32(36 + samples.count*2))
data.append("WAVEfmt ".data(using: .ascii)!); append32(16); append16(1); append16(1)
append32(44100); append32(byteRate); append16(2); append16(16)
data.append("data".data(using: .ascii)!); append32(UInt32(samples.count*2))
samples.withUnsafeBufferPointer { data.append(Data(bytes: $0.baseAddress!, count: samples.count*2)) }
try! data.write(to: out)
print("已写出 \(out.path)，\(samples.count) 个采样点（\(Double(samples.count)/44100.0) 秒）")
