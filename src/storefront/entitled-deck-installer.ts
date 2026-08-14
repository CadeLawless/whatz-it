import type { SQLiteDatabase } from 'expo-sqlite';

import { downloadVerified } from '@/catalog/catalog-sync';
import { parseDeckContentArtifact } from '@/catalog/catalog-wire';

import type { InstallationIdentity } from './installation-identity';

type DeckArtifactRow = {
  deck_id: string;
  card_content_version: number;
  card_count: number;
  content_hash: string | null;
  content_bytes: number | null;
};

export async function installEntitledDeck(
  database: SQLiteDatabase,
  apiBaseUrl: string,
  identity: InstallationIdentity,
  deckId: string,
) {
  const row = await database.getFirstAsync<DeckArtifactRow>(
    `SELECT deck_id, card_content_version, card_count, content_hash, content_bytes
       FROM decks WHERE deck_id = ? AND lifecycle_status = 'active'`,
    deckId,
  );
  if (!row || !row.content_hash || !row.content_bytes) {
    throw new Error(`Deck ${deckId} has no published content artifact.`);
  }
  const installed = await database.getFirstAsync<{ installed_content_version: number | null }>(
    'SELECT installed_content_version FROM deck_installations WHERE deck_id = ?',
    deckId,
  );
  if (installed?.installed_content_version === row.card_content_version) return;

  await database.runAsync(
    "UPDATE deck_installations SET status = 'pending', last_error_code = NULL WHERE deck_id = ?",
    deckId,
  );
  try {
    const url = `${apiBaseUrl}/api/v1/decks/${encodeURIComponent(deckId)}/content/${row.card_content_version}`;
    const bytes = await downloadVerified(
      url,
      row.content_bytes,
      row.content_hash,
      undefined,
      undefined,
      {
        Authorization: `Bearer ${identity.credential}`,
        'X-Whatzit-Installation-Id': identity.installationId,
      },
    );
    const artifact = parseDeckContentArtifact(
      JSON.parse(new TextDecoder().decode(bytes)),
      {
        id: row.deck_id,
        cardContentVersion: row.card_content_version,
        cardCount: row.card_count,
      },
    );
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM cards WHERE deck_id = ?', deckId);
      for (const [position, card] of artifact.cards.entries()) {
        await transaction.runAsync(
          `INSERT INTO cards (deck_id, card_content_version, card_id, position, text, byline)
           VALUES (?, ?, ?, ?, ?, ?)`,
          deckId,
          artifact.cardContentVersion,
          card.id,
          position,
          card.text,
          card.byline ?? null,
        );
      }
      await transaction.runAsync(
        `UPDATE deck_installations SET ownership_source = 'none', status = 'installed',
         desired_content_version = ?, installed_content_version = ?,
         last_verified_at = ?, last_error_code = NULL WHERE deck_id = ?`,
        row.card_content_version,
        row.card_content_version,
        new Date().toISOString(),
        deckId,
      );
    });
  } catch (error) {
    await database.runAsync(
      "UPDATE deck_installations SET status = 'failed', last_error_code = 'preparation_failed' WHERE deck_id = ?",
      deckId,
    );
    throw error;
  }
}
