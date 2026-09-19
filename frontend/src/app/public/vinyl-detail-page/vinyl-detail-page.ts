import { ChangeDetectionStrategy, Component, Input, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VinylsApiService } from '../../core/services/vinyls-api';
import {
  DISC_SIZE_LABELS,
  RELEASE_TYPE_LABELS,
  SPEED_LABELS,
  Vinyl,
} from '../../models/vinyl.model';
import { DiscGalleryComponent } from '../disc-gallery/disc-gallery';
import { TracklistComponent } from '../tracklist/tracklist';

@Component({
  selector: 'app-vinyl-detail-page',
  imports: [DiscGalleryComponent, TracklistComponent, RouterLink],
  templateUrl: './vinyl-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VinylDetailPage {
  private readonly vinylsApi = inject(VinylsApiService);
  private readonly _id = signal<number | null>(null);

  /** Bound from the `:id` route param via withComponentInputBinding(). */
  @Input()
  set id(value: string) {
    const parsed = Number(value);
    this._id.set(Number.isFinite(parsed) ? parsed : null);
  }

  protected readonly detailResource = this.vinylsApi.detailResource(this._id);

  protected artistNames(vinyl: Vinyl): string {
    return vinyl.artists.map((a) => a.name).join(', ');
  }

  protected metaLine(vinyl: Vinyl): string {
    const parts: string[] = [];
    if (vinyl.label) parts.push(vinyl.label);
    if (vinyl.catalogNumber) parts.push(vinyl.catalogNumber);
    if (vinyl.releaseType) parts.push(RELEASE_TYPE_LABELS[vinyl.releaseType]);
    if (vinyl.discSize) parts.push(DISC_SIZE_LABELS[vinyl.discSize]);
    if (vinyl.speed) parts.push(SPEED_LABELS[vinyl.speed]);
    if (vinyl.genre) parts.push(vinyl.genre);
    return parts.join(' · ');
  }
}
