// augur's android bridge to NsdManager - the companion to
// `haruspex::augur::android`'s jni calls (see that module's own doc
// comment for the rust side of this).
//
// this file is NOT compiled by cargo at all - kotlin/gradle has no
// equivalent of a cargo path dependency, so any android gradle project
// that wants the real (not no-op-stub) augur android backend needs to
// add this exact file to its own kotlin source set. the simplest way:
// point an extra gradle source directory straight at this file's real
// path (no copy, no drift) -
//
//   android {
//       sourceSets {
//           getByName("main") {
//               kotlin.srcDir("<path to this file's containing directory>")
//           }
//       }
//   }
//
// (see charnel's own `app/build.gradle.kts` for a real, working example
// of this wiring.)
//
// manifest requirements: `android.permission.INTERNET` and
// `android.permission.ACCESS_WIFI_STATE` (nsdmanager needs both to
// advertise/discover at all); no multicast entitlement of any kind is
// needed for a specific, pre-declared service type like this one.
package net.freqhole.augur

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log

private const val TAG = "AugurNsdBridge"

/**
 * one process-wide advertise + discover session. a real freqhole process
 * has at most one iroh endpoint using augur at a time, so a singleton
 * (rather than per-instance state threaded through jni) keeps this
 * simple - matches how `NsdManager` itself is a single system service
 * per process anyway.
 */
object NsdBridge {
    private var nsdManager: NsdManager? = null

    // ------------------------------------------------------------------
    // advertising (this device's own endpoint)
    // ------------------------------------------------------------------

    private var registrationListener: NsdManager.RegistrationListener? = null

