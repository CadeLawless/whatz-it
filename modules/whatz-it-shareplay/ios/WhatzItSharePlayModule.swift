import Combine
import CryptoKit
import ExpoModulesCore
import GroupActivities
import UIKit

// Combine also exports Record; this payload uses Expo's bridge record protocol.
struct SharePlayActivityRecord: ExpoModulesCore.Record {
  @Field var protocolVersion: Int = 4
  @Field var environment: String = ""
  @Field var nonce: String = ""
  @Field var deckId: String = ""
  @Field var deckTitle: String = ""
  @Field var durationSeconds: Int = 60
}

private struct WhatzItActivity: GroupActivity {
  static var activityIdentifier: String {
    "\(Bundle.main.bundleIdentifier ?? "com.cadelawless.whatzit").remote-play-prototype"
  }
  let protocolVersion: Int
  let environment: String
  let nonce: String
  let deckId: String
  let deckTitle: String
  let durationSeconds: Int
  let hostPublicKey: String

  var metadata: GroupActivityMetadata {
    var metadata = GroupActivityMetadata()
    metadata.title = "WHATZ IT? · SharePlay"
    metadata.type = .generic
    return metadata
  }

  var dictionary: [String: Any] {
    ["protocolVersion": protocolVersion, "environment": environment, "nonce": nonce,
     "deckId": deckId, "deckTitle": deckTitle, "durationSeconds": durationSeconds,
     "hostPublicKey": hostPublicKey]
  }
}

private struct WireMessage: Codable {
  let body: String
  let hostSignature: String?
}

private enum SharePlayError: String, Error, LocalizedError {
  case disabled, incompatibleActivity, busy, noPresenter, notJoined, invalidMessage, notHost
  var errorDescription: String? { "SharePlay: \(rawValue)" }
}

// UIKit presentation, session replacement, and event delivery have one serial owner.
@MainActor
private final class SharePlayCoordinator {
  static let shared = SharePlayCoordinator()
  var emit: ((String, [String: Any]) -> Void)?
  private var observer: Task<Void, Never>?
  private var receivers: [Task<Void, Never>] = []
  private var subscriptions = Set<AnyCancellable>()
  private var session: GroupSession<WhatzItActivity>?
  private var messenger: GroupSessionMessenger?
  private var environment = ""
  private var revision = 0
  private var status = "idle"
  private var initiatedNonce: String?
  private var hostSigningKey: Curve25519.Signing.PrivateKey?
  private var hostParticipantId: String?
  private var presenting = false
  private var lastNoisyTraceAt: [String: TimeInterval] = [:]

  private func short(_ value: String) -> String { String(value.suffix(8)) }

  private func trace(_ stage: String, _ fields: [String: Any] = [:]) {
    let kind = fields["kind"] as? String ?? ""
    if stage.hasPrefix("message.") && ["view", "clock", "clock-reply", "snapshot-request", "host-claim", "ping", "pong"].contains(kind) {
      let key = "\(stage):\(kind)"
      let now = Date().timeIntervalSince1970
      if now - (lastNoisyTraceAt[key] ?? 0) < 10 { return }
      lastNoisyTraceAt[key] = now
    }
    let payload = fields.merging(["stage": stage]) { _, new in new }
    NSLog("[SharePlay] %@ %@", stage, String(describing: fields))
    emit?("onDiagnostic", payload)
  }

  private func messageKind(_ body: String) -> String {
    guard let data = body.data(using: .utf8),
          let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let kind = object["kind"] as? String else { return "unknown" }
    let known: Set<String> = ["ping", "pong", "view", "clock", "clock-reply",
      "snapshot-request", "intent", "inventory", "inventory-request",
      "deck-request", "deck-cards", "host-claim", "host-transfer"]
    return known.contains(kind) ? kind : "unknown"
  }

