const MAX_NAME_LENGTH = 32;

export function cleanPlayerName(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
}

export function encodePlayerName(name: string): string {
  return JSON.stringify({ version: 1, kind: 'player-name', name: cleanPlayerName(name) });
}

export function parsePlayerName(body: string): string | null {
  if (body.length > 160) return null;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const wire = value as Record<string, unknown>;
    if (Object.keys(wire).sort().join() !== 'kind,name,version' ||
      wire.version !== 1 || wire.kind !== 'player-name' || typeof wire.name !== 'string' ||
      wire.name !== cleanPlayerName(wire.name)) return null;
    return wire.name;
  } catch { return null; }
}
