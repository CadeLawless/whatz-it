export function sortStorefrontItems<T extends { id: string }>(
  items: readonly T[],
  managerOrder: readonly string[],
  isOwned: (item: T) => boolean,
) {
  const managerPosition = new Map(managerOrder.map((id, index) => [id, index]));
  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => {
      const ownershipDifference = Number(isOwned(left.item)) - Number(isOwned(right.item));
      if (ownershipDifference !== 0) return ownershipDifference;
      return (managerPosition.get(left.item.id) ?? Number.MAX_SAFE_INTEGER)
        - (managerPosition.get(right.item.id) ?? Number.MAX_SAFE_INTEGER)
        || left.originalIndex - right.originalIndex;
    })
    .map(({ item }) => item);
}

export function alphabeticalStorefrontOrder<T extends { id: string; title: string }>(
  items: readonly T[],
) {
  return [...items]
    .sort((left, right) =>
      left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
      || left.id.localeCompare(right.id),
    )
    .map((item) => item.id);
}
