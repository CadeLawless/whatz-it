import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import Metal
import NitroModules
import VisionCamera

private func logNativeDiagnostic(_ format: String, _ arguments: CVarArg...) {
  #if DEBUG
  withVaList(arguments) { NSLogv(format, $0) }
  #endif
}

private final class LiveOverlaySampleBufferDelegate: NSObject,
  AVCaptureVideoDataOutputSampleBufferDelegate
{
  var onFrame: ((CMSampleBuffer) -> Void)?
  var onFrameDropped: (() -> Void)?

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    onFrame?(sampleBuffer)
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didDrop sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    onFrameDropped?()
  }
}

private final class LiveVideoWriter {
  let writer: AVAssetWriter
  let input: AVAssetWriterInput
  let adaptor: AVAssetWriterInputPixelBufferAdaptor
  let url: URL

  var error: Error? { writer.error }
  var isReadyForMoreMediaData: Bool { input.isReadyForMoreMediaData }
  var status: AVAssetWriter.Status { writer.status }

  init(prefix: String, width: Int, height: Int, startTimestamp: CMTime) throws {
    url = FileManager.default.temporaryDirectory
      .appendingPathComponent("\(prefix)-\(UUID().uuidString).mp4")
    writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: 5_000_000,
          AVVideoExpectedSourceFrameRateKey: 30,
          AVVideoMaxKeyFrameIntervalKey: 60,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoAllowFrameReorderingKey: false,
        ],
      ]
    )
    input.expectsMediaDataInRealTime = true
    adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:],
      ]
    )
    guard writer.canAdd(input) else {
      throw Self.makeError("The \(prefix) video track could not be added.")
    }
    writer.add(input)
    guard writer.startWriting() else {
      throw writer.error ?? Self.makeError("The \(prefix) writer could not start.")
    }
    writer.startSession(atSourceTime: startTimestamp)
  }

  func append(
    image: CIImage,
    context: CIContext,
    size: CGSize,
    timestamp: CMTime
  ) throws -> Bool {
    guard let pool = adaptor.pixelBufferPool else {
      throw Self.makeError("The video pixel buffer pool was unavailable.")
    }
    var pixelBuffer: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer)
    guard status == kCVReturnSuccess, let pixelBuffer else { return false }
    context.render(
      image,
      to: pixelBuffer,
      bounds: CGRect(origin: .zero, size: size),
      colorSpace: CGColorSpaceCreateDeviceRGB()
    )
    return adaptor.append(pixelBuffer, withPresentationTime: timestamp)
  }

  func finish(at timestamp: CMTime, completion: @escaping () -> Void) {
    input.markAsFinished()
    writer.endSession(atSourceTime: timestamp)
    writer.finishWriting(completionHandler: completion)
  }

  func cancel() {
    input.markAsFinished()
    writer.cancelWriting()
  }

  private static func makeError(_ message: String) -> Error {
    NSError(
      domain: "WhatzItLiveOverlay",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}

final class HybridLiveOverlayOutput: HybridCameraOutputSpec, NativeCameraOutput {
  let mediaType: MediaType = .video
  let output = AVCaptureVideoDataOutput()
  let requiresAudioInput = false
  let requiresDepthFormat = false
  let streamType: StreamType = .video
  let targetResolution: ResolutionRule = .closestTo(Size(width: 720, height: 1280))

  private let queue = DispatchQueue(
    label: "com.whatzit.live-overlay",
    qos: .userInteractive,
    autoreleaseFrequency: .workItem
  )
  private let sampleBufferDelegate = LiveOverlaySampleBufferDelegate()
  private let ciContext = HybridLiveOverlayOutput.makeCIContext()
  private let stateLock = NSLock()
  private var recordingRequested = false
  private var cleanVideoWriter: LiveVideoWriter?
  private var brandedVideoWriter: LiveVideoWriter?
  private var renderer: LiveOverlayRenderer?
  private var events: [NativeLiveOverlayEvent] = []
  private var firstTimestamp: CMTime?
  private var lastTimestamp: CMTime?
  private var cleanEncodedFrameCount = 0
  private var brandedEncodedFrameCount = 0
  private var droppedFrameCount = 0
  private var outputWidth = 0
  private var outputHeight = 0

  var isRecording: Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return recordingRequested
  }

  var outputOrientation: CameraOrientation = .up {
    didSet { applyOrientation() }
  }

  var currentResolution: Size? {
    guard let connection = output.connection(with: .video) else { return nil }
    return connection.inputStreamResolution
  }

  override init() {
    super.init()
    sampleBufferDelegate.onFrame = { [weak self] sampleBuffer in
      self?.process(sampleBuffer: sampleBuffer)
    }
    sampleBufferDelegate.onFrameDropped = { [weak self] in
      guard let self, self.isRecording else { return }
      self.droppedFrameCount += 1
    }
    output.setSampleBufferDelegate(sampleBufferDelegate, queue: queue)
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    ]
    // This is the recorder, not a preview analyzer. Preserve camera frames and
    // let the serial writer queue provide backpressure instead of discarding
    // them before Core Image gets a chance to render.
    output.alwaysDiscardsLateVideoFrames = false
  }

  func configure(config: OutputConfiguration) {
    guard let connection = output.connection(with: .video) else { return }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = false
    }
    applyOrientation()
  }

  func startRecording(headshotPath: String?, wordmarkPath: String?) throws -> Promise<Void> {
    guard setRecordingRequestedIfIdle() else {
      return .rejected(withError: makeError("A live-overlay recording is already active."))
    }
    return Promise.parallel(queue) {
      self.resetRecordingState(deleteOutput: true)
      self.renderer = LiveOverlayRenderer(
        headshotPath: headshotPath,
        wordmarkPath: wordmarkPath
      )
      logNativeDiagnostic(
        "[RoundVideoNative] Live overlay recorder armed headshot=%@ wordmark=%@",
        headshotPath == nil ? "false" : "true",
        wordmarkPath == nil ? "false" : "true"
      )
    }
  }

  func appendOverlayEvent(event: LiveOverlayEvent) throws {
    let copied = NativeLiveOverlayEvent(
      atMs: event.atMs,
      kind: event.kind,
      text: event.text,
      byline: event.byline,
      timerEndsAtMs: event.timerEndsAtMs
    )
    queue.async {
      guard self.isRecording else { return }
      self.events.append(copied)
      self.events.sort { $0.atMs < $1.atMs }
    }
  }

  func stopRecording() throws -> Promise<LiveOverlayRecordingResult> {
    guard clearRecordingRequestedIfActive() else {
      let promise = Promise<LiveOverlayRecordingResult>()
      queue.async {
        let error = self.brandedVideoWriter?.error
          ?? self.cleanVideoWriter?.error
          ?? self.makeError("The live-overlay recording stopped after a frame-processing failure.")
        self.resetRecordingState(deleteOutput: true)
        promise.reject(withError: error)
      }
      return promise
    }
    let promise = Promise<LiveOverlayRecordingResult>()
    queue.async {
      guard
        let cleanVideoWriter = self.cleanVideoWriter,
        let brandedVideoWriter = self.brandedVideoWriter,
        let firstTimestamp = self.firstTimestamp,
        let lastTimestamp = self.lastTimestamp,
        self.cleanEncodedFrameCount > 0,
        self.brandedEncodedFrameCount > 0
      else {
        self.resetRecordingState(deleteOutput: true)
        promise.reject(withError: self.makeError("The live-overlay recorder received no frames."))
        return
      }

      let durationMs = max(0, CMTimeGetSeconds(lastTimestamp - firstTimestamp) * 1_000)
      let cleanEncodedFrameCount = self.cleanEncodedFrameCount
      let brandedEncodedFrameCount = self.brandedEncodedFrameCount
      let droppedFrameCount = self.droppedFrameCount
      let width = self.outputWidth
      let height = self.outputHeight
      let finishGroup = DispatchGroup()
      finishGroup.enter()
      cleanVideoWriter.finish(at: lastTimestamp) { finishGroup.leave() }
      finishGroup.enter()
      brandedVideoWriter.finish(at: lastTimestamp) { finishGroup.leave() }
      finishGroup.notify(queue: self.queue) {
        if cleanVideoWriter.status == .completed && brandedVideoWriter.status == .completed {
          let result = LiveOverlayRecordingResult(
            cleanUri: cleanVideoWriter.url.absoluteString,
            uri: brandedVideoWriter.url.absoluteString,
            durationMs: durationMs,
            encodedFrameCount: Double(brandedEncodedFrameCount),
            droppedFrameCount: Double(droppedFrameCount),
            width: Double(width),
            height: Double(height)
          )
          self.resetRecordingState(deleteOutput: false)
          logNativeDiagnostic(
            "[RoundVideoNative] Dual live recorder completed durationMs=%.0f cleanFrames=%ld brandedFrames=%ld droppedFrames=%ld width=%ld height=%ld clean=%@ branded=%@",
            durationMs,
            cleanEncodedFrameCount,
            brandedEncodedFrameCount,
            droppedFrameCount,
            width,
            height,
            cleanVideoWriter.url.lastPathComponent,
            brandedVideoWriter.url.lastPathComponent
          )
          promise.resolve(withResult: result)
        } else {
          let error = brandedVideoWriter.error
            ?? cleanVideoWriter.error
            ?? self.makeError("The dual live-overlay writers did not finish.")
          self.resetRecordingState(deleteOutput: true)
          promise.reject(withError: error)
        }
      }
    }
    return promise
  }

  func cancelRecording() throws -> Promise<Void> {
    setRecordingRequested(false)
    return Promise.parallel(queue) {
      self.cleanVideoWriter?.cancel()
      self.brandedVideoWriter?.cancel()
      self.resetRecordingState(deleteOutput: true)
    }
  }

  private func process(sampleBuffer: CMSampleBuffer) {
    guard isRecording, let sourcePixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }
    let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    do {
      if cleanVideoWriter == nil || brandedVideoWriter == nil {
        try initializeWriters(pixelBuffer: sourcePixelBuffer, timestamp: timestamp)
      }
      guard
        let cleanVideoWriter,
        let brandedVideoWriter,
        cleanVideoWriter.status == .writing,
        brandedVideoWriter.status == .writing
      else {
        droppedFrameCount += 1
        return
      }
      guard
        cleanVideoWriter.isReadyForMoreMediaData,
        brandedVideoWriter.isReadyForMoreMediaData
      else {
        droppedFrameCount += 1
        return
      }

      let elapsedMs = max(0, CMTimeGetSeconds(timestamp - (firstTimestamp ?? timestamp)) * 1_000)
      let event = events.last { $0.atMs <= elapsedMs }
      let size = CGSize(width: outputWidth, height: outputHeight)
      var image = CIImage(cvPixelBuffer: sourcePixelBuffer)
      let sourceExtent = image.extent
      if sourceExtent.width != size.width || sourceExtent.height != size.height {
        let scale = max(size.width / sourceExtent.width, size.height / sourceExtent.height)
        image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let scaledExtent = image.extent
        let cropRect = CGRect(
          x: scaledExtent.midX - size.width / 2,
          y: scaledExtent.midY - size.height / 2,
          width: size.width,
          height: size.height
        )
        image = image
          .cropped(to: cropRect)
          .transformed(by: CGAffineTransform(
            translationX: -cropRect.minX,
            y: -cropRect.minY
          ))
      }
      let cleanAppended = try cleanVideoWriter.append(
        image: image,
        context: ciContext,
        size: size,
        timestamp: timestamp
      )
      var brandedImage = image
      if let overlay = renderer?.image(event: event, elapsedMs: elapsedMs, size: size) {
        brandedImage = overlay.composited(over: brandedImage)
      }
      let brandedAppended = try brandedVideoWriter.append(
        image: brandedImage,
        context: ciContext,
        size: size,
        timestamp: timestamp
      )
      if cleanAppended { cleanEncodedFrameCount += 1 }
      if brandedAppended { brandedEncodedFrameCount += 1 }
      if cleanAppended || brandedAppended {
        lastTimestamp = timestamp
      }
      if !cleanAppended || !brandedAppended {
        droppedFrameCount += 1
      }
    } catch {
      droppedFrameCount += 1
      NSLog("[RoundVideoNative] Live overlay frame processing failed error=%@", error.localizedDescription)
      cleanVideoWriter?.cancel()
      brandedVideoWriter?.cancel()
      setRecordingRequested(false)
    }
  }

  private func initializeWriters(pixelBuffer: CVPixelBuffer, timestamp: CMTime) throws {
    // Round screens have a fixed landscape capture contract. Do not let a
    // transient portrait orientation on the first frame permanently create a
    // portrait writer that center-crops all subsequent landscape frames.
    outputWidth = 1280
    outputHeight = 720
    let cleanVideoWriter = try LiveVideoWriter(
      prefix: "whatz-it-live-clean",
      width: outputWidth,
      height: outputHeight,
      startTimestamp: timestamp
    )
    let brandedVideoWriter: LiveVideoWriter
    do {
      brandedVideoWriter = try LiveVideoWriter(
        prefix: "whatz-it-live-branded",
        width: outputWidth,
        height: outputHeight,
        startTimestamp: timestamp
      )
    } catch {
      cleanVideoWriter.cancel()
      try? FileManager.default.removeItem(at: cleanVideoWriter.url)
      throw error
    }
    self.cleanVideoWriter = cleanVideoWriter
    self.brandedVideoWriter = brandedVideoWriter
    firstTimestamp = timestamp
    lastTimestamp = timestamp
    logNativeDiagnostic(
      "[RoundVideoNative] Dual live writers started width=%ld height=%ld sourceWidth=%ld sourceHeight=%ld clean=%@ branded=%@",
      outputWidth,
      outputHeight,
      CVPixelBufferGetWidth(pixelBuffer),
      CVPixelBufferGetHeight(pixelBuffer),
      cleanVideoWriter.url.lastPathComponent,
      brandedVideoWriter.url.lastPathComponent
    )
  }

  private func applyOrientation() {
    guard let connection = output.connection(with: .video), connection.isVideoOrientationSupported else {
      return
    }
    connection.videoOrientation = {
      switch outputOrientation {
      case .up: return .portrait
      case .down: return .portraitUpsideDown
      case .left: return .landscapeRight
      case .right: return .landscapeLeft
      }
    }()
  }

  private func setRecordingRequestedIfIdle() -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard !recordingRequested else { return false }
    recordingRequested = true
    return true
  }

  private func clearRecordingRequestedIfActive() -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard recordingRequested else { return false }
    recordingRequested = false
    return true
  }

  private func setRecordingRequested(_ value: Bool) {
    stateLock.lock()
    recordingRequested = value
    stateLock.unlock()
  }

  private func resetRecordingState(deleteOutput: Bool) {
    if deleteOutput {
      if let cleanVideoWriter {
        try? FileManager.default.removeItem(at: cleanVideoWriter.url)
      }
      if let brandedVideoWriter {
        try? FileManager.default.removeItem(at: brandedVideoWriter.url)
      }
    }
    cleanVideoWriter = nil
    brandedVideoWriter = nil
    renderer = nil
    events = []
    firstTimestamp = nil
    lastTimestamp = nil
    cleanEncodedFrameCount = 0
    brandedEncodedFrameCount = 0
    droppedFrameCount = 0
    outputWidth = 0
    outputHeight = 0
  }

  private func makeError(_ message: String) -> Error {
    NSError(
      domain: "WhatzItLiveOverlay",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }

  private static func makeCIContext() -> CIContext {
    let options: [CIContextOption: Any] = [
      .cacheIntermediates: false,
      .useSoftwareRenderer: false,
    ]
    if let device = MTLCreateSystemDefaultDevice() {
      return CIContext(mtlDevice: device, options: options)
    }
    return CIContext(options: options)
  }
}
