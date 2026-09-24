import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

/** Scroll distance (px) past which the button becomes visible. */
const SHOW_AFTER_PX = 400;

/**
 * Floating "back to top" button. Hidden until the window has scrolled past
 * SHOW_AFTER_PX; smooth-scrolls to the top on click (instant when the user
 * prefers reduced motion).
 */
@Component({
  selector: 'app-scroll-to-top',
  templateUrl: './scroll-to-top.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()' },
})
export class ScrollToTop {
  protected readonly visible = signal(window.scrollY > SHOW_AFTER_PX);

  protected onScroll(): void {
    this.visible.set(window.scrollY > SHOW_AFTER_PX);
  }

  protected scrollToTop(): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
}
