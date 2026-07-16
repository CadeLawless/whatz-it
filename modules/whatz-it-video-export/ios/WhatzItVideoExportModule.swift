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

private struct OverlayTimelineFrame {
  let start: Double
  let frame: CGRect
  let image: CGImage
}

private struct SystemSoundPool {
  let soundIds: [SystemSoundID]
  var nextIndex = 0
}

private enum VideoExportError: Error, LocalizedError {
  case missingVideoTrack
  case missingAudioTrack
  case missingExportedAudioTrack
  case cannotCreateExporter
  case microphoneAlreadyRecording
  case microphoneNotRecording
  case microphoneStartFailed
  case unknownHapticCue(String)
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
    case .unknownHapticCue(let cue):
      return "Unknown round haptic cue: \(cue)."
    case .systemSoundCreationFailed(let status):
      return "The round sound could not be prepared (status \(status))."
    case .exportFailed(let message):
      return "The media export failed: \(message)"
    }
  }
}

public final class WhatzItVideoExportModule: Module {
  private var microphoneEngine: AVAudioEngine?
  private var microphoneRecorder: AVAudioRecorder?
  private var microphoneRecordingUrl: URL?
  private let systemSoundsLock = NSLock()
  private var systemSoundPools = [String: SystemSoundPool]()
  private let silentSwitchLock = NSLock()
  private var silentSwitchProbeId: SystemSoundID?

  deinit {
    for pool in self.systemSoundPools.values {
      for soundId in pool.soundIds {
        AudioServicesDisposeSystemSoundID(soundId)
      }
    }
    if let silentSwitchProbeId = self.silentSwitchProbeId {
      AudioServicesDisposeSystemSoundID(silentSwitchProbeId)
    }
  }

