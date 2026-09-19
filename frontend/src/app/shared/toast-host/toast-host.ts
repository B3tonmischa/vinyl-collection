import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../core/services/toast';

/** ARIA live region rendered once at the app root; no CDK needed. */
@Component({
  selector: 'app-toast-host',
  templateUrl: './toast-host.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHost {
  protected readonly toastService = inject(ToastService);
}
