import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { OverlayModule } from '@angular/cdk/overlay';

export interface ComboboxOption {
  id: number;
  label: string;
}

/**
 * Generic search-and-select field, built on CDK Overlay for the dropdown
 * panel. Backs both the album-level artist picker and the track-level
 * override picker's "add an artist" input — each wraps this with its own
 * chip-list and selection semantics.
 */
@Component({
  selector: 'app-combobox',
  imports: [OverlayModule],
  templateUrl: './combobox.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComboboxComponent {
  @Input() options: ComboboxOption[] = [];
  @Input() placeholder = 'Search…';
  @Input() loading = false;
  @Input() allowCreate = true;

  @Output() queryChange = new EventEmitter<string>();
  @Output() optionSelected = new EventEmitter<ComboboxOption>();
  @Output() createRequested = new EventEmitter<string>();

  protected readonly query = signal('');
  protected readonly isOpen = signal(false);

  protected onInput(value: string): void {
    this.query.set(value);
    this.isOpen.set(true);
    this.queryChange.emit(value);
  }

  protected onFocus(): void {
    if (this.query().length > 0) {
      this.isOpen.set(true);
    }
  }

  protected select(option: ComboboxOption): void {
    this.optionSelected.emit(option);
    this.reset();
  }

  protected createNew(): void {
    const value = this.query().trim();
    if (value.length === 0) return;
    this.createRequested.emit(value);
    this.reset();
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  private reset(): void {
    this.query.set('');
    this.isOpen.set(false);
    this.queryChange.emit('');
  }
}
