import AudioToolbox
import AVFoundation
import ExpoModulesCore
import ImageIO
import QuartzCore
import UIKit

struct VideoOverlayEventRecord: Record {
  @Field var atMs: Double = 0
  @Field var kind: String = "card"
  @Field var text: String = ""
  @Field var timerEndsAtMs: Double? = nil
}

struct RoundAudioCueRecord: Record {
  @Field var atMs: Double = 0
  @Field var uri: String = ""
}

private struct OverlayTimerSegment {
  let start: Double
  let text: String
}

private enum VideoExportError: Error, LocalizedError {
  case missingVideoTrack
  case missingAudioTrack
  case missingExportedAudioTrack
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
    case .missingExportedAudioTrack:
      return "The finished video does not contain the expected audio track."
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

    Constant("overlayExportVersion") {
      8
    }

    AsyncFunction("exportOverlayVideo") {
      (inputUrl: URL, audioUrl: URL?, events: [VideoOverlayEventRecord]) async throws -> String in
      try await Self.exportToTemporaryFile(
        inputUrl: inputUrl,
        audioUrl: audioUrl,
        events: events,
        headshotUrl: nil,
        wordmarkUrl: nil
      )
    }

    AsyncFunction("exportBrandedOverlayVideo") {
      (
        inputUrl: URL,
        audioUrl: URL?,
        events: [VideoOverlayEventRecord],
        headshotUrl: URL?,
        wordmarkUrl: URL?
      ) async throws -> String in
      try await Self.exportToTemporaryFile(
        inputUrl: inputUrl,
        audioUrl: audioUrl,
        events: events,
        headshotUrl: headshotUrl,
        wordmarkUrl: wordmarkUrl
      )
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
      parameters.setVolume(0.3, at: .zero)
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

  private static func exportToTemporaryFile(
    inputUrl: URL,
    audioUrl: URL?,
    events: [VideoOverlayEventRecord],
    headshotUrl: URL?,
    wordmarkUrl: URL?
  ) async throws -> String {
    let outputUrl = FileManager.default.temporaryDirectory
      .appendingPathComponent("whatz-it-overlay-\(UUID().uuidString).mp4")
    do {
      try await export(
        inputUrl: inputUrl,
        audioUrl: audioUrl,
        outputUrl: outputUrl,
        events: events,
        headshotUrl: headshotUrl,
        wordmarkUrl: wordmarkUrl
      )
      return outputUrl.absoluteString
    } catch {
      try? FileManager.default.removeItem(at: outputUrl)
      throw error
    }
  }

  private static func export(
    inputUrl: URL,
    audioUrl: URL?,
    outputUrl: URL,
    events: [VideoOverlayEventRecord],
    headshotUrl: URL?,
    wordmarkUrl: URL?
  ) async throws {
    let sourceAsset = AVURLAsset(url: inputUrl)
    guard let sourceVideoTrack = try await sourceAsset.loadTracks(withMediaType: .video).first else {
      throw VideoExportError.missingVideoTrack
    }

    let duration = try await sourceAsset.load(.duration)
    let videoCompositionAsset = AVMutableComposition()
    guard let compositionVideoTrack = videoCompositionAsset.addMutableTrack(
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
      durationSeconds: max(0, duration.seconds),
      headshot: headshotUrl.flatMap { loadBrandingImage($0) },
      wordmark: wordmarkUrl.flatMap { loadBrandingImage($0) }
    )

    let compatiblePresets = AVAssetExportSession.exportPresets(compatibleWith: videoCompositionAsset)
    let preset = compatiblePresets.contains(AVAssetExportPreset1280x720)
      ? AVAssetExportPreset1280x720
      : AVAssetExportPresetHighestQuality
    guard let videoExporter = AVAssetExportSession(
      asset: videoCompositionAsset,
      presetName: preset
    ) else {
      throw VideoExportError.cannotCreateExporter
    }
    let renderedVideoUrl = FileManager.default.temporaryDirectory
      .appendingPathComponent("whatz-it-rendered-video-\(UUID().uuidString).mp4")
    defer { try? FileManager.default.removeItem(at: renderedVideoUrl) }

    videoExporter.outputURL = renderedVideoUrl
    videoExporter.outputFileType = .mp4
    videoExporter.shouldOptimizeForNetworkUse = false
    videoExporter.canPerformMultiplePassesOverSourceMediaData = false
    videoExporter.videoComposition = videoComposition
    try await run(videoExporter)

    let audioAsset: AVAsset?
    if let audioUrl {
      let microphoneAsset = AVURLAsset(url: audioUrl)
      let microphoneTracks = try await microphoneAsset.loadTracks(withMediaType: .audio)
      guard !microphoneTracks.isEmpty else {
        throw VideoExportError.missingAudioTrack
      }
      audioAsset = microphoneAsset
    } else {
      let embeddedAudioTracks = try await sourceAsset.loadTracks(withMediaType: .audio)
      audioAsset = embeddedAudioTracks.isEmpty ? nil : sourceAsset
    }

    try await muxRenderedVideo(
      renderedVideoUrl: renderedVideoUrl,
      audioAsset: audioAsset,
      outputUrl: outputUrl
    )

    let finishedAsset = AVURLAsset(url: outputUrl)
    let finishedVideoTracks = try await finishedAsset.loadTracks(withMediaType: .video)
    guard !finishedVideoTracks.isEmpty else {
      throw VideoExportError.missingVideoTrack
    }
    let finishedAudioTracks = try await finishedAsset.loadTracks(withMediaType: .audio)
    if audioAsset != nil && finishedAudioTracks.isEmpty {
      throw VideoExportError.missingExportedAudioTrack
    }
  }

  private static func muxRenderedVideo(
    renderedVideoUrl: URL,
    audioAsset: AVAsset?,
    outputUrl: URL
  ) async throws {
    let renderedAsset = AVURLAsset(url: renderedVideoUrl)
    guard let renderedVideoTrack = try await renderedAsset
      .loadTracks(withMediaType: .video)
      .first else {
      throw VideoExportError.missingVideoTrack
    }
    let renderedDuration = try await renderedAsset.load(.duration)
    let composition = AVMutableComposition()
    guard let finalVideoTrack = composition.addMutableTrack(
      withMediaType: .video,
      preferredTrackID: kCMPersistentTrackID_Invalid
    ) else {
      throw VideoExportError.missingVideoTrack
    }
    try finalVideoTrack.insertTimeRange(
      CMTimeRange(start: .zero, duration: renderedDuration),
      of: renderedVideoTrack,
      at: .zero
    )
    finalVideoTrack.preferredTransform = try await renderedVideoTrack.load(.preferredTransform)

    if let audioAsset {
      guard let sourceAudioTrack = try await audioAsset
        .loadTracks(withMediaType: .audio)
        .first,
        let finalAudioTrack = composition.addMutableTrack(
          withMediaType: .audio,
          preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
        throw VideoExportError.missingAudioTrack
      }
      let sourceAudioRange = try await sourceAudioTrack.load(.timeRange)
      let audioDuration = CMTimeMinimum(renderedDuration, sourceAudioRange.duration)
      guard audioDuration.isValid, audioDuration > .zero else {
        throw VideoExportError.missingAudioTrack
      }
      try finalAudioTrack.insertTimeRange(
        CMTimeRange(start: sourceAudioRange.start, duration: audioDuration),
        of: sourceAudioTrack,
        at: .zero
      )
    }

    let compatiblePresets = AVAssetExportSession.exportPresets(compatibleWith: composition)
    let preset = compatiblePresets.contains(AVAssetExportPresetPassthrough)
      ? AVAssetExportPresetPassthrough
      : AVAssetExportPresetHighestQuality
    guard let exporter = AVAssetExportSession(asset: composition, presetName: preset) else {
      throw VideoExportError.cannotCreateExporter
    }
    exporter.outputURL = outputUrl
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = false
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
    durationSeconds: Double,
    headshot: UIImage?,
    wordmark: UIImage?
  ) -> AVVideoCompositionCoreAnimationTool {
    let parentLayer = CALayer()
    parentLayer.frame = CGRect(origin: .zero, size: renderSize)
    parentLayer.isGeometryFlipped = true

    let videoLayer = CALayer()
    videoLayer.frame = parentLayer.bounds
    parentLayer.addSublayer(videoLayer)

    if let brandingLayer = makeBrandingLayer(
      renderSize: renderSize,
      headshot: headshot,
      wordmark: wordmark
    ) {
      parentLayer.addSublayer(brandingLayer)
    }

    let orderedEvents = events.sorted { $0.atMs < $1.atMs }
    for (index, event) in orderedEvents.enumerated() {
      let start = max(0, event.atMs / 1_000)
      let nextStart = index + 1 < orderedEvents.count
        ? max(start, orderedEvents[index + 1].atMs / 1_000)
        : durationSeconds
      guard nextStart > start else { continue }
      var timerSegments: [OverlayTimerSegment] = []
      if shouldShowTimer(for: event), let timerEndsAtMs = event.timerEndsAtMs {
        let timerEndSeconds = timerEndsAtMs / 1_000
        var segmentStart = start
        while segmentStart < nextStart {
          let remainingSeconds = max(0, Int(ceil(timerEndSeconds - segmentStart)))
          let nextTimerBoundary = remainingSeconds > 0
            ? timerEndSeconds - Double(remainingSeconds - 1)
            : nextStart
          let safeBoundary = nextTimerBoundary > segmentStart
            ? nextTimerBoundary
            : segmentStart + (1.0 / 30.0)
          let segmentEnd = min(nextStart, safeBoundary)
          guard segmentEnd > segmentStart else { break }
          timerSegments.append(OverlayTimerSegment(
            start: segmentStart - start,
            text: formatRoundClock(remainingSeconds)
          ))
          segmentStart = segmentEnd
        }
      }
      // Keep one layer per event. Creating a layer for every timer second leaves
      // completed Core Animation layers visible in some AVFoundation exports.
      parentLayer.addSublayer(makeOverlayLayer(
        event: event,
        timerSegments: timerSegments,
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
    timerSegments: [OverlayTimerSegment],
    renderSize: CGSize,
    start: Double,
    duration: Double
  ) -> CALayer {
    let text = event.text
      .split(whereSeparator: { $0.isWhitespace })
      .joined(separator: " ")
    let horizontalPadding = renderSize.width * 0.0198
    let verticalPadding = renderSize.height * 0.0154
    let maximumTextWidth = max(1, renderSize.width - horizontalPadding * 2)
    let baseFontSize = renderSize.height * 0.056
    var fontSize = baseFontSize
    var font = UIFont.systemFont(ofSize: fontSize, weight: .bold)
    var textSize = (text as NSString).size(withAttributes: [.font: font])
    while textSize.width > maximumTextWidth && fontSize > 1 {
      fontSize = max(1, fontSize - 1)
      font = UIFont.systemFont(ofSize: fontSize, weight: .bold)
      textSize = (text as NSString).size(withAttributes: [.font: font])
    }
    let timerFont: UIFont?
    let timerSize: CGSize
    if !timerSegments.isEmpty {
      let font = UIFont.systemFont(ofSize: renderSize.height * 0.028, weight: .bold)
      timerFont = font
      timerSize = timerSegments.reduce(.zero) { largest, segment in
        let size = (segment.text as NSString).size(withAttributes: [.font: font])
        return CGSize(width: max(largest.width, size.width), height: max(largest.height, size.height))
      }
    } else {
      timerFont = nil
      timerSize = .zero
    }
    let minimumWidth = renderSize.width * 0.3
    let width = min(
      renderSize.width,
      max(minimumWidth, ceil(max(textSize.width, timerSize.width)) + horizontalPadding * 2)
    )
    let minimumHeight = renderSize.height * 0.123
    let timerSpacing = timerSegments.isEmpty ? 0 : renderSize.height * 0.0051
    let contentHeight = font.lineHeight + (timerFont?.lineHeight ?? 0) + timerSpacing
    let height = max(minimumHeight, ceil(contentHeight) + verticalPadding * 2)
    let margin = renderSize.height * 0.133
    let container = CALayer()
    container.frame = CGRect(
      x: (renderSize.width - width) / 2,
      y: renderSize.height - height - margin,
      width: width,
      height: height
    )
    let imageSize = CGSize(width: width, height: height)
    let makeImage = { (timerText: String?) in
      makeOverlayImage(
        event: event,
        text: text,
        timerText: timerText,
        size: imageSize,
        font: font,
        timerFont: timerFont,
        timerSpacing: timerSpacing,
        horizontalPadding: horizontalPadding
      )
    }
    container.contents = makeImage(timerSegments.first?.text)
    container.contentsGravity = .resize
    container.opacity = 0

    if timerSegments.count > 1 {
      var frames = timerSegments.compactMap { segment -> (time: NSNumber, image: CGImage)? in
        guard let image = makeImage(segment.text) else { return nil }
        let normalizedTime = min(1, max(0, segment.start / duration))
        return (NSNumber(value: normalizedTime), image)
      }
      if frames.count > 1, let lastFrame = frames.last {
        frames.append((NSNumber(value: 1), lastFrame.image))
        let timerAnimation = CAKeyframeAnimation(keyPath: "contents")
        timerAnimation.beginTime = AVCoreAnimationBeginTimeAtZero + start
        timerAnimation.duration = duration
        timerAnimation.values = frames.map { $0.image as Any }
        timerAnimation.keyTimes = frames.map { $0.time }
        timerAnimation.calculationMode = .discrete
        timerAnimation.fillMode = .both
        timerAnimation.isRemovedOnCompletion = false
        container.add(timerAnimation, forKey: "timerContents")
      }
    }

    let visibility = CAKeyframeAnimation(keyPath: "opacity")
    visibility.beginTime = AVCoreAnimationBeginTimeAtZero + start
    visibility.duration = duration
    visibility.values = [0, 1, 0]
    visibility.keyTimes = [0, 0.001, 0.999]
    visibility.calculationMode = .discrete
    visibility.fillMode = .both
    visibility.isRemovedOnCompletion = false
    container.add(visibility, forKey: "visibility")
    return container
  }

  private static func makeOverlayImage(
    event: VideoOverlayEventRecord,
    text: String,
    timerText: String?,
    size: CGSize,
    font: UIFont,
    timerFont: UIFont?,
    timerSpacing: CGFloat,
    horizontalPadding: CGFloat
  ) -> CGImage? {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      let palette = colors(for: event.kind)
      palette.background.setFill()
      UIBezierPath(
        roundedRect: CGRect(origin: .zero, size: size),
        cornerRadius: min(size.width, size.height) * 0.25
      ).fill()

      let availableTextWidth = size.width - horizontalPadding * 2
      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .center
      paragraph.lineBreakMode = .byClipping
      let attributedText = NSAttributedString(
        string: text,
        attributes: [
          .font: font,
          .foregroundColor: palette.foreground,
          .paragraphStyle: paragraph
        ]
      )
      let measuredText = attributedText.boundingRect(
        with: CGSize(width: availableTextWidth, height: font.lineHeight * 2),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        context: nil
      )
      let textHeight = min(size.height, ceil(measuredText.height))
      let timerHeight = timerFont.map { ceil($0.lineHeight) } ?? 0
      let contentHeight = textHeight + timerSpacing + timerHeight
      let contentTop = (size.height - contentHeight) / 2
      let textRect = CGRect(
        x: horizontalPadding,
        y: contentTop - measuredText.minY,
        width: availableTextWidth,
        height: textHeight
      )
      attributedText.draw(
        with: textRect,
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        context: nil
      )

      if let timerText, let timerFont {
        let timerParagraph = NSMutableParagraphStyle()
        timerParagraph.alignment = .center
        timerParagraph.lineBreakMode = .byClipping
        let attributedTimer = NSAttributedString(
          string: timerText,
          attributes: [
            .font: timerFont,
            .foregroundColor: palette.foreground,
            .paragraphStyle: timerParagraph
          ]
        )
        let timerRect = CGRect(
          x: horizontalPadding,
          y: contentTop + textHeight + timerSpacing,
          width: availableTextWidth,
          height: timerHeight
        )
        attributedTimer.draw(
          with: timerRect,
          options: [.usesLineFragmentOrigin, .usesFontLeading],
          context: nil
        )
      }
    }
    return image.cgImage
  }

  private static func shouldShowTimer(for event: VideoOverlayEventRecord) -> Bool {
    event.kind == "card" || event.kind == "correct" || event.kind == "passed"
  }

  private static func formatRoundClock(_ totalSeconds: Int) -> String {
    let safeSeconds = max(0, totalSeconds)
    return String(format: "%d:%02d", safeSeconds / 60, safeSeconds % 60)
  }

  private static func loadBrandingImage(_ url: URL) -> UIImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: 1_200
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      return nil
    }
    return UIImage(cgImage: image)
  }

  private static func makeBrandingLayer(
    renderSize: CGSize,
    headshot: UIImage?,
    wordmark: UIImage?
  ) -> CALayer? {
    guard headshot != nil || wordmark != nil else { return nil }
    let margin = renderSize.height * 0.035
    let gap = renderSize.height * 0.01
    let headshotHeight = headshot == nil ? 0 : renderSize.height * 0.12
    let headshotWidth = headshot.map {
      headshotHeight * ($0.size.width / max(1, $0.size.height))
    } ?? 0
    let wordmarkWidth = wordmark == nil ? 0 : renderSize.height * 0.24
    let wordmarkHeight = wordmark.map {
      wordmarkWidth * ($0.size.height / max(1, $0.size.width))
    } ?? 0
    let actualGap = headshot != nil && wordmark != nil ? gap : 0
    let width = headshotWidth + actualGap + wordmarkWidth
    let height = max(headshotHeight, wordmarkHeight)
    let brandingLayer = CALayer()
    brandingLayer.frame = CGRect(x: margin, y: margin, width: width, height: height)
    brandingLayer.opacity = 0.92

    if let headshot, let headshotImage = headshot.cgImage {
      let layer = CALayer()
      layer.frame = CGRect(
        x: 0,
        y: (height - headshotHeight) / 2,
        width: headshotWidth,
        height: headshotHeight
      )
      layer.contents = headshotImage
      layer.contentsGravity = .resizeAspect
      brandingLayer.addSublayer(layer)
    }
    if let wordmark, let wordmarkImage = wordmark.cgImage {
      let layer = CALayer()
      layer.frame = CGRect(
        x: headshotWidth + actualGap,
        y: (height - wordmarkHeight) / 2,
        width: wordmarkWidth,
        height: wordmarkHeight
      )
      layer.contents = wordmarkImage
      layer.contentsGravity = .resizeAspect
      brandingLayer.addSublayer(layer)
    }
    return brandingLayer
  }

  private static func colors(for kind: String) -> (background: UIColor, foreground: UIColor) {
    switch kind {
    case "correct":
      return (
        UIColor(red: 135 / 255, green: 237 / 255, blue: 170 / 255, alpha: 0.64),
        UIColor(red: 34 / 255, green: 45 / 255, blue: 58 / 255, alpha: 1)
      )
    case "passed":
      return (
        UIColor(red: 255 / 255, green: 119 / 255, blue: 43 / 255, alpha: 0.64),
        UIColor(red: 82 / 255, green: 38 / 255, blue: 8 / 255, alpha: 1)
      )
    case "countdown", "times-up":
      return (
        UIColor(red: 50 / 255, green: 139 / 255, blue: 232 / 255, alpha: 0.64),
        .white
      )
    default:
      return (
        UIColor(red: 247 / 255, green: 245 / 255, blue: 239 / 255, alpha: 0.64),
        UIColor(red: 50 / 255, green: 139 / 255, blue: 232 / 255, alpha: 1)
      )
    }
  }
}
