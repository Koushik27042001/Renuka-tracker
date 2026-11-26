package com.renukatracker

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource

@SuppressLint("MissingPermission")
class ForegroundLocationModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  private val handler = Handler(Looper.getMainLooper())
  private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private val requests = mutableMapOf<Int, (Boolean) -> Unit>()
  private val settingsRequestCode = 6124
  private var settingsPromise: Promise? = null
  private val activityListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode == settingsRequestCode) {
        settingsPromise?.resolve(locationEnabled())
        settingsPromise = null
      }
    }
  }

  init {
    context.addActivityEventListener(activityListener)
  }

  override fun getName() = "RenukaForegroundLocation"

  override fun getConstants() = mapOf(
    "manufacturer" to Build.MANUFACTURER,
    "model" to Build.MODEL,
    "hasFusedProvider" to hasPlayServices(),
  )

  private fun hasPlayServices() =
    GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
      com.google.android.gms.common.ConnectionResult.SUCCESS

  private fun locationEnabled() =
    if (Build.VERSION.SDK_INT >= 28) manager.isLocationEnabled
    else manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
      manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)

  private fun permitted() =
    context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  @ReactMethod
  fun ensureEnabled(promise: Promise) {
    handler.post {
      if (locationEnabled()) {
        promise.resolve(true)
        return@post
      }
      val activity = context.currentActivity
      if (!hasPlayServices() || activity == null || settingsPromise != null) {
        promise.resolve(false)
        return@post
      }
      val request = LocationSettingsRequest.Builder().setAlwaysShow(true)
        .addLocationRequest(LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 1000).build())
        .build()
      LocationServices.getSettingsClient(activity).checkLocationSettings(request)
        .addOnSuccessListener { promise.resolve(locationEnabled()) }
        .addOnFailureListener { error ->
          if (error is ResolvableApiException && settingsPromise == null && !activity.isFinishing) {
            try {
              settingsPromise = promise
              error.startResolutionForResult(activity, settingsRequestCode)
            } catch (_: Exception) {
              settingsPromise = null
              promise.resolve(false)
            }
          } else {
            promise.resolve(false)
          }
        }
    }
  }

  private fun toPosition(location: Location, provider: String) = Arguments.createMap().apply {
    putMap("coords", Arguments.createMap().apply {
      putDouble("latitude", location.latitude)
      putDouble("longitude", location.longitude)
      putDouble("accuracy", if (location.hasAccuracy()) location.accuracy.toDouble() else 0.0)
    })
    putDouble("timestamp", location.time.toDouble())
    putBoolean("mocked", if (Build.VERSION.SDK_INT >= 31) location.isMock else location.isFromMockProvider)
    putString("provider", provider)
  }

  @ReactMethod
  fun capture(id: Int, high: Boolean, timeout: Int, target: Double, promise: Promise) {
    handler.post {
      if (!permitted()) {
        promise.reject("permission", "Location permission is unavailable.")
        return@post
      }
      if (!locationEnabled()) {
        promise.reject("disabled", "Location services are disabled.")
        return@post
      }
      val deadline = SystemClock.elapsedRealtime() + timeout
      val token = CancellationTokenSource()
      var listener: LocationListener? = null
      var best: Location? = null
      var provider = "fused"
      lateinit var timer: Runnable
      fun finish(location: Location?, error: String) {
        if (!requests.containsKey(id)) return
        requests[id]?.invoke(false)
        if (location == null) promise.reject(error, "Location acquisition ended.")
        else promise.resolve(toPosition(location, provider))
      }
      timer = Runnable { finish(best, "timeout") }
      requests[id] = { cancelled ->
        requests.remove(id)
        handler.removeCallbacks(timer)
        token.cancel()
        listener?.let { manager.removeUpdates(it) }
        if (cancelled) promise.reject("cancelled", "Location acquisition was cancelled.")
      }
      handler.postDelayed(timer, timeout.toLong())

      fun startPlatform(fusedError: String) {
        if (!requests.containsKey(id) || SystemClock.elapsedRealtime() >= deadline) return
        provider = "android"
        val startedAt = SystemClock.elapsedRealtimeNanos()
        val update = object : LocationListener {
          override fun onLocationChanged(location: Location) {
            if (location.elapsedRealtimeNanos >= startedAt && location.hasAccuracy() && location.accuracy > 0) {
              if (best == null || location.accuracy <= best!!.accuracy) best = location
              if (location.accuracy <= target) finish(location, "timeout")
            }
          }
          override fun onProviderEnabled(provider: String) = Unit
          override fun onProviderDisabled(provider: String) = Unit
          override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        listener = update
        val candidates = if (high) listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
          else listOf(LocationManager.NETWORK_PROVIDER)
        var registered = false
        for (name in candidates) {
          try {
            if (manager.isProviderEnabled(name)) {
              manager.requestLocationUpdates(name, 1000L, 0f, update, Looper.getMainLooper())
              registered = true
            }
          } catch (_: SecurityException) {
            // Approximate permission can restrict particular providers.
          } catch (_: IllegalArgumentException) {
            // Some Android devices do not expose a network provider.
          }
        }
        if (!registered) {
          finish(null, if (high) fusedError else "network_unavailable")
        }
      }

      if (!hasPlayServices()) {
        startPlatform("play_services_unavailable")
        return@post
      }
      try {
        val request = CurrentLocationRequest.Builder()
          .setPriority(if (high) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY)
          .setMaxUpdateAgeMillis(0)
          .setDurationMillis(timeout.toLong())
          .build()
        LocationServices.getFusedLocationProviderClient(context).getCurrentLocation(request, token.token)
          .addOnSuccessListener { location ->
            if (location == null) finish(null, "timeout") else finish(location, "timeout")
          }
          .addOnFailureListener { startPlatform("provider_failure") }
      } catch (_: SecurityException) {
        finish(null, "permission")
      }
    }
  }

  @ReactMethod
  fun cancel(id: Int) {
    handler.post { requests[id]?.invoke(true) }
  }

  @ReactMethod
  fun cached(promise: Promise) {
    handler.post {
      val results = Arguments.createArray()
      if (!permitted() || !locationEnabled()) {
        promise.resolve(results)
        return@post
      }
      for (provider in manager.allProviders) {
        try {
          manager.getLastKnownLocation(provider)?.let { results.pushMap(toPosition(it, provider)) }
        } catch (_: SecurityException) {
          // Skip providers unavailable at the current permission level.
        }
      }
      if (!hasPlayServices()) {
        promise.resolve(results)
        return@post
      }
      try {
        LocationServices.getFusedLocationProviderClient(context).lastLocation
          .addOnSuccessListener { location ->
            location?.let { results.pushMap(toPosition(it, "fused-cache")) }
            promise.resolve(results)
          }
          .addOnFailureListener { promise.resolve(results) }
      } catch (_: SecurityException) {
        promise.resolve(results)
      }
    }
  }

  override fun invalidate() {
    context.removeActivityEventListener(activityListener)
    handler.post {
      requests.values.toList().forEach { it(true) }
      settingsPromise?.resolve(false)
      settingsPromise = null
    }
    super.invalidate()
  }
}

class ForegroundLocationPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(ForegroundLocationModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
