import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ApiConfigService } from '../../core/services/api-config';
import { VinylImage } from '../../models/vinyl.model';
import { lightboxSlides, positionLabel, startIndex, stepIndex, swipeStep } from './lightbox.logic';

export interface LightboxData {
  vinylId: number;
  images: readonly VinylImage[];
  /** The image to open on; the first one when null or not among `images`. */
  startImageId: number | null;
}

/**
 * Opens the lightbox over the page. Focus goes back to `trigger` when it
 * closes — passed explicitly because Safari doesn't focus a clicked button.
 */
export function openLightbox(dialog: Dialog, data: LightboxData, trigger?: HTMLElement): void {
  dialog.open(LightboxComponent, {
    data,
    ariaLabel: 'Photos of this record',
    ariaModal: true,
    autoFocus: '.lightbox-close',
    width: '100vw',
    height: '100dvh',
    maxWidth: '100vw',
    maxHeight: '100dvh',
    restoreFocus: trigger ?? true,
  });
}

/**
 * A record's photos one at a time, full size, over a dark backdrop.
 *
 * Pages with the arrow buttons, the left and right arrow keys or a swipe,
 * wrapping round at either end. Closes on the X, Escape (CDK Dialog) or a
 * click on the dark area around the photo; the dialog traps focus while
 * open and hands it back to whatever opened it.
 *
 * Only the photo on show has an <img>, so full-size files load as they are
 * paged to rather than all at once.
 */
@Component({
  selector: 'app-lightbox',
  templateUrl: './lightbox.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full w-full',
    '(keydown.arrowleft)': 'step(-1)',
    '(keydown.arrowright)': 'step(1)',
    '(click)': 'onBackdropClick($event)',
  },
})
export class LightboxComponent {
  private readonly data = inject<LightboxData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly apiConfig = inject(ApiConfigService);

  protected readonly slides = lightboxSlides(this.data.images);
  protected readonly index = signal(startIndex(this.slides, this.data.startImageId));
  protected readonly slide = computed(() => this.slides[this.index()]);
  protected readonly position = computed(() => positionLabel(this.index(), this.slides.length));
  protected readonly url = computed(() => {
    const slide = this.slide();
    return slide ? this.apiConfig.uploadUrl(this.data.vinylId, slide.image.fullPath) : '';
  });
  /** Id of the image whose file has loaded, so the spinner shows only while one is on its way. */
  protected readonly loadedId = signal<number | null>(null);

  private touchStart: { x: number; y: number } | null = null;
  /** Set by a swipe so the click some browsers fire after it doesn't close the lightbox. */
  private swiped = false;

  protected step(delta: number): void {
    if (this.slides.length < 2) return;
    this.index.update((index) => stepIndex(index, delta, this.slides.length));
  }

  protected close(): void {
    this.dialogRef.close();
  }

  /**
   * The panel fills the screen, so CDK's own backdrop is never clicked: a
   * click anywhere off the photo and the buttons closes the lightbox
   * instead. Escape is the keyboard route to the same.
   */
  protected onBackdropClick(event: MouseEvent): void {
    if (this.swiped) {
      this.swiped = false;
      return;
    }
    const target = event.target as Element | null;
    if (!target?.closest('img, button')) this.close();
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse') return;
    this.touchStart = { x: event.clientX, y: event.clientY };
    this.swiped = false;
  }

  protected onPointerUp(event: PointerEvent): void {
    const start = this.touchStart;
    this.touchStart = null;
    if (!start) return;
    const delta = swipeStep(event.clientX - start.x, event.clientY - start.y);
    if (delta === 0) return;
    this.swiped = true;
    this.step(delta);
  }

  protected onPointerCancel(): void {
    this.touchStart = null;
  }
}
