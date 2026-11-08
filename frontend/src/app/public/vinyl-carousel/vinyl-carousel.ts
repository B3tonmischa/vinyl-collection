import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Input, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Vinyl } from '../../models/vinyl.model';
import { VinylCardComponent } from '../vinyl-card/vinyl-card';
import {
  canAnimateStep,
  clampStepTarget,
  computeWindow,
  easeOutCubic,
  easeOutSeptic,
  easedPosition,
  randomIndex,
  rollInDurationMs,
  spinOffsetPx,
  spinSizeAnchors,
  spinSlotStyle,
  spinSlots,
  stepDurationMs,
  wrapIndex,
} from './vinyl-carousel.logic';

/** How many virtual slots (not wraps) the roll-in spin travels before landing. */
const SPIN_DISTANCE = 20;
/** How many slots either side of center the spin filmstrip renders. */
const SPIN_SLOT_RADIUS = 3;
/** Matches the steady-state row's own `gap-3`. */
const SPIN_GAP_PX = 12;
/** How far (in slots) queued steps may run ahead of what's on screen. */
const MAX_STEP_LEAD = 2;

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
  styles: [
    `
      /*
       * A soft ellipse on the "ground" below the cover, with a gap so the
       * record looks like it's hovering. Sized in percentages so it scales
       * with the card through the spin and the size transitions. The
       * caption sits below it — see .caption-overlay in VinylCardComponent.
       */
      .floating-card::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 2%;
        right: 2%;
        height: 9%;
        margin-top: 2%;
        background: radial-gradient(closest-side, rgb(0 0 0 / 0.35), transparent);
        pointer-events: none;
      }
    `,
  ],
  host: {
    tabindex: '0',
    class: 'block h-full w-full outline-none',
    '(keydown.ArrowLeft)': 'prev()',
    '(keydown.ArrowRight)': 'next()',
  },
})
export class VinylCarouselComponent {
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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

  /** True while the filmstrip is shown: the roll-in spin, or a card-to-card step. */
  protected readonly spinning = signal(false);
  /** True during the roll-in only; manual navigation is ignored until it lands. */
  private readonly rollingIn = signal(false);
  /** Continuous fractional center position, only meaningful while spinning. */
  private readonly spinPosition = signal<number | null>(null);
  /** Unwrapped slot the running animation lands on. */
  private animationTarget = 0;
  private rafId: number | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelAnimation());
  }

  @Input({ required: true })
  set vinyls(value: Vinyl[]) {
    this._vinyls.set(value);
    if (value.length > 0 && this._center() === null) {
      this.startRollIn(randomIndex(value.length));
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
    if (this.spinning() || this.dragged) return;
    if (item.offset === 0) {
      this.openCentered();
    } else {
      // The offset, not index - center: index math breaks across the wrap.
      this.shift(item.offset);
    }
  }

  /** A click on a card while a step is still gliding retargets to it. */
  protected onSpinCardClick(card: { virtualIndex: number }): void {
    if (this.rollingIn() || this.dragged) return;
    this.shift(card.virtualIndex - this.animationTarget);
  }

  protected prev(): void {
    this.shift(-1);
  }

  protected next(): void {
    this.shift(1);
  }

  /**
   * Moves the center by `delta` slots. With enough records, this glides
   * through the same filmstrip as the roll-in. Input that arrives
   * mid-glide adds to the pending target and restarts the ease from the
   * current position, so rapid presses keep moving instead of being
   * dropped.
   */
  private shift(delta: number): void {
    if (this.rollingIn() || delta === 0) return;
    const list = this._vinyls();
    const center = this._center();
    if (center === null || list.length === 0) return;
    if (this.reducedMotion || !canAnimateStep(list.length)) {
      this._center.set(wrapIndex(center + delta, list.length));
      return;
    }
    const gliding = this.spinning();
    const position = this.spinPosition() ?? center;
    const base = gliding ? this.animationTarget : center;
    const target = clampStepTarget(base + delta, position, MAX_STEP_LEAD);
    if (gliding && target === this.animationTarget) return;
    this.keepFocusOnHost();
    this.animate(position, target, stepDurationMs(false), easeOutCubic);
  }

  /**
   * A clicked card's button is replaced by the filmstrip, which would drop
   * focus to <body> and stop the host's arrow-key bindings. Hand focus to
   * the host first. Focus on the prev/next buttons stays where it is.
   */
  private keepFocusOnHost(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[data-carousel-card]')) {
      this.host.nativeElement.focus({ preventScroll: true });
    }
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
   * Spins the carousel onto `target` with one long, decelerating motion,
   * starting SPIN_DISTANCE slots back.
   */
  private startRollIn(target: number): void {
    if (this.reducedMotion) {
      this._center.set(target);
      return;
    }
    this.rollingIn.set(true);
    this.animate(target - SPIN_DISTANCE, target, rollInDurationMs(false), easeOutSeptic);
  }

  /**
   * Glides the filmstrip from `from` to `to` (unwrapped slots) with a
   * `requestAnimationFrame` loop driving a fractional position rather than
   * discrete steps. Each frame reads the eased position directly, so a new
   * call can take over mid-flight from wherever the strip currently is.
   */
  private animate(from: number, to: number, durationMs: number, ease: (t: number) => number): void {
    this.cancelAnimation();
    this.animationTarget = to;
    this.spinPosition.set(from);
    this.spinning.set(true);

    const startTime = performance.now();
    const tick = (now: number) => {
      const t = (now - startTime) / durationMs;
      if (t >= 1) {
        this.rafId = null;
        this.spinPosition.set(null);
        this._center.set(wrapIndex(to, this._vinyls().length));
        this.spinning.set(false);
        this.rollingIn.set(false);
        return;
      }
      this.spinPosition.set(easedPosition(from, to, t, ease));
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private cancelAnimation(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private dragStartX: number | null = null;
  /** Set when a pointer gesture was a drag, so the click that follows it doesn't also retarget. */
  private dragged = false;

  protected onPointerDown(event: PointerEvent): void {
    this.dragStartX = event.clientX;
    this.dragged = false;
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.rollingIn()) return;
    if (this.dragStartX === null) return;
    const delta = event.clientX - this.dragStartX;
    this.dragStartX = null;
    const threshold = 40;
    this.dragged = Math.abs(delta) > threshold;
    if (delta > threshold) this.prev();
    else if (delta < -threshold) this.next();
  }
}
