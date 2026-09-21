import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';
import { DiscogsImportApiService, ImportedVinyl } from '../../core/services/discogs-import-api';
import { DiscogsSearchCandidate } from '../../models/discogs.model';

/**
 * CDK Dialog for searching Discogs and picking a release to import (see
 * admin-shell.ts's openImportDialog(), which opens this next to the
 * "+ New record" link). Closing with a value means the import call
 * succeeded — the caller navigates to that vinyl's edit page. Closing with
 * undefined means cancelled.
 *
 * Picking a result doesn't just "load a draft" — the import endpoint
 * already creates a real, persisted vinyl record (with images attached)
 * before this resolves, per the deviation documented in
 * discogs-import-implementation-status.md. So there's no separate
 * "confirm before saving" step here; review/edit happens on the normal
 * edit page the caller navigates to next.
 */
@Component({
  selector: 'app-discogs-import-dialog',
  imports: [FormsModule],
  templateUrl: './discogs-import-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscogsImportDialogComponent {
  private readonly discogsApi = inject(DiscogsImportApiService);
  private readonly dialogRef = inject(DialogRef<ImportedVinyl | undefined>);

  protected readonly artist = signal('');
  protected readonly title = signal('');
  protected readonly barcode = signal('');
  protected readonly catno = signal('');

  protected readonly searching = signal(false);
  protected readonly importing = signal(false);
  protected readonly searched = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly results = signal<DiscogsSearchCandidate[]>([]);

  protected get canSearch(): boolean {
    return !!(
      this.artist().trim() ||
      this.title().trim() ||
      this.barcode().trim() ||
      this.catno().trim()
    );
  }

  protected async search(): Promise<void> {
    if (!this.canSearch || this.searching()) return;
    this.searching.set(true);
    this.error.set(null);
    try {
      const results = await this.discogsApi.search({
        artist: this.artist().trim() || undefined,
        title: this.title().trim() || undefined,
        barcode: this.barcode().trim() || undefined,
        catno: this.catno().trim() || undefined,
      });
      this.results.set(results);
      this.searched.set(true);
    } catch {
      this.error.set("Couldn't search Discogs. Check the backend's DISCOGS_TOKEN and try again.");
    } finally {
      this.searching.set(false);
    }
  }

  protected async pick(candidate: DiscogsSearchCandidate): Promise<void> {
    if (this.importing()) return;
    this.importing.set(true);
    this.error.set(null);
    try {
      const imported = await this.discogsApi.importRelease(candidate.discogsReleaseId);
      this.dialogRef.close(imported);
    } catch {
      this.error.set("Couldn't import that release from Discogs.");
      this.importing.set(false);
    }
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }
}
