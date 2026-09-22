import { ChangeDetectionStrategy, Component, DestroyRef, Input, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Vinyl } from '../../models/vinyl.model';
import { VinylCardComponent } from '../vinyl-card/vinyl-card';
import {
  computeWindow,
  randomIndex,
  rollInDurationMs,
  spinOffsetPx,
  spinPositionAt,
  spinSizeAnchors,
  spinSlotStyle,
  spinSlots,
} from './vinyl-carousel.logic';

/** How many virtual slots (not wraps) the roll-in spin travels before landing. */
const SPIN_DISTANCE = 20;
/** How many slots either side of center the spin filmstrip renders. */
const SPIN_SLOT_RADIUS = 3;
/** Matches the steady-state row's own `gap-3`. */
const SPIN_GAP_PX = 12;

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
  private readonly destroyRef = inject(DestroyRef);

  private readonly _vinyls = signal<Vinyl[]>([]);
  private readonly _center = signal<number | null>(null);

  private readonly reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Matches the `sm:` breakpoint cardSizeClass() switches on, so the spin's
  // card sizes land already at the size the steady-state view will show.
  private readonly spinAnchors = spinSizeAnchors(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 640px)').matches,
  );

  /** True while the roll-in spin is running; manual navigation is ignored until it lands. */
  protected readonly spinning = signal(false);
  /** Continuous fractional center position, only meaningful while spinning. */
  private readonly spinPosition = signal<number | null>(null);

  @Input({ required: true })
  set vinyls(value: Vinyl[]) {
    this._vinyls.set(value);
    if (value.length > 0 && this._center() === null) {
      this.startRollIn(randomIndex(value.length), value.length);
    }
  }

  protected readonly windowCards = computed(() => {
    const list = this._vinyls();
    const center = this._center();
    if (center === null || list.length === 0) return [];
    return computeWindow(center, list.length).map((item) => ({ ...item, vinyl: list[item.index] }));
  });

  protected readonly spinCards = computed(() => {
    const list = this._vinyls();
    const position = this.spinPosition();
    if (position === null || list.length === 0) return [];
    return spinSlots(position, list.length, SPIN_SLOT_RADIUS)
      .map((slot) => ({
        ...slot,
        vinyl: list[slot.index],
        style: spinSlotStyle(slot.distance, this.spinAnchors),
        offsetPx: spinOffsetPx(slot.distance, this.spinAnchors, SPIN_GAP_PX),
      }))
      .filter((slot) => slot.style.opacity > 0.001);
  });

  protected cardSizeClass(offset: number): string {
    if (offset === 0) return 'w-56 sm:w-64';
    if (offset === -1 || offset === 1) return 'w-36 sm:w-44 opacity-80';
    return 'w-20 sm:w-24 opacity-40';
  }

  protected onCardClick(item: { offset: number; index: number }): void {
    if (this.spinning()) return;
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
    if (this.spinning()) return;
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

  /**
   * Spins the carousel onto `target` with one continuous, decelerating
   * motion — a `requestAnimationFrame` loop driving a fractional position
   * — instead of discrete steps. Each frame just reads the eased position
   * directly, so there's nothing to restart or pause between frames.
   */
  private startRollIn(target: number, length: number): void {
    if (this.reducedMotion) {
      this._center.set(target);
      return;
    }
    const duration = rollInDurationMs(false);
    const realStart = target - SPIN_DISTANCE;
    this.spinPosition.set(realStart);
    this.spinning.set(true);

    const startTime = performance.now();
    const tick = (now: number) => {
      const t = (now - startTime) / duration;
      if (t >= 1) {
        this.spinPosition.set(null);
        this._center.set(target);
        this.spinning.set(false);
        return;
      }
      this.spinPosition.set(spinPositionAt(realStart, SPIN_DISTANCE, t));
      rafId = requestAnimationFrame(tick);
    };
    let rafId = requestAnimationFrame(tick);
    this.destroyRef.onDestroy(() => cancelAnimationFrame(rafId));
  }

  private dragStartX: number | null = null;

  protected onPointerDown(event: PointerEvent): void {
    this.dragStartX = event.clientX;
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.spinning()) return;
    if (this.dragStartX === null) return;
    const delta = event.clientX - this.dragStartX;
    this.dragStartX = null;
    const threshold = 40;
    if (delta > threshold) this.prev();
    else if (delta < -threshold) this.next();
  }
}
