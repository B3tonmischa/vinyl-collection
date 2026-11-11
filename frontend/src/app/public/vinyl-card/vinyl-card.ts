import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { ApiConfigService } from '../../core/services/api-config';
import { VinylSummary } from '../../models/vinyl.model';

/**
 * Purely presentational: cover thumbnail, title, artist(s), year. Shared by
 * the carousel's cards and the search grid's cells — each parent supplies
 * its own clickable wrapper (a routed link for the grid, a re-center/open
 * button for the carousel), so this component has no navigation of its own.
 */
@Component({
  selector: 'app-vinyl-card',
  templateUrl: './vinyl-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @keyframes caption-drop-in {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .animate-caption-drop-in {
        animation: caption-drop-in 350ms ease-out;
      }

      /* Clears the carousel's floating shadow, and scales with it. */
      .caption-overlay {
        margin-top: 14%;
      }
    `,
  ],
})
export class VinylCardComponent {
  @Input({ required: true }) vinyl!: VinylSummary;
  /** Hide the title/artist caption — used by the carousel's roll-in spin, where fast-changing text is just noise. */
  @Input() showCaption = true;
  /**
   * Position the caption absolutely below the image (fading/dropping in)
   * instead of in normal flow, so its appearance can never shift the
   * image's own position — used by the carousel, where cards otherwise
   * swap between a caption-less spin and a captioned steady state. The
   * grid view leaves this off, since its layout relies on the caption's
   * height to space rows.
   */
  @Input() captionOverlay = false;
  /**
   * Play the overlay caption's drop-in when it appears. The carousel turns
   * this off once the user steps between cards, since the caption then
   * rides along with the card instead of appearing fresh.
   */
  @Input() captionDropIn = true;

  private readonly apiConfig = inject(ApiConfigService);

  protected get coverUrl(): string | null {
    const path = this.vinyl.coverThumbPath;
    return path ? this.apiConfig.uploadUrl(this.vinyl.id, path) : null;
  }

  protected get artistNames(): string {
    return this.vinyl.artists.map((a) => a.name).join(', ');
  }
}
