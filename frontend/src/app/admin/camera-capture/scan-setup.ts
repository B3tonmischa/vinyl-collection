import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  MAX_DISCS,
  ScanStep,
  SetupItem,
  buildSetupItems,
  selectedSteps,
  slotKey,
  toggleSetupItem,
} from './scan-session.logic';
import { clamp } from './camera-capture.logic';

/**
 * Setup screen of a guided "Scan record" session: tick which photos to
 * take and set how many discs the record has. Emits the chosen steps.
 */
@Component({
  selector: 'app-scan-setup',
  imports: [NgTemplateOutlet],
  templateUrl: './scan-setup.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full w-full flex-col' },
})
export class ScanSetup implements OnInit {
  readonly initialDiscCount = input.required<number>();
  /** slotKey()s of the slots that already have a photo. */
  readonly filledKeys = input.required<string[]>();
  readonly start = output<ScanStep[]>();

  protected readonly discCount = signal(1);
  protected readonly items = signal<SetupItem[]>([]);
  protected readonly selectedCount = computed(() => selectedSteps(this.items()).length);
  protected readonly packagingItems = computed(() =>
    this.items().filter((item) => item.step.mode === 'sleeve'),
  );
  protected readonly discItems = computed(() =>
    this.items().filter((item) => item.step.mode === 'disc'),
  );
  protected readonly maxDiscs = MAX_DISCS;
  protected readonly slotKey = slotKey;

  private filled: ReadonlySet<string> = new Set();

  ngOnInit(): void {
    this.filled = new Set(this.filledKeys());
    this.discCount.set(this.initialDiscCount());
    this.items.set(buildSetupItems(this.initialDiscCount(), this.filled));
  }

  protected toggleItem(item: SetupItem): void {
    this.items.update((items) => toggleSetupItem(items, slotKey(item.step)));
  }

  protected changeDiscs(delta: number): void {
    const count = clamp(this.discCount() + delta, 1, MAX_DISCS);
    if (count === this.discCount()) return;
    this.discCount.set(count);
    this.items.update((items) => buildSetupItems(count, this.filled, items));
  }

  protected submit(): void {
    const steps = selectedSteps(this.items());
    if (steps.length > 0) this.start.emit(steps);
  }
}
