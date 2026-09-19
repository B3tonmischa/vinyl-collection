import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VinylsApiService } from '../../core/services/vinyls-api';
import { VinylCardComponent } from '../vinyl-card/vinyl-card';
import { VinylCarouselComponent } from '../vinyl-carousel/vinyl-carousel';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Public landing page. No active search: a carousel browsing the whole
 * collection (must fit the viewport with no vertical scroll — see the
 * carousel's own container). An active search: a normal scrollable grid
 * of results.
 */
@Component({
  selector: 'app-gallery-page',
  imports: [VinylCardComponent, VinylCarouselComponent, RouterLink],
  templateUrl: './gallery-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryPage {
  private readonly vinylsApi = inject(VinylsApiService);

  protected readonly searchInput = signal('');
  private readonly debouncedQuery = signal('');
  private debounceHandle: ReturnType<typeof setTimeout> | undefined;

  protected readonly hasActiveQuery = computed(() => this.debouncedQuery().trim().length > 0);
  protected readonly listResource = this.vinylsApi.listResource(this.debouncedQuery);

  protected onSearchInput(value: string): void {
    this.searchInput.set(value);
    clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => this.debouncedQuery.set(value), SEARCH_DEBOUNCE_MS);
  }
}