  func start(environment: String) throws -> [String: Any] {
    trace("start.request", ["status": status])
    guard Bundle.main.object(forInfoDictionaryKey: "WhatzItSharePlayPrototypeEnabled") as? Bool == true else {
      throw SharePlayError.disabled
    }
    guard !environment.isEmpty, environment.count <= 64 else { throw SharePlayError.disabled }
    if observer != nil { trace("start.reused", ["status": status]); return snapshot() }
    self.environment = environment
    observer = Task { [weak self] in
      for await incoming in WhatzItActivity.sessions() {
        guard !Task.isCancelled, let self else { return }
        guard incoming.activity.protocolVersion == 4,
              incoming.activity.environment == self.environment,
              (30...300).contains(incoming.activity.durationSeconds),
              !incoming.activity.deckId.isEmpty, incoming.activity.deckId.count <= 128,
              incoming.activity.deckTitle.count <= 160,
              UUID(uuidString: incoming.activity.nonce) != nil,
              let publicData = Data(base64Encoded: incoming.activity.hostPublicKey),
              (try? Curve25519.Signing.PublicKey(rawRepresentation: publicData)) != nil else {
          incoming.leave()
          self.trace("activity.rejected", ["code": "incompatibleActivity"])
          self.emit?("onError", ["code": "incompatibleActivity"])
          continue
        }
        guard self.session == nil else {
          self.trace("activity.duplicate", ["session": self.short(incoming.id.uuidString)])
          if self.session?.id != incoming.id { incoming.leave() }
          continue
        }
        self.attach(incoming)
      }
    }
    return snapshot()
  }

  func snapshot() -> [String: Any] {
    ["revision": revision, "status": status,
     "sessionId": session.map { $0.id.uuidString } as Any? ?? NSNull(),
     "localParticipantId": session.map { $0.localParticipant.id.uuidString } as Any? ?? NSNull(),
     "participantIds": session.map {
       Set($0.activeParticipants.map { $0.id.uuidString } + [$0.localParticipant.id.uuidString]).sorted()
     } ?? [],
     "isHost": isHost,
     "hostParticipantId": hostParticipantId as Any? ?? NSNull(),
     "activity": session?.activity.dictionary as Any? ?? NSNull()]
  }

  private func publish() {
    revision += 1
    trace("session.snapshot", ["status": status,
      "session": session.map { short($0.id.uuidString) } ?? "none",
      "members": session.map { Set($0.activeParticipants.map { $0.id.uuidString } + [$0.localParticipant.id.uuidString]).count } ?? 0,
      "isHost": isHost])
    emit?("onSession", snapshot())
  }

  private var isHost: Bool {
    guard let session, let key = hostSigningKey else { return false }
    return session.activity.nonce == initiatedNonce &&
      session.activity.hostPublicKey == key.publicKey.rawRepresentation.base64EncodedString()
  }

  private func signedData(sessionId: UUID, senderId: UUID, body: String) -> Data {
    Data("\(sessionId.uuidString):\(senderId.uuidString):\(body)".utf8)
  }

