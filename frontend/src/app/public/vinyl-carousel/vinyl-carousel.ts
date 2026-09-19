import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Vinyl } from '../../models/vinyl.model';
import { VinylCardComponent } from '../vinyl-card/vinyl-card';
import { computeWindow, randomIndex } from './vinyl-carousel.logic';

/**
 * Default (no-search) browse view: a horizontal carousel closer to
 * flipping through a crate of records than scanning a list. Renders only
 * the 5-card window around the center (offsets -2..2) — cheap regardless
 * of collection size. Landing here (including via back-navigation, since
 * the component is re-created) picks a random starting center; the
 * collection's own order is otherwise left as the API returns it.
 */
@Component({
  selector: 'app-vinyl-carousel',
  imports: [VinylCardComponent],
  templateUrl: './vinyl-carousel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    tabindex: '0',
    class: 'block h-full w-full outline-none',
    '(keydown.ArrowLeft)': 'prev()',
    '(keydown.ArrowRight)': 'next()',
  },
})
export class VinylCarouselComponent {
  private readonly router = inject(Router);

  private readonly _vinyls = signal<Vinyl[]>([]);
  private readonly _center = signal<number | null>(null);

  @Input({ required: true })
  set vinyls(value: Vinyl[]) {
    this._vinyls.set(value);
    if (value.length > 0 && this._center() === null) {
      this._center.set(randomIndex(value.length));
    }
  }

  protected readonly windowCards = computed(() => {
    const list = this._vinyls();
    const center = this._center();
    if (center === null || list.length === 0) return [];
    return computeWindow(center, list.length).map((item) => ({ ...item, vinyl: list[item.index] }));
  });

  protected cardSizeClass(offset: number): string {
    if (offset === 0) return 'w-56 sm:w-64';
    if (offset === -1 || offset === 1) return 'w-36 sm:w-44 opacity-80';
    return 'w-20 sm:w-24 opacity-40';
  }

  protected onCardClick(item: { offset: number; index: number }): void {
    if (item.offset === 0) {
      this.openCentered();
    } else {
      this._center.set(item.index);
    }
  }

  protected prev(): void {
    this.shift(-1);
  }

  protected next(): void {
    this.shift(1);
  }

  private shift(delta: number): void {
    const list = this._vinyls();
    const center = this._center();
    if (center === null || list.length === 0) return;
    this._center.set((((center + delta) % list.length) + list.length) % list.length);
  }

  private openCentered(): void {
    const list = this._vinyls();
    const center = this._center();
    if (center === null) return;
    const vinyl = list[center];
    if (vinyl) {
      void this.router.navigate(['/vinyl', vinyl.id]);
    }
  }

  private dragStartX: number | null = null;

  protected onPointerDown(event: PointerEvent): void {
    this.dragStartX = event.clientX;
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.dragStartX === null) return;
    const delta = event.clientX - this.dragStartX;
    this.dragStartX = null;
    const threshold = 40;
    if (delta > threshold) this.prev();
    else if (delta < -threshold) this.next();
  }
}
