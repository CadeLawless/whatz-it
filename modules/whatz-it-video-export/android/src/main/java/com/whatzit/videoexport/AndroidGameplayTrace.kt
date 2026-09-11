package com.whatzit.videoexport

import android.content.Context
import android.content.pm.ApplicationInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Explicitly opt-in on a debuggable app; never observes sensors in production. */
internal class AndroidGameplayTrace(private val context: Context) : SensorEventListener {
  private val samples = ArrayList<List<Double>>()
  private var thread: HandlerThread? = null
  private val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val matrix = FloatArray(9)
  private val angles = FloatArray(3)

  fun enabled() = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0 &&
    File(context.filesDir, "android-gameplay-diagnostics.enabled").exists()

  fun start() {
    if (!enabled() || thread != null) return
    synchronized(samples) { samples.clear() }
    val worker = HandlerThread("WhatzItSensorTrace").also { it.start() }
    thread = worker
    manager.registerListener(this, manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR),
      20_000, Handler(worker.looper))
  }

  override fun onSensorChanged(event: SensorEvent) {
    val receivedMs = SystemClock.elapsedRealtimeNanos() / 1_000_000.0
    SensorManager.getRotationMatrixFromVector(matrix, event.values)
    SensorManager.getOrientation(matrix, angles)
    synchronized(samples) {
      if (samples.size < 20_000) samples.add(listOf(event.timestamp / 1_000_000.0, receivedMs, -angles[2].toDouble()))
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  fun stop() {
    manager.unregisterListener(this)
    thread?.quitSafely()
    thread = null
  }

  fun save(jsTrace: String) {
    if (!enabled()) return
    val native = synchronized(samples) { samples.map { JSONArray(it) } }
    val report = JSONObject()
      .put("nativeColumns", JSONArray(listOf("sampleMs", "nativeReceiptMs", "angle")))
      .put("nativeSamples", JSONArray(native))
      .put("js", JSONObject(jsTrace))
    File(context.filesDir, "android-gameplay-latency.json").writeText(report.toString())
  }
}
