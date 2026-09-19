import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { ArtistsApiService } from '../../core/services/artists-api';
import { Artist } from '../../models/vinyl.model';
import { ComboboxComponent, ComboboxOption } from '../../shared/combobox/combobox';

/** Album-level artist chip list, backed by a search-and-create combobox. */
@Component({
  selector: 'app-artist-picker',
  imports: [ComboboxComponent],
  templateUrl: './artist-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArtistPickerComponent {
  @Input({ required: true }) selected!: Artist[];
  @Output() selectedChange = new EventEmitter<Artist[]>();

  private readonly artistsApi = inject(ArtistsApiService);
  private readonly query = signal('');
  protected readonly searchResource = this.artistsApi.searchResource(this.query);

  protected get options(): ComboboxOption[] {
    const selectedIds = new Set(this.selected.map((a) => a.id));
    return (this.searchResource.value() ?? [])
      .filter((a) => !selectedIds.has(a.id))
      .map((a) => ({ id: a.id, label: a.name }));
  }

  protected onQueryChange(value: string): void {
    this.query.set(value);
  }

  protected onOptionSelected(option: ComboboxOption): void {
    this.add({ id: option.id, name: option.label });
  }

  protected async onCreateRequested(name: string): Promise<void> {
    const artist = await this.artistsApi.create(name);
    this.add(artist);
  }

  protected remove(artist: Artist): void {
    this.selectedChange.emit(this.selected.filter((a) => a.id !== artist.id));
  }

  private add(artist: Artist): void {
    if (this.selected.some((a) => a.id === artist.id)) return;
    this.selectedChange.emit([...this.selected, artist]);
  }
}
