import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { ApiConfigService } from '../../core/services/api-config';
import { VinylImage } from '../../models/vinyl.model';
import {
  RecordDisc,
  SleeveFace,
  SleeveView,
  canFlip,
  discSideLabel,
  focusesDiscs,
  innerPanels,
  recordLayout,
  recordParts,
  shownSide,
  viewAfterFaceClick,
} from './record-viewer.logic';

const VIEW_NAMES: Record<SleeveView, string> = {
  front: 'Front cover',
  open: 'Inner sleeve',
  back: 'Back cover',
};

/**
 * A record shown as the object it is: the sleeve in front with its discs
 * peeking out of the right edge.
 *
 * Clicking a disc rolls every disc out beside the sleeve; clicking one that
 * is out turns it over. On a phone the discs come out one at a time: the
 * first is centred with the sleeve pushed mostly off the side, and clicking
 * a neighbouring disc slides that one into the centre instead. Clicking the cover opens the gatefold (or turns to
 * the back cover when there are no inner sleeves); the left inner sleeve
 * closes it, the right one closes it and turns to the back cover.
 *
 * All state is plain signals and the motion is CSS transitions keyed off
 * data attributes — see record-viewer.css for the 3D structure.
 */
@Component({
  selector: 'app-record-viewer',
  templateUrl: './record-viewer.html',
  styleUrl: './record-viewer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordViewerComponent {
  readonly vinylId = input.required<number>();
  readonly images = input.required<VinylImage[]>();

  private readonly apiConfig = inject(ApiConfigService);
  private readonly scene = viewChild<ElementRef<HTMLElement>>('scene');

  protected readonly parts = computed(() => recordParts(this.images()));

  // Each resets when the page moves on to another record.
  protected readonly view = linkedSignal<number, SleeveView>({
    source: this.vinylId,
    computation: () => 'front',
  });
  protected readonly discsOut = linkedSignal<number, boolean>({
    source: this.vinylId,
    computation: () => false,
  });
  private readonly flipped = linkedSignal<number, ReadonlySet<number>>({
    source: this.vinylId,
    computation: () => new Set<number>(),
  });

  /** Index of the disc in the centre while the discs are out on a phone. */
  private readonly focused = linkedSignal<number, number>({
    source: this.vinylId,
    computation: () => 0,
  });

  /** Width / height of a lone inner sleeve photo, known once it has loaded. */
  private readonly soloInnerAspect = linkedSignal<number, number | null>({
    source: this.vinylId,
    computation: () => null,
  });
  protected readonly panels = computed(() => innerPanels(this.parts(), this.soloInnerAspect()));

  private readonly width = signal(0);
  /** Off for the first paint so the record doesn't animate into its resting place. */
  protected readonly ready = signal(false);

  /** The centred disc's index while the discs are out one at a time, else null. */
  private readonly focusedDisc = computed(() =>
    this.discsOut() && focusesDiscs(this.width()) ? this.focused() : null,
  );

  protected readonly layout = computed(() =>
    recordLayout(
      this.width(),
      this.view(),
      this.discsOut(),
      this.parts().discs.length,
      this.focusedDisc(),
    ),
  );

  protected readonly caption = computed(() => {
    const { discs } = this.parts();
    if (this.discsOut()) {
      const flipped = this.flipped();
      const focused = this.focusedDisc();
      return discs
        .filter((_, index) => focused === null || index === focused)
        .map((disc) => discSideLabel(disc, flipped.has(disc.discNumber), discs.length))
        .join(' · ');
    }
    return VIEW_NAMES[this.view()];
  });

  constructor() {
    effect((onCleanup) => {
      const element = this.scene()?.nativeElement;
      if (!element) return;
      this.width.set(element.clientWidth);
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.width.set(element.clientWidth));
      observer.observe(element);
      const frame = requestAnimationFrame(() => this.ready.set(true));
      onCleanup(() => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      });
    });
  }

  protected url(image: VinylImage): string {
    return this.apiConfig.uploadUrl(this.vinylId(), image.fullPath);
  }

  protected isFlipped(disc: RecordDisc): boolean {
    return this.flipped().has(disc.discNumber);
  }

  /** Whether a click on the front cover does anything. */
  protected get frontIsActionable(): boolean {
    const parts = this.parts();
    return this.discsOut() || parts.hasInner || parts.back !== null;
  }

  protected faceLabel(face: SleeveFace): string {
    const parts = this.parts();
    switch (face) {
      case 'front':
        if (this.discsOut()) return 'Put the discs back in the sleeve';
        if (parts.hasInner) return 'Open the sleeve';
        return parts.back ? 'Turn to the back cover' : 'Front cover';
      case 'inner-a':
        return 'Close the sleeve';
      case 'inner-b':
        return parts.back ? 'Close the sleeve and turn to the back cover' : 'Close the sleeve';
      case 'back':
        return 'Turn to the front cover';
    }
  }

  /** Whether a click on this disc brings it to the centre rather than turning it over. */
  protected bringsToCentre(index: number): boolean {
    const focused = this.focusedDisc();
    return focused !== null && focused !== index;
  }

  protected discLabel(disc: RecordDisc, index: number): string {
    if (!this.discsOut()) return 'Take the discs out of the sleeve';
    const name = discSideLabel(disc, this.isFlipped(disc), this.parts().discs.length);
    if (this.bringsToCentre(index)) return `Show ${name}`;
    return canFlip(disc) ? `${name}. Turn over` : name;
  }

  protected discAlt(disc: RecordDisc, side: 'A' | 'B'): string {
    return this.parts().discs.length > 1
      ? `Disc ${disc.discNumber}, side ${side}`
      : `Disc, side ${side}`;
  }

  /** The photo on the disc's upward face before it is turned over. */
  protected firstSide(disc: RecordDisc): { image: VinylImage; side: 'A' | 'B' } | null {
    const side = shownSide(disc, false);
    const image = side === 'A' ? disc.sideA : disc.sideB;
    return image ? { image, side } : null;
  }

  protected canFlip(disc: RecordDisc): boolean {
    return canFlip(disc);
  }

  protected onInnerLoad(event: Event): void {
    const { innerA, innerB } = this.parts();
    if (innerA && innerB) return;
    const img = event.target as HTMLImageElement;
    if (img.naturalHeight > 0) this.soloInnerAspect.set(img.naturalWidth / img.naturalHeight);
  }

  protected onFace(face: SleeveFace): void {
    if (face === 'front' && this.discsOut()) {
      this.discsOut.set(false);
      return;
    }
    this.view.set(viewAfterFaceClick(face, this.parts()));
  }

  protected onDisc(disc: RecordDisc, index: number): void {
    if (!this.discsOut()) {
      this.focused.set(0);
      this.discsOut.set(true);
      return;
    }
    if (this.bringsToCentre(index)) {
      this.focused.set(index);
      return;
    }
    if (!canFlip(disc)) return;
    const next = new Set(this.flipped());
    if (!next.delete(disc.discNumber)) next.add(disc.discNumber);
    this.flipped.set(next);
  }
}
