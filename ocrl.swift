import Foundation
import Vision
import ImageIO

// 常驻 OCR：从 stdin 逐行读图片路径，逐行输出 JSON。省掉每次起进程的 ~200ms。
func recognize(_ rect: CGRect, _ image: CGImage) throws -> [[String: Any]] {
    let pixels = CGRect(x: rect.minX * Double(image.width), y: rect.minY * Double(image.height),
                        width: rect.width * Double(image.width), height: rect.height * Double(image.height))
    guard let cropped = image.cropping(to: pixels) else { return [] }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: cropped, options: [:]).perform([request])
    return (request.results ?? []).compactMap { o in
        guard let c = o.topCandidates(1).first else { return nil }
        let b = o.boundingBox
        return ["text": c.string, "confidence": c.confidence,
                "x": rect.minX + b.minX * rect.width, "y": rect.minY + (1-b.maxY) * rect.height,
                "width": b.width * rect.width, "height": b.height * rect.height]
    }
}

// 数一小块区域里"金色"像素的个数（判断星标是否已收藏）
func goldCount(_ rect: CGRect, _ image: CGImage) -> Int {
    let px = CGRect(x: rect.minX * Double(image.width), y: rect.minY * Double(image.height),
                    width: max(1, rect.width * Double(image.width)), height: max(1, rect.height * Double(image.height)))
    guard let crop = image.cropping(to: px) else { return 0 }
    let w = crop.width, h = crop.height
    var buf = [UInt8](repeating: 0, count: w*h*4)
    guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w*4,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 0 }
    ctx.draw(crop, in: CGRect(x: 0, y: 0, width: w, height: h))
    var n = 0
    for i in stride(from: 0, to: buf.count, by: 4) {
        let r = Int(buf[i]), g = Int(buf[i+1]), b = Int(buf[i+2])
        if r > 150 && g > 110 && b < 120 { n += 1 }
    }
    return n
}

while let line = readLine() {
    let path = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if path.isEmpty { continue }
    do {
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
            print("{\"error\":\"decode\"}"); fflush(stdout); continue
        }
        let out: [String: Any] = [
            "width": img.width, "height": img.height,
            "lines": try recognize(CGRect(x:0.55,y:0.165,width:0.39,height:0.685), img),
            "title": try recognize(CGRect(x:0.29,y:0.165,width:0.34,height:0.065), img),
            "list": try recognize(CGRect(x:0.125,y:0.20,width:0.155,height:0.72), img),
            "timerLines": try recognize(CGRect(x:0.762,y:0.79,width:0.155,height:0.045), img),
            "headerLines": try recognize(CGRect(x:0.055,y:0.015,width:0.21,height:0.06), img),
            "priceL": try recognize(CGRect(x:0.30,y:0.13,width:0.15,height:0.74), img),
            "priceR": try recognize(CGRect(x:0.56,y:0.13,width:0.15,height:0.74), img),
            "starGold": goldCount(CGRect(x:0.875,y:0.179,width:0.017,height:0.032), img),
            "count": try recognize(CGRect(x:0.12,y:0.885,width:0.13,height:0.035), img)
        ]
        let d = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
        print(String(data: d, encoding: .utf8)!); fflush(stdout)
    } catch {
        print("{\"error\":\"\(error.localizedDescription)\"}"); fflush(stdout)
    }
}
