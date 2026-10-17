// augur's ios bridge to Network.framework's Bonjour apis (NWListener's
// advertising side, NWBrowser's discovery side) - the companion to
// `haruspex::augur::ios`'s calls into these `@_cdecl` functions (see that
// module's own doc comment for the rust side of this).
//
// unlike the android side, this file genuinely IS picked up
// automatically by any consumer - `../build.rs` compiles it directly
// with `swiftc` (no xcode project wiring needed) and links the result
// straight into whatever binary links this crate, the same way a `cc`-
// compiled c file would be. nothing to add to an xcode project at all.
//
// info.plist requirements: `NSBonjourServices` (list the exact service
// type string below) and `NSLocalNetworkUsageDescription` (a user-facing
// reason string) - both standard, no special entitlement needed for a
// specific, pre-declared service type like this one.
import Foundation
import Network

// MARK: - rust-exported callbacks (see `android/NsdBridge.kt`'s
// `nativeOnResolved`/`nativeOnLost` for the exact same shape, one
// layer down the stack)

@_silgen_name("augur_ios_on_resolved")
func augurIosOnResolved(
    _ instanceName: UnsafePointer<CChar>,
    _ host: UnsafePointer<CChar>,
    _ port: UInt16,
    _ userData: UnsafePointer<CChar>,
    _ relayUrl: UnsafePointer<CChar>
)

@_silgen_name("augur_ios_on_lost")
func augurIosOnLost(_ instanceName: UnsafePointer<CChar>)

// MARK: - state

/// one process-wide advertise + discover session - mirrors
/// `NsdBridge`'s own singleton reasoning (a real freqhole process has at
/// most one iroh endpoint using augur at a time).
private final class AugurBonjour {
    static let shared = AugurBonjour()

    private let queue = DispatchQueue(label: "net.freqhole.augur")
    private var listener: NWListener?
    private var browser: NWBrowser?

    /// `SERVICE_TYPE` (shared with the rust side, `wire.rs`) is written
    /// with a trailing dot (`"_irohv1._udp."`) for consistency with
    /// Info.plist's `NSBonjourServices` entry and the desktop/android
    /// backends' own conventions - but apple's own documented contract
    /// for both `NWBrowser.Descriptor.bonjour(type:domain:)` and
    /// `NWListener.Service(name:type:)`'s `type` parameter explicitly
    /// forbids a trailing dot there (only the separate `domain` parameter
    /// uses one, e.g. `"local."`). confirmed (2026-10-17 investigation)
    /// as the actual root cause of ios discovery silently finding
    /// nothing: `NWBrowser` still reaches `.ready` with a dotted type (no
    /// error surfaces anywhere), but the resulting query never matches
    /// real advertisements, which explains why this is ios-specific (the
    /// only backend going through this exact swift api) and why
    /// advertising (seemingly more lenient here) looked like it worked
    /// while browsing never did.
    private func stripTrailingDot(_ serviceType: String) -> String {
        serviceType.hasSuffix(".") ? String(serviceType.dropLast()) : serviceType
    }

    func startAdvertising(
        instanceName: String, serviceType: String, port: UInt16, userData: String, relayUrl: String
    ) {
        stopAdvertising()
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            return
        }
        var txt = NWTXTRecord()
        if !userData.isEmpty { txt["user-data"] = userData }
        if !relayUrl.isEmpty { txt["relay"] = relayUrl }
        do {
            let listener = try NWListener(using: .udp, on: nwPort)
            listener.service = NWListener.Service(
                name: instanceName, type: stripTrailingDot(serviceType), txtRecord: txt)
            // this listener exists purely for its mdns advertisement side
            // effect (matching how the desktop backend's swarm-discovery
            // and the android backend's `NsdManager.registerService` both
            // advertise without needing a real accept loop either) - any
            // inbound connection attempt is immediately dropped.
            listener.newConnectionHandler = { connection in
                connection.cancel()
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            // nothing more targeted to do - advertising just doesn't
            // start this time around; a future `publish()` call (iroh
            // re-publishes on address changes) gets another chance.
        }
    }

    func stopAdvertising() {
        listener?.cancel()
        listener = nil
    }

