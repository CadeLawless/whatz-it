import AudioToolbox
import AVFoundation
import ExpoModulesCore
import QuartzCore
import UIKit

struct VideoOverlayEventRecord: Record {
  @Field var atMs: Double = 0
  @Field var kind: String = "card"
  @Field var text: String = ""
}

struct RoundAudioCueRecord: Record {
  @Field var atMs: Double = 0
  @Field var uri: String = ""
}

private enum VideoExportError: Error, LocalizedError {
  case missingVideoTrack
  case missingAudioTrack
  case cannotCreateExporter
  case microphoneAlreadyRecording
  case microphoneNotRecording
  case microphoneStartFailed
  case systemSoundCreationFailed(OSStatus)
  case exportFailed(String)

  var errorDescription: String? {
    switch self {
    case .missingVideoTrack:
      return "The recorded file does not contain a video track."
    case .missingAudioTrack:
      return "The recorded microphone file does not contain an audio track."
    case .cannotCreateExporter:
      return "The media exporter could not be created."
    case .microphoneAlreadyRecording:
      return "A microphone recording is already active."
    case .microphoneNotRecording:
      return "There is no active microphone recording to stop."
    case .microphoneStartFailed:
      return "The microphone recorder could not be started."
    case .systemSoundCreationFailed(let status):
      return "The round sound could not be prepared (status \(status))."
    case .exportFailed(let message):
      return "The media export failed: \(message)"
    }
  }
}

public final class WhatzItVideoExportModule: Module {
  private var microphoneRecorder: AVAudioRecorder?
  private var microphoneRecordingUrl: URL?
  private let soundIdsLock = NSLock()
  private var activeSoundIds = Set<SystemSoundID>()

  public func definition() -> ModuleDefinition {
    Name("WhatzItVideoExport")

    AsyncFunction("exportOverlayVideo") {
      (inputUrl: URL, audioUrl: URL?, events: [VideoOverlayEventRecord]) async throws -> String in
      let outputUrl = FileManager.default.temporaryDirectory
        .appendingPathComponent("whatz-it-overlay-\(UUID().uuidString).mp4")
      do {
        try await Self.export(
          inputUrl: inputUrl,
          audioUrl: audioUrl,
          outputUrl: outputUrl,
          events: events
        )
        return outputUrl.absoluteString
      } catch {
        try? FileManager.default.removeItem(at: outputUrl)
        throw error
      }
    }

    AsyncFunction("mixRoundAudio") {
      (
        videoUrl: URL,
        microphoneUrl: URL,
        microphoneOffsetMs: Double,
        cues: [RoundAudioCueRecord]
      ) async throws -> String in
      let outputUrl = FileManager.default.temporaryDirectory
        .appendingPathComponent("whatz-it-round-audio-\(UUID().uuidString).m4a")
      do {
        try await Self.mixRoundAudio(
          videoUrl: videoUrl,
          microphoneUrl: microphoneUrl,
          microphoneOffsetMs: microphoneOffsetMs,
          cues: cues,
          outputUrl: outputUrl
        )
        return outputUrl.absoluteString
      } catch {
        try? FileManager.default.removeItem(at: outputUrl)
        throw error
      }
    }

    AsyncFunction("prepareRecordingAudio") { () throws in
      try Self.configureRecordingAudioSession()
    }

    AsyncFunction("startMicrophoneRecording") { () throws -> String in
      guard self.microphoneRecorder == nil else {
        throw VideoExportError.microphoneAlreadyRecording
      }
      try Self.configureRecordingAudioSession()
      let outputUrl = FileManager.default.temporaryDirectory
        .appendingPathComponent("whatz-it-microphone-\(UUID().uuidString).m4a")
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 128_000,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
      ]
      let recorder = try AVAudioRecorder(url: outputUrl, settings: settings)
      guard recorder.prepareToRecord(), recorder.record() else {
        throw VideoExportError.microphoneStartFailed
      }
      self.microphoneRecorder = recorder
      self.microphoneRecordingUrl = outputUrl
      return outputUrl.absoluteString
    }

