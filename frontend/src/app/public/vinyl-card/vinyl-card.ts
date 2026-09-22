import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { ApiConfigService } from '../../core/services/api-config';
import { Vinyl } from '../../models/vinyl.model';

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
})
export class VinylCardComponent {
  @Input({ required: true }) vinyl!: Vinyl;
  /** Hide the title/artist caption — used by the carousel's roll-in spin, where fast-changing text is just noise. */
  @Input() showCaption = true;

  private readonly apiConfig = inject(ApiConfigService);

  protected get coverUrl(): string | null {
    const cover = this.vinyl.images?.find((img) => img.kind === 'COVER_FRONT');
    return cover ? this.apiConfig.uploadUrl(this.vinyl.id, cover.thumbPath) : null;
  }

  protected get artistNames(): string {
    return this.vinyl.artists.map((a) => a.name).join(', ');
  }
}
