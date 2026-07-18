package com.margelo.nitro.whatzit.liveoverlay

import com.margelo.nitro.camera.HybridCameraOutputSpec
import com.margelo.nitro.core.Promise
import com.whatzit.liveoverlay.HybridLiveOverlayOutput

class HybridLiveOverlayOutputFactory : HybridLiveOverlayOutputFactorySpec() {
  private var output: HybridLiveOverlayOutput? = null

  override val isRecording: Boolean
    get() = output?.isRecording ?: false

  override fun createLiveOverlayOutput(): HybridCameraOutputSpec {
    val nextOutput = HybridLiveOverlayOutput()
    output = nextOutput
    return nextOutput
  }

  override fun startRecording(headshotPath: String?, wordmarkPath: String?): Promise<Unit> =
    output?.startRecording(headshotPath, wordmarkPath)
      ?: Promise.async { throw IllegalStateException("The Android live-overlay camera output is unavailable.") }

  override fun appendOverlayEvent(event: LiveOverlayEvent) {
    output?.appendOverlayEvent(event)
  }

  override fun stopRecording(): Promise<LiveOverlayRecordingResult> =
    output?.stopRecording()
      ?: Promise.async { throw IllegalStateException("The Android live-overlay camera output is unavailable.") }

  override fun cancelRecording(): Promise<Unit> =
    output?.cancelRecording() ?: Promise.resolved()
}
