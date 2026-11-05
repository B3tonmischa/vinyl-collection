// Pure rule extracted from ComboboxComponent so it can be unit-tested
// without instantiating the component.

/**
 * Whether the "+ Add" option is offered for a query: always, unless the
 * query is blank or exactly matches an existing label. Similar labels don't
 * count ("Fa" can be added next to "Faber"). The match ignores case and
 * surrounding whitespace, like the backend's find-or-create for artists.
 */
export function canCreateOption(query: string, existingLabels: string[]): boolean {
  const name = query.trim().toLowerCase();
  if (name.length === 0) return false;
  return !existingLabels.some((label) => label.trim().toLowerCase() === name);
}
