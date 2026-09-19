import { ChangeDetectionStrategy, Component, Input, inject, signal } from '@angular/core';
import { ApiConfigService } from '../../core/services/api-config';
import { DISC_IMAGE_KINDS, PACKAGING_IMAGE_KINDS, VinylImage } from '../../models/vinyl.model';

/**
 * Packaging images (cover front/back, inner sleeve) plus per-disc side
 * images as static tabs — the flip animation is deferred past v1. "Which
 * side is active" is a plain signal rather than baked into DOM structure,
 * so swapping in a flip transition later is a template change only.
 */
@Component({
  selector: 'app-disc-gallery',
  templateUrl: './disc-gallery.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscGalleryComponent {
  @Input({ required: true }) vinylId!: number;
  @Input({ required: true }) images!: VinylImage[];

  private readonly apiConfig = inject(ApiConfigService);

  protected readonly activeTabIndex = signal(0);

  protected get packagingImages(): VinylImage[] {
    return this.images.filter((img) => PACKAGING_IMAGE_KINDS.includes(img.kind));
  }

  protected get discTabs(): VinylImage[] {
    return [...this.images]
      .filter((img) => DISC_IMAGE_KINDS.includes(img.kind))
      .sort((a, b) => a.discNumber - b.discNumber || a.kind.localeCompare(b.kind));
  }

  protected get hasMultipleDiscs(): boolean {
    return new Set(this.discTabs.map((t) => t.discNumber)).size > 1;
  }

  protected imageUrl(image: VinylImage): string {
    return this.apiConfig.uploadUrl(this.vinylId, image.fullPath);
  }

  protected thumbUrl(image: VinylImage): string {
    return this.apiConfig.uploadUrl(this.vinylId, image.thumbPath);
  }

  protected tabLabel(image: VinylImage): string {
    const side = image.kind === 'DISC_SIDE_A' ? 'A' : 'B';
    return this.hasMultipleDiscs ? `Disc ${image.discNumber} · Side ${side}` : `Side ${side}`;
  }
}
