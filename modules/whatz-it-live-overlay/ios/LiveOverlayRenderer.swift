import CoreGraphics
import CoreImage
import Foundation
import UIKit

struct NativeLiveOverlayEvent {
  let atMs: Double
  let kind: String
  let text: String
  let byline: String?
  let timerEndsAtMs: Double?
}

final class LiveOverlayRenderer {
  private let headshot: UIImage?
  private let wordmark: UIImage?
  private var cachedKey: String?
  private var cachedImage: CIImage?

  init(headshotPath: String?, wordmarkPath: String?) {
    headshot = Self.loadImage(headshotPath)
    wordmark = Self.loadImage(wordmarkPath)
  }

  func image(event: NativeLiveOverlayEvent?, elapsedMs: Double, size: CGSize) -> CIImage? {
    let remainingSeconds = event.flatMap { event -> Int? in
      guard Self.shouldShowTimer(event), let timerEndsAtMs = event.timerEndsAtMs else { return nil }
      return max(0, Int(ceil((timerEndsAtMs - elapsedMs) / 1_000)))
    }
    let key = [
      String(Int(size.width)),
      String(Int(size.height)),
      event?.kind ?? "none",
      event?.text ?? "",
      event?.byline ?? "",
      remainingSeconds.map(String.init) ?? "",
    ].joined(separator: "|")
    if key == cachedKey { return cachedImage }

    cachedKey = key
    cachedImage = makeImage(event: event, remainingSeconds: remainingSeconds, size: size)
    return cachedImage
  }

