import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiConfigService } from '../../core/services/api-config';
import { CoverTintService } from '../../core/services/cover-tint';
import { VinylsApiService } from '../../core/services/vinyls-api';
import {
  DISC_SIZE_LABELS,
  RELEASE_TYPE_LABELS,
  SPEED_LABELS,
  Vinyl,
} from '../../models/vinyl.model';
import { RecordViewerComponent } from '../record-viewer/record-viewer';
import { TracklistComponent } from '../tracklist/tracklist';
import { ScrollToTop } from '../../shared/scroll-to-top/scroll-to-top';
import { PageTint, pageTint } from './cover-tint.logic';

interface Fact {
  label: string;
  value: string;
}

@Component({
  selector: 'app-vinyl-detail-page',
  imports: [RecordViewerComponent, TracklistComponent, RouterLink, ScrollToTop],
  templateUrl: './vinyl-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VinylDetailPage {
  private readonly vinylsApi = inject(VinylsApiService);
  private readonly apiConfig = inject(ApiConfigService);
  private readonly coverTint = inject(CoverTintService);
  private readonly _id = signal<number | null>(null);

  /** Bound from the `:id` route param via withComponentInputBinding(). */
  @Input()
  set id(value: string) {
    const parsed = Number(value);
    this._id.set(Number.isFinite(parsed) ? parsed : null);
  }

  protected readonly detailResource = this.vinylsApi.detailResource(this._id);

  /** URL of the front cover's thumbnail — small, and all the tint needs. */
  private readonly coverUrl = computed(() => {
    const vinyl = this.detailResource.hasValue() ? this.detailResource.value() : undefined;
    const cover = vinyl?.images.find((img) => img.kind === 'COVER_FRONT');
    return vinyl && cover ? this.apiConfig.uploadUrl(vinyl.id, cover.thumbPath) : undefined;
  });

  private readonly coverColor = resource({
    params: () => this.coverUrl(),
    loader: ({ params }) => this.coverTint.colorOf(params),
  });

  /**
   * The page's colours, taken from the front cover. Undefined (the neutral
   * defaults in styles.css apply) while unknown, without a cover, or for a
   * cover with no real colour. A colour remembered from an earlier visit is
   * used straight away instead of waiting for the resource.
   */
  protected readonly tint = computed<PageTint | undefined>(() => {
    const url = this.coverUrl();
    if (!url) return undefined;
    const color = this.coverColor.hasValue() ? this.coverColor.value() : this.coverTint.cached(url);
    return color ? pageTint(color) : undefined;
  });

  protected artistNames(vinyl: Vinyl): string {
    return vinyl.artists.map((a) => a.name).join(', ');
  }

  /** The pressing's facts as labelled pairs; ones without a value are left out. */
  protected facts(vinyl: Vinyl): Fact[] {
    const facts: Fact[] = [];
    if (vinyl.label) facts.push({ label: 'Label', value: vinyl.label });
    if (vinyl.catalogNumber) facts.push({ label: 'Catalog no.', value: vinyl.catalogNumber });
    if (vinyl.genre) facts.push({ label: 'Genre', value: vinyl.genre });
    if (vinyl.releaseType) {
      facts.push({ label: 'Format', value: RELEASE_TYPE_LABELS[vinyl.releaseType] });
    }
    if (vinyl.discSize) facts.push({ label: 'Size', value: DISC_SIZE_LABELS[vinyl.discSize] });
    if (vinyl.speed) facts.push({ label: 'Speed', value: SPEED_LABELS[vinyl.speed] });
    return facts;
  }
}
