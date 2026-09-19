import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { ArtistsApiService } from '../../core/services/artists-api';
import { Artist } from '../../models/vinyl.model';
import { ComboboxComponent, ComboboxOption } from '../../shared/combobox/combobox';

/**
 * Track-level artist override control. Renders the album's own artists as
 * checkboxes (checked = currently applies to this track) plus any "guest"
 * artists added beyond the album's list, and a combobox to add another
 * guest. Pristine/dirty state itself is owned by the parent
 * (TrackListEditorComponent) — this component is a dumb renderer over
 * `dirty`/`overrideArtists` and just reports toggle/add/reset intents.
 */
@Component({
  selector: 'app-artist-override-picker',
  imports: [ComboboxComponent],
  templateUrl: './artist-override-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArtistOverridePickerComponent {
  @Input({ required: true }) albumArtists!: Artist[];
  @Input({ required: true }) dirty!: boolean;
  @Input({ required: true }) overrideArtists!: Artist[];

  /** Toggle membership of an album artist (or remove a guest). */
  @Output() toggle = new EventEmitter<Artist>();
  /** Add a new artist (from search or create) not currently displayed. */
  @Output() add = new EventEmitter<Artist>();
  @Output() resetToInherit = new EventEmitter<void>();

  private readonly artistsApi = inject(ArtistsApiService);
  private readonly query = signal('');
  protected readonly searchResource = this.artistsApi.searchResource(this.query);

  protected get displayedArtists(): Artist[] {
    return this.dirty ? this.overrideArtists : this.albumArtists;
  }

  protected get guestArtists(): Artist[] {
    const albumIds = new Set(this.albumArtists.map((a) => a.id));
    return this.displayedArtists.filter((a) => !albumIds.has(a.id));
  }

  protected isChecked(artist: Artist): boolean {
    return this.displayedArtists.some((a) => a.id === artist.id);
  }

  protected get comboboxOptions(): ComboboxOption[] {
    const shownIds = new Set(this.displayedArtists.map((a) => a.id));
    return (this.searchResource.value() ?? [])
      .filter((a) => !shownIds.has(a.id))
      .map((a) => ({ id: a.id, label: a.name }));
  }

  protected onQueryChange(value: string): void {
    this.query.set(value);
  }

  protected onOptionSelected(option: ComboboxOption): void {
    this.add.emit({ id: option.id, name: option.label });
  }

  protected async onCreateRequested(name: string): Promise<void> {
    const artist = await this.artistsApi.create(name);
    this.add.emit(artist);
  }
}
