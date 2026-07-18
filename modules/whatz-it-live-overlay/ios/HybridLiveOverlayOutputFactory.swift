import Foundation
import NitroModules
import VisionCamera

final class HybridLiveOverlayOutputFactory: HybridLiveOverlayOutputFactorySpec {
  private var output: HybridLiveOverlayOutput?

  var isRecording: Bool {
    output?.isRecording ?? false
  }

  func createLiveOverlayOutput() throws -> any HybridCameraOutputSpec {
    let output = HybridLiveOverlayOutput()
    self.output = output
    return output
  }

  func startRecording(headshotPath: String?, wordmarkPath: String?) throws -> Promise<Void> {
    guard let output else {
      return .rejected(withError: makeError("The live-overlay camera output is unavailable."))
    }
    return try output.startRecording(headshotPath: headshotPath, wordmarkPath: wordmarkPath)
  }

  func appendOverlayEvent(event: LiveOverlayEvent) throws {
    guard let output else { return }
    try output.appendOverlayEvent(event: event)
  }

  func stopRecording() throws -> Promise<LiveOverlayRecordingResult> {
    guard let output else {
      return .rejected(withError: makeError("The live-overlay camera output is unavailable."))
    }
    return try output.stopRecording()
  }

  func cancelRecording() throws -> Promise<Void> {
    guard let output else { return .resolved() }
    return try output.cancelRecording()
  }

  private func makeError(_ message: String) -> Error {
    NSError(
      domain: "WhatzItLiveOverlay",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
