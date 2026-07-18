import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import Metal
import NitroModules
import VisionCamera

final class HybridLiveOverlayOutput: HybridCameraOutputSpec, NativeCameraOutput,
  AVCaptureVideoDataOutputSampleBufferDelegate
{
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
  private let ciContext = HybridLiveOverlayOutput.makeCIContext()
  private let stateLock = NSLock()
  private var recordingRequested = false
  private var writer: AVAssetWriter?
  private var writerInput: AVAssetWriterInput?
  private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var outputURL: URL?
  private var renderer: LiveOverlayRenderer?
  private var events: [NativeLiveOverlayEvent] = []
  private var firstTimestamp: CMTime?
  private var lastTimestamp: CMTime?
  private var encodedFrameCount = 0
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
    output.setSampleBufferDelegate(self, queue: queue)
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
      NSLog(
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
        let error = self.writer?.error
          ?? self.makeError("The live-overlay recording stopped after a frame-processing failure.")
        self.resetRecordingState(deleteOutput: true)
        promise.reject(withError: error)
      }
      return promise
    }
    let promise = Promise<LiveOverlayRecordingResult>()
    queue.async {
      guard
        let writer = self.writer,
        let writerInput = self.writerInput,
        let outputURL = self.outputURL,
        let firstTimestamp = self.firstTimestamp,
        let lastTimestamp = self.lastTimestamp,
        self.encodedFrameCount > 0
      else {
        self.resetRecordingState(deleteOutput: true)
        promise.reject(withError: self.makeError("The live-overlay recorder received no frames."))
        return
      }

      writerInput.markAsFinished()
      writer.endSession(atSourceTime: lastTimestamp)
      let durationMs = max(0, CMTimeGetSeconds(lastTimestamp - firstTimestamp) * 1_000)
      let encodedFrameCount = self.encodedFrameCount
      let droppedFrameCount = self.droppedFrameCount
      let width = self.outputWidth
      let height = self.outputHeight
      writer.finishWriting {
        self.queue.async {
          if writer.status == .completed {
            let result = LiveOverlayRecordingResult(
              uri: outputURL.absoluteString,
              durationMs: durationMs,
              encodedFrameCount: Double(encodedFrameCount),
              droppedFrameCount: Double(droppedFrameCount),
              width: Double(width),
              height: Double(height)
            )
            self.resetRecordingState(deleteOutput: false)
            NSLog(
              "[RoundVideoNative] Live overlay recorder completed durationMs=%.0f encodedFrames=%ld droppedFrames=%ld width=%ld height=%ld output=%@",
              durationMs,
              encodedFrameCount,
              droppedFrameCount,
              width,
              height,
              outputURL.lastPathComponent
            )
            promise.resolve(withResult: result)
          } else {
            let error = writer.error ?? self.makeError("The live-overlay writer did not finish.")
            self.resetRecordingState(deleteOutput: true)
            promise.reject(withError: error)
          }
        }
      }
    }
    return promise
  }

  func cancelRecording() throws -> Promise<Void> {
    setRecordingRequested(false)
    return Promise.parallel(queue) {
      self.writerInput?.markAsFinished()
      self.writer?.cancelWriting()
      self.resetRecordingState(deleteOutput: true)
    }
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard isRecording, let sourcePixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }
    let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    do {
      if writer == nil {
        try initializeWriter(pixelBuffer: sourcePixelBuffer, timestamp: timestamp)
      }
      guard
        let writer,
        let writerInput,
        let adaptor = pixelBufferAdaptor,
        writer.status == .writing
      else {
        droppedFrameCount += 1
        return
      }
      guard writerInput.isReadyForMoreMediaData else {
        droppedFrameCount += 1
        return
      }
      guard let pool = adaptor.pixelBufferPool else {
        throw makeError("The live-overlay pixel buffer pool was unavailable.")
      }
      var destinationPixelBuffer: CVPixelBuffer?
      let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &destinationPixelBuffer)
      guard status == kCVReturnSuccess, let destinationPixelBuffer else {
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
      if let overlay = renderer?.image(event: event, elapsedMs: elapsedMs, size: size) {
        image = overlay.composited(over: image)
      }
      ciContext.render(
        image,
        to: destinationPixelBuffer,
        bounds: CGRect(origin: .zero, size: size),
        colorSpace: CGColorSpaceCreateDeviceRGB()
      )
      if adaptor.append(destinationPixelBuffer, withPresentationTime: timestamp) {
        encodedFrameCount += 1
        lastTimestamp = timestamp
      } else {
        droppedFrameCount += 1
      }
    } catch {
      droppedFrameCount += 1
      NSLog("[RoundVideoNative] Live overlay frame processing failed error=%@", error.localizedDescription)
      writer?.cancelWriting()
      setRecordingRequested(false)
    }
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didDrop sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if isRecording { droppedFrameCount += 1 }
  }

  private func initializeWriter(pixelBuffer: CVPixelBuffer, timestamp: CMTime) throws {
    switch outputOrientation {
    case .up, .down:
      outputWidth = 720
      outputHeight = 1280
    case .left, .right:
      outputWidth = 1280
      outputHeight = 720
    }
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("whatz-it-live-overlay-\(UUID().uuidString).mp4")
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let writerInput = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: outputWidth,
        AVVideoHeightKey: outputHeight,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: 5_000_000,
          AVVideoExpectedSourceFrameRateKey: 30,
          AVVideoMaxKeyFrameIntervalKey: 60,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoAllowFrameReorderingKey: false,
        ],
      ]
    )
    writerInput.expectsMediaDataInRealTime = true
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: writerInput,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: outputWidth,
        kCVPixelBufferHeightKey as String: outputHeight,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:],
      ]
    )
    guard writer.canAdd(writerInput) else {
      throw makeError("The live-overlay video track could not be added.")
    }
    writer.add(writerInput)
    guard writer.startWriting() else {
      throw writer.error ?? makeError("The live-overlay writer could not start.")
    }
    writer.startSession(atSourceTime: timestamp)
    self.writer = writer
    self.writerInput = writerInput
    pixelBufferAdaptor = adaptor
    outputURL = url
    firstTimestamp = timestamp
    lastTimestamp = timestamp
    NSLog(
      "[RoundVideoNative] Live overlay writer started width=%ld height=%ld sourceWidth=%ld sourceHeight=%ld output=%@",
      outputWidth,
      outputHeight,
      CVPixelBufferGetWidth(pixelBuffer),
      CVPixelBufferGetHeight(pixelBuffer),
      url.lastPathComponent
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
    if deleteOutput, let outputURL {
      try? FileManager.default.removeItem(at: outputURL)
    }
    writer = nil
    writerInput = nil
    pixelBufferAdaptor = nil
    outputURL = nil
    renderer = nil
    events = []
    firstTimestamp = nil
    lastTimestamp = nil
    encodedFrameCount = 0
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
