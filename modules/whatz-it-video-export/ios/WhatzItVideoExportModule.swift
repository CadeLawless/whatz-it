import AVFoundation
import ExpoModulesCore
import QuartzCore
import UIKit

struct VideoOverlayEventRecord: Record {
  @Field var atMs: Double = 0
  @Field var kind: String = "card"
  @Field var text: String = ""
}

private enum VideoExportError: Error, LocalizedError {
  case missingVideoTrack
  case cannotCreateExporter
  case exportFailed(String)

  var errorDescription: String? {
    switch self {
    case .missingVideoTrack:
      return "The recorded file does not contain a video track."
    case .cannotCreateExporter:
      return "The video exporter could not be created."
    case .exportFailed(let message):
      return "The video export failed: \(message)"
    }
  }
}

public final class WhatzItVideoExportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WhatzItVideoExport")

    AsyncFunction("exportOverlayVideo") { (inputUrl: URL, events: [VideoOverlayEventRecord]) async throws -> String in
      let outputUrl = FileManager.default.temporaryDirectory
        .appendingPathComponent("whatz-it-overlay-\(UUID().uuidString).mp4")
      do {
        try await Self.export(inputUrl: inputUrl, outputUrl: outputUrl, events: events)
        return outputUrl.absoluteString
      } catch {
        try? FileManager.default.removeItem(at: outputUrl)
        throw error
      }
    }

    AsyncFunction("prepareRecordingAudio") { () throws in
      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setCategory(
        .playAndRecord,
        mode: .videoRecording,
        options: [.defaultToSpeaker]
      )
      try audioSession.setActive(true)
    }
  }

  private static func export(
    inputUrl: URL,
    outputUrl: URL,
    events: [VideoOverlayEventRecord]
  ) async throws {
    let asset = AVURLAsset(url: inputUrl)
    let videoTracks = try await asset.loadTracks(withMediaType: .video)
    guard let sourceVideoTrack = videoTracks.first else {
      throw VideoExportError.missingVideoTrack
    }

    let duration = try await asset.load(.duration)
    let naturalSize = try await sourceVideoTrack.load(.naturalSize)
    let preferredTransform = try await sourceVideoTrack.load(.preferredTransform)
    let timeRange = CMTimeRange(start: .zero, duration: duration)
    let transformedRect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
    let renderSize = CGSize(width: abs(transformedRect.width), height: abs(transformedRect.height))
    let normalizedTransform = preferredTransform.concatenating(
      CGAffineTransform(translationX: -transformedRect.minX, y: -transformedRect.minY)
    )

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = timeRange
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: sourceVideoTrack)
    layerInstruction.setTransform(normalizedTransform, at: .zero)
    instruction.layerInstructions = [layerInstruction]

    let videoComposition = AVMutableVideoComposition()
    videoComposition.instructions = [instruction]
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
    videoComposition.animationTool = makeAnimationTool(
      renderSize: renderSize,
      events: events,
      durationSeconds: max(0, duration.seconds)
    )

    let compatiblePresets = AVAssetExportSession.exportPresets(compatibleWith: asset)
    let preset = compatiblePresets.contains(AVAssetExportPreset1280x720)
      ? AVAssetExportPreset1280x720
      : AVAssetExportPresetHighestQuality
    guard let exporter = AVAssetExportSession(asset: asset, presetName: preset) else {
      throw VideoExportError.cannotCreateExporter
    }
    exporter.outputURL = outputUrl
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = false
    exporter.canPerformMultiplePassesOverSourceMediaData = false
    exporter.videoComposition = videoComposition

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      exporter.exportAsynchronously {
        switch exporter.status {
        case .completed:
          continuation.resume()
        case .failed, .cancelled:
          continuation.resume(throwing: VideoExportError.exportFailed(
            exporter.error?.localizedDescription ?? "Unknown error"
          ))
        default:
          continuation.resume(throwing: VideoExportError.exportFailed("The exporter stopped unexpectedly."))
        }
      }
    }
  }

  private static func makeAnimationTool(
    renderSize: CGSize,
    events: [VideoOverlayEventRecord],
    durationSeconds: Double
  ) -> AVVideoCompositionCoreAnimationTool {
    let parentLayer = CALayer()
    parentLayer.frame = CGRect(origin: .zero, size: renderSize)
    parentLayer.isGeometryFlipped = true

    let videoLayer = CALayer()
    videoLayer.frame = parentLayer.bounds
    parentLayer.addSublayer(videoLayer)

    let orderedEvents = events.sorted { $0.atMs < $1.atMs }
    for (index, event) in orderedEvents.enumerated() {
      let start = max(0, event.atMs / 1_000)
      let nextStart = index + 1 < orderedEvents.count
        ? max(start, orderedEvents[index + 1].atMs / 1_000)
        : durationSeconds
      guard nextStart > start else { continue }
      parentLayer.addSublayer(makeOverlayLayer(
        event: event,
        renderSize: renderSize,
        start: start,
        duration: nextStart - start
      ))
    }

    return AVVideoCompositionCoreAnimationTool(
      postProcessingAsVideoLayer: videoLayer,
      in: parentLayer
    )
  }

  private static func makeOverlayLayer(
    event: VideoOverlayEventRecord,
    renderSize: CGSize,
    start: Double,
    duration: Double
  ) -> CALayer {
    let width = renderSize.width * 0.43
    let height = max(renderSize.height * 0.16, width * 0.42)
    let margin = renderSize.width * 0.05
    let container = CALayer()
    container.frame = CGRect(
      x: margin,
      y: renderSize.height - height - margin,
      width: width,
      height: height
    )
    container.cornerRadius = min(width, height) * 0.1
    container.masksToBounds = true
    container.backgroundColor = colors(for: event.kind).background.cgColor
    container.opacity = 0

    let textLayer = CATextLayer()
    let horizontalPadding = width * 0.07
    let availableTextWidth = width - horizontalPadding * 2
    let font = UIFont.systemFont(ofSize: width * 0.09, weight: .bold)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.lineBreakMode = .byTruncatingTail
    let attributedText = NSAttributedString(
      string: event.text,
      attributes: [
        .font: font,
        .foregroundColor: colors(for: event.kind).foreground,
        .paragraphStyle: paragraph
      ]
    )
    let measuredText = attributedText.boundingRect(
      with: CGSize(width: availableTextWidth, height: height),
      options: [.usesLineFragmentOrigin, .usesFontLeading],
      context: nil
    )
    let textHeight = min(height, ceil(measuredText.height))
    textLayer.frame = CGRect(
      x: horizontalPadding,
      y: (height - textHeight) / 2,
      width: availableTextWidth,
      height: textHeight
    )
    textLayer.string = attributedText
    textLayer.contentsScale = UIScreen.main.scale
    textLayer.isWrapped = true
    textLayer.truncationMode = .end
    container.addSublayer(textLayer)

    let visibility = CAKeyframeAnimation(keyPath: "opacity")
    visibility.beginTime = AVCoreAnimationBeginTimeAtZero + start
    visibility.duration = duration
    visibility.values = [1, 1]
    visibility.keyTimes = [0, 1]
    visibility.fillMode = .forwards
    visibility.isRemovedOnCompletion = false
    container.add(visibility, forKey: "visibility")
    return container
  }

  private static func colors(for kind: String) -> (background: UIColor, foreground: UIColor) {
    switch kind {
    case "correct":
      return (UIColor(red: 135 / 255, green: 237 / 255, blue: 170 / 255, alpha: 0.78), UIColor(red: 34 / 255, green: 45 / 255, blue: 58 / 255, alpha: 1))
    case "passed":
      return (UIColor(red: 255 / 255, green: 119 / 255, blue: 43 / 255, alpha: 0.78), UIColor(red: 82 / 255, green: 38 / 255, blue: 8 / 255, alpha: 1))
    case "countdown", "times-up":
      return (UIColor(red: 50 / 255, green: 139 / 255, blue: 232 / 255, alpha: 0.78), .white)
    default:
      return (UIColor(red: 247 / 255, green: 245 / 255, blue: 239 / 255, alpha: 0.78), UIColor(red: 50 / 255, green: 139 / 255, blue: 232 / 255, alpha: 1))
    }
  }
}
