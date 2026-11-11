# Recover paused SharePlay rounds with standby checkpoints

When a SharePlay session host leaves during a paused round, WHATZ IT? will recover from a versioned authoritative checkpoint held transiently by up to two deterministic standby participants. A checkpoint is recoverable only after acknowledgment; the elected successor with the newest valid checkpoint restores the paused round, rebases its clock, and applies the agreed resume-authority transfer. If no acknowledged checkpoint survives, the session returns to the lobby with a clear recovery message.

## Considered Options

- Replicating full round state to every participant would maximize availability but expose hidden cards more broadly.
- Reconstructing from a deterministic seed and event log would still require distributing private deck content and would add substantially more ordering and replay complexity.
- Restricting replication to warm standbys fits the existing host-authoritative round model while limiting disclosure.

## Consequences

Recovery initially applies only to paused rounds. Standby checkpoints necessarily contain future card order and answers, so they must remain outside UI state, logs, diagnostics, and persistent storage and must be erased when the round or session ends. Pausing remains immediate while checkpoint delivery retries; abrupt host loss before any acknowledgment falls back honestly to the lobby rather than claiming guaranteed recovery.
