import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Artist } from '../../models/vinyl.model';
import { ArtistOverridePickerComponent } from '../artist-override-picker/artist-override-picker';
import {
  TrackFormRow,
  addArtist,
  createEmptyTrackRow,
  nextSide,
  resetToInherit,
  sideForNewRow,
  toggleArtist,
} from './track-list-editor.logic';

export type { TrackFormRow } from './track-list-editor.logic';
export { createEmptyTrackRow } from './track-list-editor.logic';

@Component({
  selector: 'app-track-list-editor',
  imports: [ArtistOverridePickerComponent],
  templateUrl: './track-list-editor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackListEditorComponent {
  readonly rows = input.required<TrackFormRow[]>();
  readonly albumArtists = input.required<Artist[]>();
  /** Options of every row's side dropdown (see knownSides()). */
  readonly sides = input.required<string[]>();
  readonly rowsChange = output<TrackFormRow[]>();
  /** A new side was added with the "+" button next to a dropdown. */
  readonly sideAdded = output<string>();

  /** Side last picked on any row; new tracks start on it. */
  private readonly lastSelectedSide = signal<string | null>(null);

  protected readonly newSide = computed(() => nextSide(this.sides()));

  protected addTrack(): void {
    const rows = this.rows();
    const nextPosition = rows.length > 0 ? Math.max(...rows.map((r) => r.position)) + 1 : 1;
    const side = sideForNewRow(this.lastSelectedSide(), rows, this.sides());
    this.rowsChange.emit([...rows, createEmptyTrackRow(nextPosition, side)]);
  }

  protected removeTrack(key: string): void {
    this.rowsChange.emit(this.rows().filter((r) => r.key !== key));
  }

  protected updateRow(key: string, patch: Partial<TrackFormRow>): void {
    this.rowsChange.emit(this.rows().map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  protected selectSide(row: TrackFormRow, side: string): void {
    if (side) this.lastSelectedSide.set(side);
    this.updateRow(row.key, { side });
  }

  /** Adds the next side (e.g. "C") and puts this row on it. */
  protected addSide(row: TrackFormRow): void {
    const side = this.newSide();
    if (!side) return;
    this.sideAdded.emit(side);
    this.selectSide(row, side);
  }

  protected onToggleArtist(row: TrackFormRow, artist: Artist): void {
    this.updateRow(row.key, toggleArtist(row, artist, this.albumArtists()));
  }

  protected onAddArtist(row: TrackFormRow, artist: Artist): void {
    this.updateRow(row.key, addArtist(row, artist, this.albumArtists()));
  }

  protected onResetToInherit(row: TrackFormRow): void {
    this.updateRow(row.key, resetToInherit(row));
  }
}
