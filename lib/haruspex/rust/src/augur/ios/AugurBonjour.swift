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
    private var resolutions: [NWEndpoint: NWConnection] = [:]

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
            listener.service = NWListener.Service(name: instanceName, type: serviceType, txtRecord: txt)
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
        queue.sync { startDiscoveryOnQueue(serviceType: serviceType) }
    }

    private func startDiscoveryOnQueue(serviceType: String) {
        guard browser == nil else {
            return
        }
        // includePeerToPeer opts this browse into AWDL (apple's private
        // peer-to-peer wifi mesh) in addition to plain infrastructure
        // wifi - off by default on `.udp`. confirmed via a real device's
        // syslog (2026-10-17 investigation) that apple's own airplayd
        // explicitly requests this (its browse logs show `AWDL`/
        // `IncludeAWDL` flags) while this browser previously didn't -
        // kept on even after the real root cause (swarm-discovery's
        // missing PTR record + TTL=0 "goodbye" packets, fixed in
        // swarm-discovery 0.6.5) was found and fixed, since this is
        // still a real, independently-correct capability match with
        // apple's own first-party bonjour clients, not just a discarded
        // guess.
        let params = NWParameters.udp
        params.includePeerToPeer = true
        let browser = NWBrowser(for: .bonjour(type: serviceType, domain: nil), using: params)
        browser.browseResultsChangedHandler = { [weak self, weak browser] _, changes in
            guard let self, let browser, self.browser === browser else { return }
            for change in changes {
                switch change {
                case .added(let result), .changed(old: _, new: let result, flags: _):
                    self.resolve(result, browser: browser)
                case .removed(let result):
                    self.resolutions.removeValue(forKey: result.endpoint)?.cancel()
                    if case let .service(name, _, _, _) = result.endpoint {
                        name.withCString { augurIosOnLost($0) }
                    }
                default:
                    break
                }
            }
        }
        self.browser = browser
        browser.start(queue: queue)
    }

    /// stops browsing - called once the rust side's shared discovery
    /// ref-count drops to zero (no more live `resolve()`/`subscribe()`
    /// consumers), so this doesn't run forever in the background once
    /// first triggered.
    func stopDiscovery() {
        queue.sync {
            browser?.cancel()
            browser = nil
            for connection in resolutions.values { connection.cancel() }
            resolutions.removeAll()
        }
    }

    /// `NWBrowser` finds instances but doesn't resolve their host/port/txt
    /// on its own - opening (and immediately cancelling once connected) a
    /// real `NWConnection` to the bonjour endpoint is the standard way to
    /// force that resolution, same as the android backend's dedicated
    /// `resolveService` call.
    private func resolve(_ result: NWBrowser.Result, browser: NWBrowser) {
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
        resolutions.removeValue(forKey: result.endpoint)?.cancel()
        resolutions[result.endpoint] = connection
        connection.stateUpdateHandler = { [weak self, weak browser, weak connection] state in
            guard let self, let browser, let connection,
                self.browser === browser,
                self.resolutions[result.endpoint] === connection
            else { return }
            switch state {
            case .ready:
                defer {
                    self.resolutions.removeValue(forKey: result.endpoint)
                    connection.cancel()
                }
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
                self.resolutions.removeValue(forKey: result.endpoint)
                connection.cancel()
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
