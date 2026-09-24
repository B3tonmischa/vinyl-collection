import { ChangeDetectionStrategy, Component, Input, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ToastService } from '../../core/services/toast';
import { VinylsApiService } from '../../core/services/vinyls-api';
import {
  Artist,
  DISC_SIZES,
  DISC_SIZE_LABELS,
  DiscSize,
  RELEASE_TYPES,
  RELEASE_TYPE_LABELS,
  ReleaseType,
  SPEEDS,
  SPEED_LABELS,
  Speed,
  Vinyl,
  VinylPayload,
} from '../../models/vinyl.model';
import { ArtistPickerComponent } from '../artist-picker/artist-picker';
import { ImageUploadPanel } from '../image-upload-panel/image-upload-panel';
import { TrackListEditorComponent } from '../track-list-editor/track-list-editor';
import { TrackFormRow, trackRowToPayload } from '../track-list-editor/track-list-editor.logic';

@Component({
  selector: 'app-vinyl-form-page',
  imports: [ArtistPickerComponent, TrackListEditorComponent, ImageUploadPanel, RouterLink],
  templateUrl: './vinyl-form-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VinylFormPage {
  private readonly vinylsApi = inject(VinylsApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  private readonly _vinylId = signal<number | null>(null);

  /** Bound from the `:id` route param on the edit route; absent on `new`. */
  @Input()
  set id(value: string | undefined) {
    const parsed = value != null ? Number(value) : NaN;
    this._vinylId.set(Number.isFinite(parsed) ? parsed : null);
  }

  protected readonly isEdit = computed(() => this._vinylId() !== null);
  protected readonly detailResource = this.vinylsApi.detailResource(this._vinylId);

  protected readonly title = signal('');
  protected readonly year = signal<number | null>(null);
  protected readonly label = signal('');
  protected readonly catalogNumber = signal('');
  protected readonly releaseType = signal<ReleaseType | ''>('');
  protected readonly discSize = signal<DiscSize | ''>('');
  protected readonly speed = signal<Speed | ''>('');
  protected readonly genre = signal('');
  protected readonly notes = signal('');
  protected readonly signedByArtist = signal(false);
  protected readonly artists = signal<Artist[]>([]);
  protected readonly trackRows = signal<TrackFormRow[]>([]);

  protected readonly releaseTypes = RELEASE_TYPES;
  protected readonly discSizes = DISC_SIZES;
  protected readonly speeds = SPEEDS;
  protected readonly releaseTypeLabels = RELEASE_TYPE_LABELS;
  protected readonly discSizeLabels = DISC_SIZE_LABELS;
  protected readonly speedLabels = SPEED_LABELS;

  protected readonly saving = signal(false);
  private readonly appliedVinylId = signal<number | null>(null);

  constructor() {
    // Populate the form when a record loads, and again whenever the loaded
    // record is a different vinyl than the one currently applied (e.g. the
    // route navigates to a newly-imported vinyl while this component
    // instance is reused). Reloads of the same vinyl (save, image changes)
    // leave in-progress field edits alone.
    effect(() => {
      const vinyl = this.detailResource.value();
      if (!vinyl || vinyl.id === this.appliedVinylId()) return;
      this.applyVinyl(vinyl);
      this.appliedVinylId.set(vinyl.id);
    });
  }

  private applyVinyl(vinyl: Vinyl): void {
    this.title.set(vinyl.title);
    this.year.set(vinyl.year);
    this.label.set(vinyl.label ?? '');
    this.catalogNumber.set(vinyl.catalogNumber ?? '');
    this.releaseType.set(vinyl.releaseType ?? '');
    this.discSize.set(vinyl.discSize ?? '');
    this.speed.set(vinyl.speed ?? '');
    this.genre.set(vinyl.genre ?? '');
    this.notes.set(vinyl.notes ?? '');
    this.signedByArtist.set(vinyl.signedByArtist);
    this.artists.set(vinyl.artists);
    this.trackRows.set(
      [...vinyl.tracks]
        .sort((a, b) => a.position - b.position)
        .map((track) => ({
          key: crypto.randomUUID(),
          serverId: track.id,
          position: track.position,
          title: track.title,
          side: track.side ?? '',
          dirty: track.artists.length > 0,
          overrideArtists: track.artists,
        })),
    );
  }

  private buildPayload(): VinylPayload {
    return {
      title: this.title().trim(),
      year: this.year(),
      label: this.label().trim() || null,
      catalogNumber: this.catalogNumber().trim() || null,
      releaseType: this.releaseType() || null,
      discSize: this.discSize() || null,
      speed: this.speed() || null,
      genre: this.genre().trim() || null,
      notes: this.notes().trim() || null,
      signedByArtist: this.signedByArtist(),
      artistIds: this.artists().map((a) => a.id),
      tracks: this.trackRows().map(trackRowToPayload),
    };
  }

  protected async onSubmit(): Promise<void> {
    if (this.saving() || !this.title().trim()) return;
    this.saving.set(true);
    try {
      const payload = this.buildPayload();
      const vinylId = this._vinylId();
      if (vinylId !== null) {
        await this.vinylsApi.update(vinylId, payload);
        this.toast.show('Saved.');
        this.detailResource.reload();
      } else {
        const created = await this.vinylsApi.create(payload);
        this.toast.show('Created — you can add images now.');
        await this.router.navigate(['/admin', created.id, 'edit']);
      }
    } catch {
      this.toast.show("Couldn't save this record.");
    } finally {
      this.saving.set(false);
    }
  }

  protected onImagesChanged(): void {
    this.detailResource.reload();
  }
}
