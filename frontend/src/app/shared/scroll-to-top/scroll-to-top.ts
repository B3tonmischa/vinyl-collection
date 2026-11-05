import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * Floating "back to top" button. Hidden until the window has scrolled past
 * `showAfter`; smooth-scrolls to the top on click (instant when the user
 * prefers reduced motion).
 */
@Component({
  selector: 'app-scroll-to-top',
  templateUrl: './scroll-to-top.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()' },
})
export class ScrollToTop {
  /** Scroll distance (px) past which the button becomes visible. */
  readonly showAfter = input(400);

  private readonly scrollY = signal(window.scrollY);
  protected readonly visible = computed(() => this.scrollY() > this.showAfter());

  protected onScroll(): void {
    this.scrollY.set(window.scrollY);
  }

  protected scrollToTop(): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
}