  public func definition() -> ModuleDefinition {
    Name("WhatzItVideoExport")

    Constant("overlayExportVersion") {
      14
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
        cues: [RoundAudioCueRecord],
        cueVolume: Double
      ) async throws -> String in
      let outputUrl = FileManager.default.temporaryDirectory
        .appendingPathComponent("whatz-it-round-audio-\(UUID().uuidString).m4a")
      do {
        try await Self.mixRoundAudio(
          videoUrl: videoUrl,
          microphoneUrl: microphoneUrl,
          microphoneOffsetMs: microphoneOffsetMs,
          cues: cues,
          cueVolume: cueVolume,
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

    AsyncFunction("reassertRecordingHaptics") { () throws -> Bool in
      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setAllowHapticsAndSystemSoundsDuringRecording(true)
      return audioSession.allowHapticsAndSystemSoundsDuringRecording
    }

    AsyncFunction("playRoundHaptic") { (cue: String, countdownValue: Int?) throws -> String in
      guard Self.scheduleRoundHaptic(cue: cue, countdownValue: countdownValue) else {
        throw VideoExportError.unknownHapticCue(cue)
      }
      return "ui-feedback-generator"
    }

    AsyncFunction("startMicrophoneRecording") { () throws -> String in
      guard self.microphoneEngine == nil, self.microphoneRecorder == nil else {
        throw VideoExportError.microphoneAlreadyRecording
      }
      try Self.configureRecordingAudioSession()
      let outputUrl = FileManager.default.temporaryDirectory
        .appendingPathComponent("whatz-it-microphone-\(UUID().uuidString).m4a")
      let capturePath = try self.startMicrophoneCapture(at: outputUrl)
      NSLog("[RoundAudioNative] Microphone capture selected path=%@ uri=%@", capturePath, outputUrl.absoluteString)
      return outputUrl.absoluteString
    }

    AsyncFunction("stopMicrophoneRecording") { () throws -> String in
      guard let outputUrl = self.microphoneRecordingUrl else {
        throw VideoExportError.microphoneNotRecording
      }
      let capturePath: String
      if let engine = self.microphoneEngine {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        self.microphoneEngine = nil
        capturePath = "voice-processing-engine"
      } else if let recorder = self.microphoneRecorder {
        recorder.updateMeters()
        let duration = recorder.currentTime
        let averagePower = recorder.averagePower(forChannel: 0)
        let peakPower = recorder.peakPower(forChannel: 0)
        recorder.stop()
        NSLog(
          "[RoundAudioNative] Fallback recorder levels duration=%.3f averagePower=%.1f peakPower=%.1f",
          duration,
          averagePower,
          peakPower
        )
        capturePath = "audio-recorder-fallback"
      } else {
        throw VideoExportError.microphoneNotRecording
      }
      self.microphoneRecorder = nil
      self.microphoneRecordingUrl = nil
      let attributes = try? FileManager.default.attributesOfItem(atPath: outputUrl.path)
      let fileSize = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
      NSLog(
        "[RoundAudioNative] Microphone capture stopped path=%@ bytes=%lld uri=%@",
        capturePath,
        fileSize,
        outputUrl.absoluteString
      )
      return outputUrl.absoluteString
    }

    AsyncFunction("cancelMicrophoneRecording") { () in
      if let engine = self.microphoneEngine {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
      }
      self.microphoneRecorder?.stop()
      if let outputUrl = self.microphoneRecordingUrl {
        try? FileManager.default.removeItem(at: outputUrl)
      }
      self.microphoneEngine = nil
      self.microphoneRecorder = nil
      self.microphoneRecordingUrl = nil
      NSLog("[RoundAudioNative] Microphone capture cancelled")
    }

    AsyncFunction("probeSilentSwitch") { () async throws -> Bool in
      let soundId = try self.prepareSilentSwitchProbe()
      let elapsed = await Self.measureSystemSoundDuration(soundId)
      return Self.durationIndicatesSilentSwitch(elapsed)
    }

    AsyncFunction("prepareSystemSound") { (inputUrl: URL) throws in
      try self.prepareSystemSound(inputUrl)
    }

    AsyncFunction("playSystemSound") { (inputUrl: URL) throws in
      let soundId = try self.nextSystemSoundId(inputUrl)
      AudioServicesPlaySystemSound(soundId)
    }

    AsyncFunction("stopSystemSound") { (inputUrl: URL) in
      self.disposeSystemSoundPool(inputUrl)
    }
  }

  private func prepareSystemSound(_ inputUrl: URL) throws {
    let key = inputUrl.absoluteString
    self.systemSoundsLock.lock()
    let isPrepared = self.systemSoundPools[key] != nil
    self.systemSoundsLock.unlock()
    if isPrepared { return }

    var soundIds = [SystemSoundID]()
    do {
      // Two IDs allow the one-second countdown tick to overlap its short tail
      // without restarting the prior instance.
      for _ in 0..<2 {
        var soundId: SystemSoundID = 0
        let creationStatus = AudioServicesCreateSystemSoundID(inputUrl as CFURL, &soundId)
        guard creationStatus == kAudioServicesNoError else {
          throw VideoExportError.systemSoundCreationFailed(creationStatus)
        }
        var isUiSound: UInt32 = 1
        let propertyStatus = AudioServicesSetProperty(
          kAudioServicesPropertyIsUISound,
          UInt32(MemoryLayout<SystemSoundID>.size),
          &soundId,
          UInt32(MemoryLayout<UInt32>.size),
          &isUiSound
        )
        guard propertyStatus == kAudioServicesNoError else {
          AudioServicesDisposeSystemSoundID(soundId)
          throw VideoExportError.systemSoundCreationFailed(propertyStatus)
        }
        soundIds.append(soundId)
      }
    } catch {
      for soundId in soundIds {
        AudioServicesDisposeSystemSoundID(soundId)
      }
      throw error
    }

    self.systemSoundsLock.lock()
    if self.systemSoundPools[key] == nil {
      self.systemSoundPools[key] = SystemSoundPool(soundIds: soundIds)
      self.systemSoundsLock.unlock()
    } else {
      self.systemSoundsLock.unlock()
      for soundId in soundIds {
        AudioServicesDisposeSystemSoundID(soundId)
      }
    }
  }

  private func prepareSilentSwitchProbe() throws -> SystemSoundID {
    self.silentSwitchLock.lock()
    defer { self.silentSwitchLock.unlock() }
    if let soundId = self.silentSwitchProbeId { return soundId }

    let probeUrl = FileManager.default.temporaryDirectory
      .appendingPathComponent("whatz-it-silent-switch-probe.wav")
    if !FileManager.default.fileExists(atPath: probeUrl.path) {
      try Self.writeSilentSwitchProbe(to: probeUrl)
    }

    var soundId: SystemSoundID = 0
    let creationStatus = AudioServicesCreateSystemSoundID(probeUrl as CFURL, &soundId)
    guard creationStatus == kAudioServicesNoError else {
      throw VideoExportError.systemSoundCreationFailed(creationStatus)
    }
    var isUiSound: UInt32 = 1
    let propertyStatus = AudioServicesSetProperty(
      kAudioServicesPropertyIsUISound,
      UInt32(MemoryLayout<SystemSoundID>.size),
      &soundId,
      UInt32(MemoryLayout<UInt32>.size),
      &isUiSound
    )
    guard propertyStatus == kAudioServicesNoError else {
      AudioServicesDisposeSystemSoundID(soundId)
      throw VideoExportError.systemSoundCreationFailed(propertyStatus)
    }
    self.silentSwitchProbeId = soundId
    return soundId
  }

  private static func measureSystemSoundDuration(_ soundId: SystemSoundID) async -> TimeInterval {
    let startedAt = ProcessInfo.processInfo.systemUptime
    return await withCheckedContinuation { continuation in
      AudioServicesPlaySystemSoundWithCompletion(soundId) {
        continuation.resume(returning: ProcessInfo.processInfo.systemUptime - startedAt)
      }
    }
  }

  private static func durationIndicatesSilentSwitch(_ elapsed: TimeInterval) -> Bool {
    // The probe contains 120 ms of silence. A UI sound suppressed by the
    // Ring/Silent switch completes almost immediately; an allowed sound keeps
    // its full timeline even though every sample is silent.
    elapsed < 0.08
  }

  private static func writeSilentSwitchProbe(to url: URL) throws {
    let sampleRate: UInt32 = 8_000
    let frameCount: UInt32 = 960
    var data = Data()
    data.append(contentsOf: "RIFF".utf8)
    appendLittleEndian(UInt32(36) + frameCount, to: &data)
    data.append(contentsOf: "WAVEfmt ".utf8)
    appendLittleEndian(UInt32(16), to: &data)
    appendLittleEndian(UInt16(1), to: &data)
    appendLittleEndian(UInt16(1), to: &data)
    appendLittleEndian(sampleRate, to: &data)
    appendLittleEndian(sampleRate, to: &data)
    appendLittleEndian(UInt16(1), to: &data)
    appendLittleEndian(UInt16(8), to: &data)
    data.append(contentsOf: "data".utf8)
    appendLittleEndian(frameCount, to: &data)
    data.append(contentsOf: repeatElement(UInt8(128), count: Int(frameCount)))
    try data.write(to: url, options: .atomic)
  }

  private static func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
    var littleEndian = value.littleEndian
    withUnsafeBytes(of: &littleEndian) { bytes in
      data.append(contentsOf: bytes)
    }
  }

  private func nextSystemSoundId(_ inputUrl: URL) throws -> SystemSoundID {
    try self.prepareSystemSound(inputUrl)
    let key = inputUrl.absoluteString
    self.systemSoundsLock.lock()
    defer { self.systemSoundsLock.unlock() }
    guard var pool = self.systemSoundPools[key], !pool.soundIds.isEmpty else {
      throw VideoExportError.systemSoundCreationFailed(kAudioServicesSystemSoundUnspecifiedError)
    }
    let soundId = pool.soundIds[pool.nextIndex % pool.soundIds.count]
    pool.nextIndex += 1
    self.systemSoundPools[key] = pool
    return soundId
  }

  private func disposeSystemSoundPool(_ inputUrl: URL) {
    let key = inputUrl.absoluteString
    self.systemSoundsLock.lock()
    let pool = self.systemSoundPools.removeValue(forKey: key)
    self.systemSoundsLock.unlock()
    guard let pool else { return }
    for soundId in pool.soundIds {
      AudioServicesDisposeSystemSoundID(soundId)
    }
  }

  private func startMicrophoneCapture(at outputUrl: URL) throws -> String {
    do {
      let engine = AVAudioEngine()
      let inputNode = engine.inputNode
      var tapInstalled = false
      do {
        try inputNode.setVoiceProcessingEnabled(true)
        if #available(iOS 17.0, *) {
          inputNode.voiceProcessingOtherAudioDuckingConfiguration =
            AVAudioVoiceProcessingOtherAudioDuckingConfiguration(
              enableAdvancedDucking: ObjCBool(false),
              duckingLevel: .min
            )
        }
        let inputFormat = inputNode.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
          throw VideoExportError.microphoneStartFailed
        }
        let settings: [String: Any] = [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: inputFormat.sampleRate,
          AVNumberOfChannelsKey: Int(inputFormat.channelCount),
          AVEncoderBitRateKey: 128_000,
          AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        let audioFile = try AVAudioFile(
          forWriting: outputUrl,
          settings: settings,
          commonFormat: inputFormat.commonFormat,
          interleaved: inputFormat.isInterleaved
        )
        inputNode.installTap(onBus: 0, bufferSize: 1_024, format: inputFormat) { buffer, _ in
          do {
            try audioFile.write(from: buffer)
          } catch {
            NSLog("[RoundAudioNative] Voice-processed microphone write failed error=%@", error.localizedDescription)
          }
        }
        tapInstalled = true
        engine.prepare()
        try engine.start()
        guard engine.isRunning else {
          throw VideoExportError.microphoneStartFailed
        }
      } catch {
        engine.stop()
        if tapInstalled {
          inputNode.removeTap(onBus: 0)
        }
        throw error
      }
      self.microphoneEngine = engine
      self.microphoneRecordingUrl = outputUrl
      return "voice-processing-engine"
    } catch {
      NSLog(
        "[RoundAudioNative] Voice-processing capture unavailable; starting recorder fallback error=%@",
        error.localizedDescription
      )
      try? FileManager.default.removeItem(at: outputUrl)
      try Self.configureRecordingAudioSession(mode: .videoRecording)
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 128_000,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
      ]
      let recorder = try AVAudioRecorder(url: outputUrl, settings: settings)
      recorder.isMeteringEnabled = true
      guard recorder.prepareToRecord(), recorder.record(), recorder.isRecording else {
        recorder.stop()
        try? FileManager.default.removeItem(at: outputUrl)
        throw VideoExportError.microphoneStartFailed
      }
      self.microphoneRecorder = recorder
      self.microphoneRecordingUrl = outputUrl
      return "audio-recorder-fallback"
    }
  }

  private static func scheduleRoundHaptic(cue: String, countdownValue: Int?) -> Bool {
    switch cue {
    case "card-flip":
      scheduleImpact(.medium)
    case "correct":
      scheduleSystemVibration()
    case "pass":
      scheduleImpact(.medium)
    case "get-ready":
      scheduleImpact(.medium)
      scheduleImpact(.medium, after: 0.08)
    case "initial-countdown":
      let count = max(1, min(3, 4 - (countdownValue ?? 3)))
      for index in 0..<count {
        scheduleImpact(.light, after: Double(index) * 0.08)
      }
    case "final-countdown":
      scheduleImpact(.rigid)
    case "times-up":
      scheduleSystemVibration()
      scheduleSystemVibration(after: 0.52)
      scheduleSystemVibration(after: 1.04)
    default:
      return false
    }
    return true
  }

  private static func scheduleImpact(
    _ style: UIImpactFeedbackGenerator.FeedbackStyle,
    after delay: TimeInterval = 0
  ) {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
      let generator = UIImpactFeedbackGenerator(style: style)
      generator.prepare()
      generator.impactOccurred()
    }
  }

  private static func scheduleSystemVibration(after delay: TimeInterval = 0) {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
      AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
    }
  }

  private static func configureRecordingAudioSession(
    mode: AVAudioSession.Mode = .videoChat
  ) throws {
    let audioSession = AVAudioSession.sharedInstance()
    try audioSession.setCategory(
      .playAndRecord,
      mode: mode,
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
    cueVolume: Double,
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
      parameters.setVolume(Float(max(0, min(1, cueVolume))), at: .zero)
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
    var overlayFrames: [OverlayTimelineFrame] = []
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
      overlayFrames.append(contentsOf: makeOverlayFrames(
        event: event,
        timerSegments: timerSegments,
        renderSize: renderSize,
        start: start,
      ))
    }

    // Keep every state on one native layer so a new card replaces the old one.
    if let overlayLayer = makeOverlayTimelineLayer(
      frames: overlayFrames,
      durationSeconds: durationSeconds
    ) {
      parentLayer.addSublayer(overlayLayer)
    }

    return AVVideoCompositionCoreAnimationTool(
      postProcessingAsVideoLayer: videoLayer,
      in: parentLayer
    )
  }

  private static func makeOverlayFrames(
    event: VideoOverlayEventRecord,
    timerSegments: [OverlayTimerSegment],
    renderSize: CGSize,
    start: Double
  ) -> [OverlayTimelineFrame] {
    let text = event.text
      .split(whereSeparator: { $0.isWhitespace })
      .joined(separator: " ")
    let horizontalPadding = renderSize.width * 0.0198
    let verticalPadding = renderSize.height * 0.0154
    let maximumTextWidth = max(1, renderSize.width - horizontalPadding * 2)
    let baseFontSize = renderSize.height * 0.056
    var fontSize = baseFontSize
    var font = UIFont.systemFont(ofSize: fontSize, weight: .black)
    var textSize = (text as NSString).size(withAttributes: [.font: font])
    while textSize.width > maximumTextWidth && fontSize > 1 {
      fontSize = max(1, fontSize - 1)
      font = UIFont.systemFont(ofSize: fontSize, weight: .black)
      textSize = (text as NSString).size(withAttributes: [.font: font])
    }
    let timerFont: UIFont?
    let timerSize: CGSize
    if !timerSegments.isEmpty {
      let font = UIFont.systemFont(ofSize: renderSize.height * 0.0308, weight: .heavy)
      timerFont = font
      timerSize = timerSegments.reduce(CGSize.zero) { largest, segment in
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
    let frame = CGRect(
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
    if timerSegments.isEmpty {
      guard let image = makeImage(nil) else { return [] }
      return [OverlayTimelineFrame(start: start, frame: frame, image: image)]
    }
    return timerSegments.compactMap { segment in
      guard let image = makeImage(segment.text) else { return nil }
      return OverlayTimelineFrame(start: start + segment.start, frame: frame, image: image)
    }
  }

  private static func makeOverlayTimelineLayer(
    frames: [OverlayTimelineFrame],
    durationSeconds: Double
  ) -> CALayer? {
    guard durationSeconds > 0 else { return nil }
    let orderedFrames = frames.sorted { $0.start < $1.start }
    guard let firstFrame = orderedFrames.first else { return nil }

    var states: [(frame: OverlayTimelineFrame, visible: Bool)] = []
    func appendState(_ frame: OverlayTimelineFrame, visible: Bool) {
      if let lastIndex = states.indices.last,
         abs(states[lastIndex].frame.start - frame.start) < 0.000_001 {
        states[lastIndex] = (frame, visible)
      } else {
        states.append((frame, visible))
      }
    }

    if firstFrame.start > 0 {
      appendState(
        OverlayTimelineFrame(start: 0, frame: firstFrame.frame, image: firstFrame.image),
        visible: false
      )
    }
    for frame in orderedFrames {
      appendState(frame, visible: true)
    }
    if let lastFrame = states.last?.frame {
      appendState(
        OverlayTimelineFrame(
          start: durationSeconds,
          frame: lastFrame.frame,
          image: lastFrame.image
        ),
        visible: false
      )
    }

    guard let firstState = states.first else { return nil }
    let layer = CALayer()
    layer.bounds = CGRect(origin: .zero, size: firstState.frame.frame.size)
    layer.position = CGPoint(x: firstState.frame.frame.midX, y: firstState.frame.frame.midY)
    layer.contents = firstState.frame.image
    layer.contentsGravity = .resize
    layer.opacity = firstState.visible ? 1 : 0

    let keyTimes = states.map {
      NSNumber(value: min(1, max(0, $0.frame.start / durationSeconds)))
    }
    let contents = CAKeyframeAnimation(keyPath: "contents")
    contents.values = states.map { $0.frame.image as Any }
    let bounds = CAKeyframeAnimation(keyPath: "bounds")
    bounds.values = states.map {
      NSValue(cgRect: CGRect(origin: .zero, size: $0.frame.frame.size))
    }
    let position = CAKeyframeAnimation(keyPath: "position")
    position.values = states.map {
      NSValue(cgPoint: CGPoint(x: $0.frame.frame.midX, y: $0.frame.frame.midY))
    }
    let opacity = CAKeyframeAnimation(keyPath: "opacity")
    opacity.values = states.map { NSNumber(value: $0.visible ? 1 : 0) }

    for animation in [contents, bounds, position, opacity] {
      animation.beginTime = AVCoreAnimationBeginTimeAtZero
      animation.duration = durationSeconds
      animation.keyTimes = keyTimes
      animation.calculationMode = .discrete
      animation.fillMode = .both
      animation.isRemovedOnCompletion = false
    }
    layer.add(contents, forKey: "overlayContents")
    layer.add(bounds, forKey: "overlayBounds")
    layer.add(position, forKey: "overlayPosition")
    layer.add(opacity, forKey: "overlayOpacity")
    return layer
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
    let headshotHeight = headshot == nil ? 0 : renderSize.height * 0.144
    let headshotWidth = headshot.map {
      headshotHeight * ($0.size.width / max(1, $0.size.height))
    } ?? 0
    let wordmarkWidth = wordmark == nil ? 0 : renderSize.height * 0.288
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