  private func attach(_ incoming: GroupSession<WhatzItActivity>) {
    trace("session.attach", ["session": short(incoming.id.uuidString)])
    session = incoming
    hostParticipantId = isHost ? incoming.localParticipant.id.uuidString : nil
    status = "waiting"
    messenger = GroupSessionMessenger(session: incoming, deliveryMode: .reliable)
    incoming.$state.sink { [weak self, weak incoming] _ in
      Task { @MainActor in
        guard let self, let incoming, self.session?.id == incoming.id else { return }
        // Read the current state when the main-actor task runs. An older
        // queued Combine event must not move a joined session back to waiting.
        switch incoming.state {
        case .waiting: self.status = "waiting"
        case .joined: self.status = "joined"
        case .invalidated(let reason):
          self.trace("session.invalidated", ["code": String(describing: reason)])
          self.clear(status: "ended")
          self.emit?("onError", ["code": "sessionInvalidated", "detail": reason.localizedDescription])
          return
        @unknown default: self.clear(status: "ended"); return
        }
        self.publish()
      }
    }.store(in: &subscriptions)
    incoming.$activeParticipants.sink { [weak self, weak incoming] _ in
      Task { @MainActor in
        guard let self, let incoming, self.session?.id == incoming.id else { return }
        self.publish()
      }
    }.store(in: &subscriptions)
    if let messenger {
      receivers.append(Task { [weak self, weak incoming] in
        guard let self, let incoming else { return }
        self.trace("message.receiver.started", ["session": self.short(incoming.id.uuidString)])
        for await (data, context) in messenger.messages(of: Data.self) {
          guard !Task.isCancelled, self.session?.id == incoming.id else { return }
          guard let message = try? JSONDecoder().decode(WireMessage.self, from: data),
                message.body.utf8.count <= 16_384 else {
            self.trace("message.decode.rejected", ["bytes": data.count])
            continue
          }
          let senderId = context.source.id.uuidString
          let senderIsHost: Bool = {
            guard let signature = message.hostSignature,
                  let signatureData = Data(base64Encoded: signature),
                  let publicData = Data(base64Encoded: incoming.activity.hostPublicKey),
                  let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: publicData) else { return false }
            return publicKey.isValidSignature(signatureData,
              for: self.signedData(sessionId: incoming.id, senderId: context.source.id, body: message.body))
          }()
          if senderIsHost && self.hostParticipantId != senderId {
            self.hostParticipantId = senderId
            self.publish()
          }
          self.trace("message.received", ["session": self.short(incoming.id.uuidString),
            "participant": self.short(senderId), "kind": self.messageKind(message.body),
            "bytes": message.body.utf8.count, "isHost": senderIsHost])
          self.emit?("onMessage", ["sessionId": incoming.id.uuidString,
                                    "senderId": senderId, "body": message.body,
                                    "senderIsHost": senderIsHost])
        }
        self.trace("message.receiver.ended", ["session": self.short(incoming.id.uuidString)])
      })
    }
    publish()
    // Join the advertised activity as soon as the transport is observing it.
    // Requiring both people to tap a second Join control made setup fragile.
    if case .waiting = incoming.state { incoming.join() }
    trace("session.join.request", ["session": short(incoming.id.uuidString)])
  }

  func invite(_ record: SharePlayActivityRecord) async throws -> String {
    trace("invite.request", ["status": status])
    guard observer != nil else { throw SharePlayError.disabled }
    guard session == nil, !presenting else { throw SharePlayError.busy }
    guard record.environment == environment, record.protocolVersion == 4,
          UUID(uuidString: record.nonce) != nil,
          !record.deckId.isEmpty, record.deckId.count <= 128,
          record.deckTitle.count <= 160, (30...300).contains(record.durationSeconds) else {
      throw SharePlayError.incompatibleActivity
    }
    let signingKey = Curve25519.Signing.PrivateKey()
    let activity = WhatzItActivity(protocolVersion: 4, environment: environment,
      nonce: record.nonce, deckId: record.deckId, deckTitle: record.deckTitle,
      durationSeconds: record.durationSeconds,
      hostPublicKey: signingKey.publicKey.rawRepresentation.base64EncodedString())
    guard var presenter = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene }).filter({ $0.activationState == .foregroundActive })
      .flatMap({ $0.windows }).first(where: { $0.isKeyWindow })?.rootViewController else {
      throw SharePlayError.noPresenter
    }
    while let presented = presenter.presentedViewController { presenter = presented }
    guard !presenter.isBeingDismissed, !presenter.isBeingPresented else { throw SharePlayError.busy }
    let controller = try GroupActivitySharingController(activity)
    presenting = true
    initiatedNonce = record.nonce
    hostSigningKey = signingKey
    defer { presenting = false }
    presenter.present(controller, animated: true)
    let result = await controller.result
    trace("invite.result", ["result": result == .cancelled ? "cancelled" : "success"])
    if result == .cancelled {
      if session == nil { initiatedNonce = nil; hostSigningKey = nil }
      return "cancelled"
    }
    return "success"
  }

  func join() throws {
    trace("join.request", ["status": status])
    guard let session, status == "waiting" || status == "joined" else { throw SharePlayError.notJoined }
    if status == "waiting" { session.join() }
  }

  func send(_ body: String, recipients: [String]) async throws {
    trace("message.send.request", ["kind": messageKind(body), "bytes": body.utf8.count,
      "recipients": recipients.count, "status": status])
    guard let session, let messenger, status == "joined" else { throw SharePlayError.notJoined }
    guard !body.isEmpty, body.utf8.count <= 16_384, !recipients.isEmpty else {
      throw SharePlayError.invalidMessage
    }
    let targets = session.activeParticipants.filter { recipients.contains($0.id.uuidString) }
    guard targets.count == Set(recipients).count else { throw SharePlayError.invalidMessage }
    var signature: String?
    if isHost, let key = hostSigningKey {
      let data = signedData(sessionId: session.id, senderId: session.localParticipant.id, body: body)
      signature = try key.signature(for: data).base64EncodedString()
    }
    do {
      let data = try JSONEncoder().encode(WireMessage(body: body, hostSignature: signature))
      try await messenger.send(data, to: .only(targets))
      trace("message.send.success", ["kind": messageKind(body), "recipients": targets.count])
    } catch {
      let nativeError = error as NSError
      trace("message.send.failure", ["kind": messageKind(body),
        "code": "\(nativeError.domain):\(nativeError.code)"])
      throw error
    }
  }

  func leave() {
    trace("session.leave", ["status": status])
    if status == "waiting" || status == "joined" { session?.leave() }
    clear(status: "idle")
  }

  func end() throws {
    trace("session.end.request", ["status": status])
    // Group sessions are ownerless. The app elects a new lobby host when the
    // original inviter leaves, and that participant may end the activity.
    guard let session, status == "joined" else { throw SharePlayError.notJoined }
    session.end()
    clear(status: "ended")
  }

  private func clear(status: String) {
    trace("session.clear", ["status": status])
    receivers.forEach { $0.cancel() }; receivers.removeAll()
    subscriptions.removeAll()
    messenger = nil; session = nil; initiatedNonce = nil; hostSigningKey = nil; hostParticipantId = nil
    self.status = status
    publish()
  }

  func stop() {
    trace("observer.stop")
    observer?.cancel(); observer = nil
    leave()
    emit = nil
  }
}

