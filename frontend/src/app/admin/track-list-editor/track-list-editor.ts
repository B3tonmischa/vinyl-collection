import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { Artist } from '../../models/vinyl.model';
import { ArtistOverridePickerComponent } from '../artist-override-picker/artist-override-picker';
import { TrackFormRow, addArtist, createEmptyTrackRow, resetToInherit, toggleArtist } from './track-list-editor.logic';

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
  @Output() rowsChange = new EventEmitter<TrackFormRow[]>();

  protected addTrack(): void {
    const nextPosition = this.rows.length > 0 ? Math.max(...this.rows.map((r) => r.position)) + 1 : 1;
    this.rowsChange.emit([...this.rows, createEmptyTrackRow(nextPosition)]);
  }

  protected removeTrack(key: string): void {
    this.rowsChange.emit(this.rows.filter((r) => r.key !== key));
  }

  protected updateRow(key: string, patch: Partial<TrackFormRow>): void {
    this.rowsChange.emit(this.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
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
