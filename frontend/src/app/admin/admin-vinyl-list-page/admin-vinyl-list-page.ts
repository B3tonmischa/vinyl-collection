import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { ApiConfigService } from '../../core/services/api-config';
import { ToastService } from '../../core/services/toast';
import { VinylsApiService } from '../../core/services/vinyls-api';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog';
import { VinylSummary, artistNames } from '../../models/vinyl.model';

@Component({
  selector: 'app-admin-vinyl-list-page',
  imports: [RouterLink],
  templateUrl: './admin-vinyl-list-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminVinylListPage {
  private readonly vinylsApi = inject(VinylsApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(Dialog);
  protected readonly apiConfig = inject(ApiConfigService);

  private readonly query = signal('');
  protected readonly listResource = this.vinylsApi.listResource(this.query);

  protected readonly artistNames = artistNames;

  protected async confirmDelete(vinyl: VinylSummary): Promise<void> {
    const dialogRef = this.dialog.open<boolean>(ConfirmDialogComponent, {
      data: {
        title: `Delete "${vinyl.title}"?`,
        message: 'You can undo this from the toast that appears, but only for a little while.',
      },
    });
    const confirmed = await firstValueFrom(dialogRef.closed);
    if (!confirmed) return;

    try {
      await this.vinylsApi.softDelete(vinyl.id);
      this.listResource.reload();
      this.toast.show(`Deleted "${vinyl.title}".`, {
        undo: async () => {
          await this.vinylsApi.restore(vinyl.id);
          this.listResource.reload();
        },
      });
    } catch {
      this.toast.show(`Couldn't delete "${vinyl.title}".`);
    }
  }
}