public class WhatzItSharePlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WhatzItSharePlay")
    Events("onSession", "onMessage", "onError", "onDiagnostic")
    AsyncFunction("startAsync") { (environment: String) async throws -> [String: Any] in
      try await MainActor.run {
        SharePlayCoordinator.shared.emit = { [weak self] name, payload in self?.sendEvent(name, payload) }
        return try SharePlayCoordinator.shared.start(environment: environment)
      }
    }
    AsyncFunction("getSnapshotAsync") { () async -> [String: Any] in
      await SharePlayCoordinator.shared.snapshot()
    }
    AsyncFunction("inviteAsync") { (activity: SharePlayActivityRecord) async throws -> String in
      try await SharePlayCoordinator.shared.invite(activity)
    }
    AsyncFunction("joinAsync") { () async throws in try await SharePlayCoordinator.shared.join() }
    AsyncFunction("sendAsync") { (body: String, recipients: [String]) async throws in
      try await SharePlayCoordinator.shared.send(body, recipients: recipients)
    }
    AsyncFunction("leaveAsync") { () async in await SharePlayCoordinator.shared.leave() }
    AsyncFunction("endAsync") { () async throws in try await SharePlayCoordinator.shared.end() }
    AsyncFunction("stopAsync") { () async in await SharePlayCoordinator.shared.stop() }
    // The singleton retains the session and signing key through a JS reload.
    OnDestroy { Task { @MainActor in SharePlayCoordinator.shared.emit = nil } }
  }
}
