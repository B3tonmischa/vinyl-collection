import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth';

@Component({
  selector: 'app-login-page',
  imports: [RouterLink],
  templateUrl: './login-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected async onSubmit(): Promise<void> {
    if (this.submitting()) return;
    this.error.set(null);
    this.submitting.set(true);
    try {
      await this.auth.login(this.username(), this.password());
      const redirect = this.route.snapshot.queryParamMap.get('redirect') ?? '/admin';
      await this.router.navigateByUrl(redirect);
    } catch {
      this.error.set('Incorrect username or password.');
    } finally {
      this.submitting.set(false);
    }
  }
}
