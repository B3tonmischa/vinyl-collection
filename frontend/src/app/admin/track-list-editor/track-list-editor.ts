import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, signal } from '@angular/core';
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
  @Input({ required: true }) rows!: TrackFormRow[];
  @Input({ required: true }) albumArtists!: Artist[];
  /** Options of every row's side dropdown (see knownSides()). */
  @Input({ required: true }) sides!: string[];
  @Output() rowsChange = new EventEmitter<TrackFormRow[]>();
  /** A new side was added with the "+" button next to a dropdown. */
  @Output() sideAdded = new EventEmitter<string>();

  /** Side last picked on any row; new tracks start on it. */
  private readonly lastSelectedSide = signal<string | null>(null);

  protected get newSide(): string | null {
    return nextSide(this.sides);
  }

  protected addTrack(): void {
    const nextPosition = this.rows.length > 0 ? Math.max(...this.rows.map((r) => r.position)) + 1 : 1;
    const side = sideForNewRow(this.lastSelectedSide(), this.rows, this.sides);
    this.rowsChange.emit([...this.rows, createEmptyTrackRow(nextPosition, side)]);
  }

  protected removeTrack(key: string): void {
    this.rowsChange.emit(this.rows.filter((r) => r.key !== key));
  }

  protected updateRow(key: string, patch: Partial<TrackFormRow>): void {
    this.rowsChange.emit(this.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  protected selectSide(row: TrackFormRow, side: string): void {
    if (side) this.lastSelectedSide.set(side);
    this.updateRow(row.key, { side });
  }

  /** Adds the next side (e.g. "C") and puts this row on it. */
  protected addSide(row: TrackFormRow): void {
    const side = this.newSide;
    if (!side) return;
    this.sideAdded.emit(side);
    this.selectSide(row, side);
  }

  protected onToggleArtist(row: TrackFormRow, artist: Artist): void {
    this.updateRow(row.key, toggleArtist(row, artist, this.albumArtists));
  }

  protected onAddArtist(row: TrackFormRow, artist: Artist): void {
    this.updateRow(row.key, addArtist(row, artist, this.albumArtists));
  }

  protected onResetToInherit(row: TrackFormRow): void {
    this.updateRow(row.key, resetToInherit(row));
  }
}