    /**
     * advertises this device's iroh endpoint. re-registering (a second
     * call while already advertising) first unregisters the previous
     * registration - `NsdServiceInfo` fields can't be changed in place
     * once registered, so a fresh registration is the only way to
     * publish updated data (e.g. the device's address changed networks).
     *
     * `userData`/`relayUrl` use `""` (not null) to mean "absent" - keeps
     * the jni signature on the rust side to plain strings, no null
     * handling needed on either side.
     */
    @JvmStatic
    fun startAdvertising(
        context: Context,
        instanceName: String,
        serviceType: String,
        port: Int,
        userData: String,
        relayUrl: String,
    ) {
        stopAdvertising()
        val manager = nsdManagerFor(context)
        val info = NsdServiceInfo().apply {
            serviceName = instanceName
            this.serviceType = serviceType
            this.port = port
            if (userData.isNotEmpty()) setAttribute("user-data", userData)
            if (relayUrl.isNotEmpty()) setAttribute("relay", relayUrl)
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                Log.d(TAG, "advertising started: ${info.serviceName}")
            }

            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "advertising failed to start, error $errorCode")
            }

            override fun onServiceUnregistered(info: NsdServiceInfo) {
                Log.d(TAG, "advertising stopped: ${info.serviceName}")
            }

            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "failed to stop advertising, error $errorCode")
            }
        }
        registrationListener = listener
        manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
    }

    @JvmStatic
    fun stopAdvertising() {
        val listener = registrationListener ?: return
        registrationListener = null
        runCatching { nsdManager?.unregisterService(listener) }
            .onFailure { Log.w(TAG, "stopAdvertising: unregister failed", it) }
    }

    // ------------------------------------------------------------------
    // discovery (other devices' endpoints)
    // ------------------------------------------------------------------

    private var discoveryListener: NsdManager.DiscoveryListener? = null

    // `NsdManager.resolveService` throws if a previous resolve is still
    // in flight (a well-known, long-standing nsdmanager quirk, not fixed
    // across all android versions this app supports) - so found services
    // are queued and resolved one at a time instead of concurrently.
    private data class ResolveRequest(
        val info: NsdServiceInfo,
        val generation: Long,
        val revision: Long,
    )
    private val pendingResolves = ArrayDeque<ResolveRequest>()
    private var resolving = false
    private var discoveryGeneration = 0L
    private var serviceRevision = 0L
    private val presentServices = mutableMapOf<String, Long>()

    /**
     * starts browsing for other augur endpoints under `serviceType`.
     * idempotent - a second call while already discovering is a no-op,
     * since (unlike advertising) there's nothing to "refresh" here.
     */
    @JvmStatic
    fun startDiscovery(context: Context, serviceType: String) {
        synchronized(NsdBridge) { startDiscoveryLocked(context, serviceType) }
    }

    private fun startDiscoveryLocked(context: Context, serviceType: String) {
        if (discoveryListener != null) return
        val manager = nsdManagerFor(context)
        val generation = ++discoveryGeneration
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                Log.d(TAG, "discovery started for $regType")
            }

            override fun onServiceFound(info: NsdServiceInfo) {
                synchronized(NsdBridge) {
                    if (generation != discoveryGeneration || discoveryListener == null) return
                    val revision = ++serviceRevision
                    presentServices[info.serviceName] = revision
                    pendingResolves.removeAll { it.info.serviceName == info.serviceName }
                    pendingResolves.addLast(ResolveRequest(info, generation, revision))
                    resolveNext(manager)
                }
            }

            override fun onServiceLost(info: NsdServiceInfo) {
                synchronized(NsdBridge) {
                    if (generation != discoveryGeneration || discoveryListener == null) return
                    presentServices.remove(info.serviceName)
                    pendingResolves.removeAll { it.info.serviceName == info.serviceName }
                    nativeOnLost(info.serviceName)
                }
            }

            override fun onDiscoveryStopped(regType: String) {
                Log.d(TAG, "discovery stopped for $regType")
            }

            override fun onStartDiscoveryFailed(regType: String, errorCode: Int) {
                Log.w(TAG, "discovery failed to start, error $errorCode")
                synchronized(NsdBridge) {
                    if (generation != discoveryGeneration) return
                    discoveryListener = null
                    pendingResolves.clear()
                    presentServices.clear()
                }
            }

            override fun onStopDiscoveryFailed(regType: String, errorCode: Int) {
                Log.w(TAG, "discovery failed to stop, error $errorCode")
            }
        }
        discoveryListener = listener
        manager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
    }

    /**
     * stops browsing - called once the rust side's shared discovery
     * ref-count drops to zero (no more live `resolve()`/`subscribe()`
     * consumers), so this doesn't run forever in the background once
     * first triggered. any still-pending resolves are dropped too.
     */
    @JvmStatic
    fun stopDiscovery() {
        synchronized(NsdBridge) { stopDiscoveryLocked() }
    }

    private fun stopDiscoveryLocked() {
        val listener = discoveryListener
        discoveryListener = null
        ++discoveryGeneration
        pendingResolves.clear()
        presentServices.clear()
        // an old resolve still owns NsdManager's single resolve slot until
        // its callback completes; reopening must not start a concurrent one.
        if (listener == null) return
        runCatching { nsdManager?.stopServiceDiscovery(listener) }
            .onFailure { Log.w(TAG, "stopDiscovery: failed", it) }
    }

    // `resolveService(info, listener)` and `NsdServiceInfo.host` are both
    // deprecated in favor of api-34+ overloads (`executor` param,
    // `hostAddresses` list) - deliberately kept since minSdk here is 24.
    @Suppress("DEPRECATION")
    @Synchronized
    private fun resolveNext(manager: NsdManager) {
        if (resolving) return
        val next = pendingResolves.removeFirstOrNull() ?: return
        resolving = true
        manager.resolveService(next.info, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "resolve failed for ${info.serviceName}, error $errorCode")
                synchronized(NsdBridge) {
                    resolving = false
                    resolveNext(manager)
                }
            }

            override fun onServiceResolved(info: NsdServiceInfo) {
                synchronized(NsdBridge) {
                    val current = next.generation == discoveryGeneration &&
                        presentServices[next.info.serviceName] == next.revision
                    val host = info.host?.hostAddress ?: ""
                    if (current && host.isNotEmpty()) {
                        val userData = String(info.attributes["user-data"] ?: ByteArray(0))
                        val relayUrl = String(info.attributes["relay"] ?: ByteArray(0))
                        nativeOnResolved(info.serviceName, host, info.port, userData, relayUrl)
                    }
                    resolving = false
                    resolveNext(manager)
                }
            }
        })
    }

    private fun nsdManagerFor(context: Context): NsdManager {
        val existing = nsdManager
        if (existing != null) return existing
        val manager = context.applicationContext
            .getSystemService(Context.NSD_SERVICE) as NsdManager
        nsdManager = manager
        return manager
    }

    // ------------------------------------------------------------------
    // native callbacks, implemented rust-side (see `android.rs`)
    // ------------------------------------------------------------------

    @JvmStatic
    private external fun nativeOnResolved(
        instanceName: String,
        host: String,
        port: Int,
        userData: String,
        relayUrl: String,
    )

    @JvmStatic
    private external fun nativeOnLost(instanceName: String)
}