    AsyncFunction("stopMicrophoneRecording") { () throws -> String in
      guard let recorder = self.microphoneRecorder,
            let outputUrl = self.microphoneRecordingUrl else {
        throw VideoExportError.microphoneNotRecording
      }
      recorder.stop()
      self.microphoneRecorder = nil
      self.microphoneRecordingUrl = nil
      return outputUrl.absoluteString
    }

    AsyncFunction("cancelMicrophoneRecording") { () in
      self.microphoneRecorder?.stop()
      if let outputUrl = self.microphoneRecordingUrl {
        try? FileManager.default.removeItem(at: outputUrl)
      }
      self.microphoneRecorder = nil
      self.microphoneRecordingUrl = nil
    }

    AsyncFunction("playSystemSound") { (inputUrl: URL) throws in
      var soundId: SystemSoundID = 0
      let status = AudioServicesCreateSystemSoundID(inputUrl as CFURL, &soundId)
      guard status == kAudioServicesNoError else {
        throw VideoExportError.systemSoundCreationFailed(status)
      }
      self.soundIdsLock.lock()
      self.activeSoundIds.insert(soundId)
      self.soundIdsLock.unlock()
      AudioServicesPlaySystemSoundWithCompletion(soundId) { [weak self] in
        AudioServicesDisposeSystemSoundID(soundId)
        guard let self else { return }
        self.soundIdsLock.lock()
        self.activeSoundIds.remove(soundId)
        self.soundIdsLock.unlock()
      }
    }
  }

  private static func configureRecordingAudioSession() throws {
    let audioSession = AVAudioSession.sharedInstance()
    try audioSession.setCategory(
      .playAndRecord,
      mode: .videoRecording,
      options: [.defaultToSpeaker]
    )
    try audioSession.setAllowHapticsAndSystemSoundsDuringRecording(true)
    try audioSession.setActive(true)
  }

  private static func mixRoundAudio(
    videoUrl: URL,
    microphoneUrl: URL,
    microphoneOffsetMs: Double,
    cues: [RoundAudioCueRecord],
    outputUrl: URL
  ) async throws {
    let videoAsset = AVURLAsset(url: videoUrl)
    let videoDuration = try await videoAsset.load(.duration)
    let microphoneAsset = AVURLAsset(url: microphoneUrl)
    guard let microphoneSourceTrack = try await microphoneAsset.loadTracks(withMediaType: .audio).first else {
      throw VideoExportError.missingAudioTrack
    }

    let composition = AVMutableComposition()
    guard let actualMicrophoneTrack = composition.addMutableTrack(
      withMediaType: .audio,
      preferredTrackID: kCMPersistentTrackID_Invalid
    ) else {
      throw VideoExportError.missingAudioTrack
    }

    let microphoneDuration = try await microphoneAsset.load(.duration)
    let microphoneStart = CMTime(seconds: max(0, microphoneOffsetMs / 1_000), preferredTimescale: 600)
    let availableVideoDuration = CMTimeSubtract(videoDuration, microphoneStart)
    let microphoneInsertDuration = CMTimeMinimum(microphoneDuration, availableVideoDuration)
    guard microphoneInsertDuration.isValid, microphoneInsertDuration > .zero else {
      throw VideoExportError.missingAudioTrack
    }
    try actualMicrophoneTrack.insertTimeRange(
      CMTimeRange(start: .zero, duration: microphoneInsertDuration),
      of: microphoneSourceTrack,
      at: microphoneStart
    )

    var effectTracks: [AVMutableCompositionTrack] = []
    var effectTrackEnds: [CMTime] = []
    for cue in cues.sorted(by: { $0.atMs < $1.atMs }) {
      guard let cueUrl = URL(string: cue.uri) else { continue }
      let cueStart = CMTime(seconds: max(0, cue.atMs / 1_000), preferredTimescale: 600)
      guard cueStart < videoDuration else { continue }
      let cueAsset = AVURLAsset(url: cueUrl)
      guard let cueSourceTrack = try await cueAsset.loadTracks(withMediaType: .audio).first else {
        continue
      }
      let cueDuration = try await cueAsset.load(.duration)
      let insertDuration = CMTimeMinimum(cueDuration, CMTimeSubtract(videoDuration, cueStart))
      guard insertDuration.isValid, insertDuration > .zero else { continue }

      var trackIndex = effectTrackEnds.firstIndex(where: { $0 <= cueStart })
      if trackIndex == nil {
        guard let newTrack = composition.addMutableTrack(
          withMediaType: .audio,
          preferredTrackID: kCMPersistentTrackID_Invalid
        ) else { continue }
        effectTracks.append(newTrack)
        effectTrackEnds.append(.zero)
        trackIndex = effectTracks.count - 1
      }
      guard let index = trackIndex else { continue }
      try effectTracks[index].insertTimeRange(
        CMTimeRange(start: .zero, duration: insertDuration),
        of: cueSourceTrack,
        at: cueStart
      )
      effectTrackEnds[index] = CMTimeAdd(cueStart, insertDuration)
    }

    let audioMix = AVMutableAudioMix()
    let microphoneParameters = AVMutableAudioMixInputParameters(track: actualMicrophoneTrack)
    microphoneParameters.setVolume(1, at: .zero)
    let effectParameters = effectTracks.map { track in
      let parameters = AVMutableAudioMixInputParameters(track: track)
      parameters.setVolume(0.92, at: .zero)
      return parameters
    }
    audioMix.inputParameters = [microphoneParameters] + effectParameters

    guard let exporter = AVAssetExportSession(
      asset: composition,
      presetName: AVAssetExportPresetAppleM4A
    ) else {
      throw VideoExportError.cannotCreateExporter
    }
    exporter.outputURL = outputUrl
    exporter.outputFileType = .m4a
    exporter.audioMix = audioMix
    exporter.timeRange = CMTimeRange(
      start: .zero,
      duration: CMTimeMinimum(videoDuration, composition.duration)
    )
    try await run(exporter)
  }

  private static func export(
    inputUrl: URL,
    audioUrl: URL?,
    outputUrl: URL,
    events: [VideoOverlayEventRecord]
  ) async throws {
    let sourceAsset = AVURLAsset(url: inputUrl)
    guard let sourceVideoTrack = try await sourceAsset.loadTracks(withMediaType: .video).first else {
      throw VideoExportError.missingVideoTrack
    }

    let duration = try await sourceAsset.load(.duration)
    let composition = AVMutableComposition()
    guard let compositionVideoTrack = composition.addMutableTrack(
      withMediaType: .video,
      preferredTrackID: kCMPersistentTrackID_Invalid
    ) else {
      throw VideoExportError.missingVideoTrack
    }
    try compositionVideoTrack.insertTimeRange(
      CMTimeRange(start: .zero, duration: duration),
      of: sourceVideoTrack,
      at: .zero
    )

    if let audioUrl {
      let audioAsset = AVURLAsset(url: audioUrl)
      guard let sourceAudioTrack = try await audioAsset.loadTracks(withMediaType: .audio).first,
            let compositionAudioTrack = composition.addMutableTrack(
              withMediaType: .audio,
              preferredTrackID: kCMPersistentTrackID_Invalid
            ) else {
        throw VideoExportError.missingAudioTrack
      }
      let audioDuration = try await audioAsset.load(.duration)
      try compositionAudioTrack.insertTimeRange(
        CMTimeRange(start: .zero, duration: CMTimeMinimum(duration, audioDuration)),
        of: sourceAudioTrack,
        at: .zero
      )
    } else if let sourceAudioTrack = try await sourceAsset.loadTracks(withMediaType: .audio).first,
              let compositionAudioTrack = composition.addMutableTrack(
                withMediaType: .audio,
                preferredTrackID: kCMPersistentTrackID_Invalid
              ) {
      try compositionAudioTrack.insertTimeRange(
        CMTimeRange(start: .zero, duration: duration),
        of: sourceAudioTrack,
        at: .zero
      )
    }

    let naturalSize = try await sourceVideoTrack.load(.naturalSize)
    let preferredTransform = try await sourceVideoTrack.load(.preferredTransform)
    let transformedRect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
    let renderSize = CGSize(width: abs(transformedRect.width), height: abs(transformedRect.height))
    let normalizedTransform = preferredTransform.concatenating(
      CGAffineTransform(translationX: -transformedRect.minX, y: -transformedRect.minY)
    )

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack)
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

    let compatiblePresets = AVAssetExportSession.exportPresets(compatibleWith: composition)
    let preset = compatiblePresets.contains(AVAssetExportPreset1280x720)
      ? AVAssetExportPreset1280x720
      : AVAssetExportPresetHighestQuality
    guard let exporter = AVAssetExportSession(asset: composition, presetName: preset) else {
      throw VideoExportError.cannotCreateExporter
    }
    exporter.outputURL = outputUrl
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = false
    exporter.canPerformMultiplePassesOverSourceMediaData = false
    exporter.videoComposition = videoComposition
    try await run(exporter)
  }

  private static func run(_ exporter: AVAssetExportSession) async throws {
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
          continuation.resume(throwing: VideoExportError.exportFailed(
            "The exporter stopped unexpectedly."
          ))
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
      x: (renderSize.width - width) / 2,
      y: renderSize.height - height - margin,
      width: width,
      height: height
    )
    container.contents = makeOverlayImage(event: event, size: CGSize(width: width, height: height))
    container.contentsGravity = .resize
    container.opacity = 0

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

  private static func makeOverlayImage(
    event: VideoOverlayEventRecord,
    size: CGSize
  ) -> CGImage? {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      let palette = colors(for: event.kind)
      palette.background.setFill()
      UIBezierPath(
        roundedRect: CGRect(origin: .zero, size: size),
        cornerRadius: min(size.width, size.height) * 0.1
      ).fill()

      let horizontalPadding = size.width * 0.07
      let availableTextWidth = size.width - horizontalPadding * 2
      let font = UIFont.systemFont(ofSize: size.width * 0.09, weight: .bold)
      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .center
      paragraph.lineBreakMode = .byTruncatingTail
      let attributedText = NSAttributedString(
        string: event.text,
        attributes: [
          .font: font,
          .foregroundColor: palette.foreground,
          .paragraphStyle: paragraph
        ]
      )
      let measuredText = attributedText.boundingRect(
        with: CGSize(width: availableTextWidth, height: size.height),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        context: nil
      )
      let textHeight = min(size.height, ceil(measuredText.height))
      let textRect = CGRect(
        x: horizontalPadding,
        y: (size.height - textHeight) / 2 - measuredText.minY,
        width: availableTextWidth,
        height: textHeight
      )
      attributedText.draw(
        with: textRect,
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        context: nil
      )
    }
    return image.cgImage
  }

  private static func colors(for kind: String) -> (background: UIColor, foreground: UIColor) {
    switch kind {
    case "correct":
      return (
        UIColor(red: 135 / 255, green: 237 / 255, blue: 170 / 255, alpha: 0.78),
        UIColor(red: 34 / 255, green: 45 / 255, blue: 58 / 255, alpha: 1)
      )
    case "passed":
      return (
        UIColor(red: 255 / 255, green: 119 / 255, blue: 43 / 255, alpha: 0.78),
        UIColor(red: 82 / 255, green: 38 / 255, blue: 8 / 255, alpha: 1)
      )
    case "countdown", "times-up":
      return (
        UIColor(red: 50 / 255, green: 139 / 255, blue: 232 / 255, alpha: 0.78),
        .white
      )
    default:
      return (
        UIColor(red: 247 / 255, green: 245 / 255, blue: 239 / 255, alpha: 0.78),
        UIColor(red: 50 / 255, green: 139 / 255, blue: 232 / 255, alpha: 1)
      )
    }
  }
}