  private func makeImage(
    event: NativeLiveOverlayEvent?,
    remainingSeconds: Int?,
    size: CGSize
  ) -> CIImage? {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      drawBranding(size: size)
      guard let event else { return }
      drawEvent(event, remainingSeconds: remainingSeconds, size: size)
    }
    guard let cgImage = image.cgImage else { return nil }
    return CIImage(cgImage: cgImage)
  }

  private func drawBranding(size: CGSize) {
    guard headshot != nil || wordmark != nil else { return }
    let margin = size.height * 0.035
    let gap = size.height * 0.01
    let headshotHeight = headshot == nil ? 0 : size.height * 0.144
    let headshotWidth = headshot.map {
      headshotHeight * ($0.size.width / max(1, $0.size.height))
    } ?? 0
    let wordmarkWidth = wordmark == nil ? 0 : size.height * 0.288
    let wordmarkHeight = wordmark.map {
      wordmarkWidth * ($0.size.height / max(1, $0.size.width))
    } ?? 0
    let actualGap = headshot != nil && wordmark != nil ? gap : 0
    let height = max(headshotHeight, wordmarkHeight)

    if let headshot {
      headshot.draw(
        in: CGRect(
          x: margin,
          y: margin + (height - headshotHeight) / 2,
          width: headshotWidth,
          height: headshotHeight
        ),
        blendMode: .normal,
        alpha: 0.92
      )
    }
    if let wordmark {
      wordmark.draw(
        in: CGRect(
          x: margin + headshotWidth + actualGap,
          y: margin + (height - wordmarkHeight) / 2,
          width: wordmarkWidth,
          height: wordmarkHeight
        ),
        blendMode: .normal,
        alpha: 0.92
      )
    }
  }

  private func drawEvent(
    _ event: NativeLiveOverlayEvent,
    remainingSeconds: Int?,
    size: CGSize
  ) {
    let text = event.text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    let byline = event.byline.map {
      $0.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }.flatMap { $0.isEmpty ? nil : "by \($0)" }
    let timerText = remainingSeconds.map(Self.formatRoundClock)
    let referenceEdge = min(size.width, size.height)
    let sideMargin = size.height > size.width ? size.width * 0.05 : 0
    let maximumCardWidth = size.width - sideMargin * 2
    let horizontalPadding = max(size.width * 0.0198, referenceEdge * 0.035)
    let verticalPadding = referenceEdge * 0.0154
    let maximumTextWidth = max(1, maximumCardWidth - horizontalPadding * 2)

    var fontSize = referenceEdge * 0.056
    var font = UIFont.systemFont(ofSize: fontSize, weight: .black)
    var textSize = (text as NSString).size(withAttributes: [.font: font])
    while textSize.width > maximumTextWidth && fontSize > 1 {
      fontSize = max(1, fontSize - 1)
      font = UIFont.systemFont(ofSize: fontSize, weight: .black)
      textSize = (text as NSString).size(withAttributes: [.font: font])
    }

    let bylineFont: UIFont?
    let bylineSize: CGSize
    if let byline {
      var candidateSize = referenceEdge * 0.035
      var candidate = UIFont.systemFont(ofSize: candidateSize, weight: .semibold)
      var measured = (byline as NSString).size(withAttributes: [.font: candidate])
      while measured.width > maximumTextWidth && candidateSize > 1 {
        candidateSize = max(1, candidateSize - 1)
        candidate = UIFont.systemFont(ofSize: candidateSize, weight: .semibold)
        measured = (byline as NSString).size(withAttributes: [.font: candidate])
      }
      bylineFont = candidate
      bylineSize = measured
    } else {
      bylineFont = nil
      bylineSize = .zero
    }

    let timerFont = timerText == nil
      ? nil
      : UIFont.systemFont(ofSize: referenceEdge * 0.0308, weight: .heavy)
    let timerSize = timerText.map {
      ($0 as NSString).size(withAttributes: [.font: timerFont!])
    } ?? .zero
    let width = min(
      maximumCardWidth,
      max(
        size.width * 0.3,
        ceil(max(textSize.width, max(bylineSize.width, timerSize.width))) + horizontalPadding * 2
      )
    )
    let bylineSpacing = byline == nil ? 0 : referenceEdge * 0.0051
    let timerSpacing = timerText == nil ? 0 : referenceEdge * 0.0051
    let contentHeight = font.lineHeight
      + (bylineFont?.lineHeight ?? 0)
      + bylineSpacing
      + (timerFont?.lineHeight ?? 0)
      + timerSpacing
    let height = max(referenceEdge * 0.123, ceil(contentHeight) + verticalPadding * 2)
    let frame = CGRect(
      x: (size.width - width) / 2,
      y: size.height - height - size.height * 0.133,
      width: width,
      height: height
    )
    let palette = Self.colors(event.kind)
    palette.background.setFill()
    UIBezierPath(
      roundedRect: frame,
      cornerRadius: min(frame.width, frame.height) * 0.25
    ).fill()

    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.lineBreakMode = .byClipping
    let availableTextWidth = frame.width - horizontalPadding * 2
    let textHeight = ceil(font.lineHeight)
    let bylineHeight = bylineFont.map { ceil($0.lineHeight) } ?? 0
    let timerHeight = timerFont.map { ceil($0.lineHeight) } ?? 0
    let actualContentHeight = textHeight + bylineSpacing + bylineHeight + timerSpacing + timerHeight
    let contentTop = frame.minY + (frame.height - actualContentHeight) / 2

    NSAttributedString(
      string: text,
      attributes: [
        .font: font,
        .foregroundColor: palette.foreground,
        .paragraphStyle: paragraph,
      ]
    ).draw(
      with: CGRect(
        x: frame.minX + horizontalPadding,
        y: contentTop,
        width: availableTextWidth,
        height: textHeight
      ),
      options: [.usesLineFragmentOrigin, .usesFontLeading],
      context: nil
    )

    if let byline, let bylineFont {
      NSAttributedString(
        string: byline,
        attributes: [
          .font: bylineFont,
          .foregroundColor: palette.foreground.withAlphaComponent(0.72),
          .paragraphStyle: paragraph,
        ]
      ).draw(
        with: CGRect(
          x: frame.minX + horizontalPadding,
          y: contentTop + textHeight + bylineSpacing,
          width: availableTextWidth,
          height: bylineHeight
        ),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        context: nil
      )
    }

    if let timerText, let timerFont {
      NSAttributedString(
        string: timerText,
        attributes: [
          .font: timerFont,
          .foregroundColor: palette.foreground,
          .paragraphStyle: paragraph,
        ]
      ).draw(
        with: CGRect(
          x: frame.minX + horizontalPadding,
          y: contentTop + textHeight + bylineSpacing + bylineHeight + timerSpacing,
          width: availableTextWidth,
          height: timerHeight
        ),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        context: nil
      )
    }
  }

  private static func shouldShowTimer(_ event: NativeLiveOverlayEvent) -> Bool {
    event.kind == "card" || event.kind == "correct" || event.kind == "passed"
  }

  private static func formatRoundClock(_ totalSeconds: Int) -> String {
    let safeSeconds = max(0, totalSeconds)
    return String(format: "%d:%02d", safeSeconds / 60, safeSeconds % 60)
  }

  private static func loadImage(_ path: String?) -> UIImage? {
    guard let path else { return nil }
    let url = URL(string: path) ?? URL(fileURLWithPath: path)
    return UIImage(contentsOfFile: url.path)
  }

  private static func colors(_ kind: String) -> (background: UIColor, foreground: UIColor) {
    switch kind {
    case "correct":
      return (
        UIColor(red: 135 / 255, green: 237 / 255, blue: 170 / 255, alpha: 0.64),
        UIColor(red: 24 / 255, green: 35 / 255, blue: 29 / 255, alpha: 1)
      )
    case "passed":
      return (
        UIColor(red: 255 / 255, green: 119 / 255, blue: 43 / 255, alpha: 0.64),
        UIColor(red: 2 / 255, green: 2 / 255, blue: 2 / 255, alpha: 1)
      )
    case "countdown", "times-up":
      return (
        UIColor(red: 50 / 255, green: 139 / 255, blue: 232 / 255, alpha: 0.64),
        .white
      )
    default:
      return (
        UIColor(red: 247 / 255, green: 245 / 255, blue: 239 / 255, alpha: 0.64),
        UIColor(red: 56 / 255, green: 109 / 255, blue: 236 / 255, alpha: 1)
      )
    }
  }
}
