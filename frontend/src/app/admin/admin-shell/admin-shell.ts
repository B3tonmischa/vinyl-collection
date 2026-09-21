import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { ToastService } from '../../core/services/toast';
import { ImportedVinyl } from '../../core/services/discogs-import-api';
import { DiscogsImportDialogComponent } from '../discogs-import-dialog/discogs-import-dialog';

@Component({
  selector: 'app-admin-shell',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './admin-shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminShell {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(Dialog);
  private readonly toast = inject(ToastService);

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/admin/login');
  }

  /**
   * Opens the Discogs search dialog. Per the accepted "fetch-and-upload
   * immediately" design (see discogs-import-implementation-status.md),
   * picking a release already creates a real, persisted vinyl (images
   * attached) before the dialog closes — so this navigates to the *edit*
   * route for that id, not /admin/new. The existing edit page loads and
   * displays exactly what was just imported with no separate
   * pre-population step: it's the same detailResource-driven load an
   * ordinary manual edit uses.
   */
  protected async openImportDialog(): Promise<void> {
    const dialogRef = this.dialog.open<ImportedVinyl | undefined>(DiscogsImportDialogComponent);
    const imported = await firstValueFrom(dialogRef.closed);
    if (!imported) return;
    this.toast.show(
      `Imported "${imported.title}" from Discogs — review and save, or delete it if this isn't the right pressing.`,
    );
    await this.router.navigate(['/admin', imported.id, 'edit']);
  }
}
