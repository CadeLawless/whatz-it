// Synchronous guard for audio work already awaiting preparation when SharePlay opens.
let blocked = false;
export function setSharePlayAudioBlocked(value: boolean) { blocked = value; }
export function isSharePlayAudioBlocked() { return blocked; }
