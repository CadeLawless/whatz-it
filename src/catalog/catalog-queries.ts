export const INSTALLED_CARD_ROWS_SQL = `
  SELECT c.deck_id, c.card_content_version, c.card_id,
         c.position, c.text, c.byline
    FROM cards c
    JOIN deck_installations i
      ON i.deck_id = c.deck_id
     AND i.installed_content_version = c.card_content_version
    JOIN decks d ON d.deck_id = c.deck_id
   WHERE d.lifecycle_status = 'active'
   ORDER BY c.deck_id, c.card_content_version, c.position
`;