    func startDiscovery(serviceType: String) {
        guard browser == nil else {
            return
        }
        // includePeerToPeer opts this browse into AWDL (apple's private
        // peer-to-peer wifi mesh) in addition to plain infrastructure
        // wifi - off by default on `.udp`. confirmed via a real device's
        // syslog (2026-10-17 investigation) that apple's own airplayd
        // explicitly requests this (its browse logs show `AWDL`/
        // `IncludeAWDL` flags) while this browser previously didn't -
        // suspected cause of mdns discovery being unreliable on at least
        // one real iphone even though the exact same lan's desktop peers
        // discover each other fine.
        let params = NWParameters.udp
        params.includePeerToPeer = true
        let browser = NWBrowser(
            for: .bonjour(type: stripTrailingDot(serviceType), domain: nil), using: params)
        // TEMP DIAGNOSTIC (2026-10-17): confirms whether the browser itself
        // is healthy and whether results are now actually arriving -
        // remove once ios discovery reliability is confirmed fixed.
        browser.stateUpdateHandler = { state in
            NSLog("%@", "[augur TEMP DIAG] NWBrowser state: \(state)")
        }
        browser.browseResultsChangedHandler = { [weak self] results, changes in
            NSLog("%@", "[augur TEMP DIAG] browseResultsChanged: \(results.count) result(s)")
            for change in changes {
                switch change {
                case .added(let result), .changed(old: _, new: let result, flags: _):
                    self?.resolve(result)
                case .removed(let result):
                    if case let .service(name, _, _, _) = result.endpoint {
                        name.withCString { augurIosOnLost($0) }
                    }
                default:
                    break
                }
            }
        }
        browser.start(queue: queue)
        self.browser = browser
    }

    /// stops browsing - called once the rust side's shared discovery
    /// ref-count drops to zero (no more live `resolve()`/`subscribe()`
    /// consumers), so this doesn't run forever in the background once
    /// first triggered.
    func stopDiscovery() {
        browser?.cancel()
        browser = nil
    }

    /// `NWBrowser` finds instances but doesn't resolve their host/port/txt
    /// on its own - opening (and immediately cancelling once connected) a
    /// real `NWConnection` to the bonjour endpoint is the standard way to
    /// force that resolution, same as the android backend's dedicated
    /// `resolveService` call.
    private func resolve(_ result: NWBrowser.Result) {
        guard case let .service(name, type, domain, _) = result.endpoint else {
            return
        }
        var userData = ""
        var relayUrl = ""
        if case let .bonjour(txt) = result.metadata {
            if case let .string(value) = txt.getEntry(for: "user-data") { userData = value }
            if case let .string(value) = txt.getEntry(for: "relay") { relayUrl = value }
        }
        let endpoint = NWEndpoint.service(name: name, type: type, domain: domain, interface: nil)
        // same includePeerToPeer reasoning as startDiscovery's browser
        // above - a peer only reachable over AWDL needs it here too, or
        // this resolve connection would never reach .ready for it.
        let connParams = NWParameters.udp
        connParams.includePeerToPeer = true
        let connection = NWConnection(to: endpoint, using: connParams)
        // TEMP DIAGNOSTIC (2026-10-17): see startDiscovery's identical
        // reasoning - remove once ios discovery reliability is confirmed
        // fixed.
        NSLog("%@", "[augur TEMP DIAG] resolve() starting NWConnection to \(endpoint)")
        connection.stateUpdateHandler = { state in
            NSLog("%@", "[augur TEMP DIAG] resolve connection state for \(name): \(state)")
            switch state {
            case .ready:
                defer { connection.cancel() }
                guard case let .hostPort(host, port) = connection.currentPath?.remoteEndpoint else {
                    return
                }
                let hostString = "\(host)".components(separatedBy: "%").first ?? "\(host)"
                name.withCString { namePtr in
                    hostString.withCString { hostPtr in
                        userData.withCString { userDataPtr in
                            relayUrl.withCString { relayUrlPtr in
                                augurIosOnResolved(namePtr, hostPtr, port.rawValue, userDataPtr, relayUrlPtr)
                            }
                        }
                    }
                }
            case .failed, .cancelled:
                break
            default:
                break
            }
        }
        connection.start(queue: queue)
    }
}

// MARK: - exported entry points (see `android/NsdBridge.kt`'s
// `startAdvertising`/`stopAdvertising`/`startDiscovery` for the exact
// same shape, one layer down the stack)

@_cdecl("augur_start_advertising")
public func augurStartAdvertising(
    _ instanceName: UnsafePointer<CChar>,
    _ serviceType: UnsafePointer<CChar>,
    _ port: UInt16,
    _ userData: UnsafePointer<CChar>,
    _ relayUrl: UnsafePointer<CChar>
) {
    AugurBonjour.shared.startAdvertising(
        instanceName: String(cString: instanceName),
        serviceType: String(cString: serviceType),
        port: port,
        userData: String(cString: userData),
        relayUrl: String(cString: relayUrl)
    )
}

@_cdecl("augur_stop_advertising")
public func augurStopAdvertising() {
    AugurBonjour.shared.stopAdvertising()
}

@_cdecl("augur_start_discovery")
public func augurStartDiscovery(_ serviceType: UnsafePointer<CChar>) {
    AugurBonjour.shared.startDiscovery(serviceType: String(cString: serviceType))
}

@_cdecl("augur_stop_discovery")
public func augurStopDiscovery() {
    AugurBonjour.shared.stopDiscovery()
}
