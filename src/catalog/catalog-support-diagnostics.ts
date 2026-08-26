import type { CatalogSnapshot } from './catalog-snapshot';

const MAX_DECK_LINES = 60;

export type CatalogSupportDiagnosticsInput = {
  appVersion: string;
  catalog: CatalogSnapshot;
  platform: string;
  rolloutCohort: string;
  syncErrorCode?: string;
  syncStatus: string;
};

export function buildCatalogSupportDiagnosticsText(
  input: CatalogSupportDiagnosticsInput,
) {
  const installed = input.catalog.decks.filter(
    (deck) => deck.installationStatus === 'installed',
  );
  const attention = input.catalog.decks.filter(
    (deck) =>
      deck.installationStatus === 'pending' ||
      deck.installationStatus === 'failed',
  );
  const deckLines = installed.slice(0, MAX_DECK_LINES).map((deck) =>
    `- ${deck.id}: installed ${deck.installedContentVersion ?? 'unknown'}, desired ${deck.cardContentVersion}`,
  );
  if (installed.length > MAX_DECK_LINES) {
    deckLines.push(`- ${installed.length - MAX_DECK_LINES} more installed decks omitted`);
  }

  return [
    'WHATZ IT? diagnostics (no sensitive purchase data or card content)',
    `App: ${input.appVersion}`,
    `Platform: ${input.platform}`,
    `Catalog: revision ${input.catalog.revision}, schema ${input.catalog.schemaVersion}, source ${input.catalog.source}`,
    `Rollout: ${input.rolloutCohort}`,
    `Sync: ${input.syncStatus}${input.syncErrorCode ? ` (${input.syncErrorCode})` : ''}`,
    `Deck states: ${installed.length} installed, ${attention.length} pending/failed`,
    ...attention.map((deck) => `- ${deck.id}: ${deck.installationStatus}`),
    'Installed content versions:',
    ...deckLines,
  ].join('\n');
}

export function buildCatalogSupportFallbackEmailUrl(recipient: string) {
  const body = 'Please describe what happened:\n\n';
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent('WHATZ IT? Support')}&body=${encodeURIComponent(body)}`;
}
