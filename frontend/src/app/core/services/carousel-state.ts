import { Service } from '@angular/core';

/**
 * Remembers the gallery carousel's state across route changes. The
 * carousel is re-created every time the gallery is shown (back from a
 * record's detail page, clearing a search, leaving admin), but this
 * service lives for the whole page load, so a full reload starts fresh.
 */
@Service()
export class CarouselStateService {
  /** Set once the first roll-in has started, so later visits don't replay it. */
  rolledIn = false;
  /** Id of the record last centered in the carousel. An id, not an index: the list is refetched and may have changed. */
  centeredVinylId: number | null = null;
}
