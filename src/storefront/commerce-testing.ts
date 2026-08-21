import type { SQLiteDatabase } from 'expo-sqlite';

export async function resetLocalPaidOwnership(database: SQLiteDatabase) {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(`
      DELETE FROM cards
      WHERE deck_id IN (SELECT deck_id FROM decks WHERE access = 'paid');

      UPDATE deck_installations
      SET ownership_source = 'none',
          installed_content_version = NULL,
          status = 'not_owned',
          last_verified_at = NULL,
          last_error_code = NULL
      WHERE deck_id IN (SELECT deck_id FROM decks WHERE access = 'paid');

      DELETE FROM commerce_entitlements;
      DELETE FROM commerce_state;
    `);
  });
}
