import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { ApiConfigService } from '../../core/services/api-config';
import { ToastService } from '../../core/services/toast';
import { UploadsApiService } from '../../core/services/uploads-api';
import { DISC_IMAGE_KINDS, VinylImage } from '../../models/vinyl.model';
import { CameraCaptureData, CameraCaptureDialog } from '../camera-capture/camera-capture-dialog';
import {
  MAX_DISCS,
  ScanStep,
  discCountForSides,
  discSteps,
  packagingSteps,
  slotKey,
} from '../camera-capture/scan-session.logic';

/** One upload/replace/delete slot per image kind + disc number. */
@Component({
  selector: 'app-image-upload-panel',
  templateUrl: './image-upload-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageUploadPanel {
  readonly vinylId = input.required<number>();
  readonly images = input.required<VinylImage[]>();
  /** The release's track sides; a side C or D means a disc 2, and so on. */
  readonly sides = input<readonly string[]>([]);
  readonly imagesChanged = output<void>();

  private readonly uploadsApi = inject(UploadsApiService);
  protected readonly apiConfig = inject(ApiConfigService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(Dialog);

  protected readonly busyKey = signal<string | null>(null);
  /** Disc count asked for with "Add another disc". */
  private readonly requestedDiscs = signal(1);

  protected readonly swapMode = signal(false);
  protected readonly swapSelection = signal<ScanStep[]>([]);
  protected readonly swapping = signal(false);

  protected readonly packagingSlots = packagingSteps();

  /**
   * Discs that get slots (and that a scan starts with): the most of what
   * the images, the track sides and "Add another disc" call for.
   */
  protected readonly discCount = computed(() => {
    const maxFromImages = this.images().reduce(
      (max, img) => (DISC_IMAGE_KINDS.includes(img.kind) ? Math.max(max, img.discNumber) : max),
      1,
    );
    return Math.max(maxFromImages, discCountForSides(this.sides()), this.requestedDiscs());
  });

  protected readonly discSlots = computed(() => discSteps(this.discCount()));

  protected readonly canAddDisc = computed(() => this.discCount() < MAX_DISCS);

  protected addDisc(): void {
    if (this.canAddDisc()) this.requestedDiscs.set(this.discCount() + 1);
  }

  protected imageFor(slot: ScanStep): VinylImage | undefined {
    return this.images().find((img) => img.kind === slot.kind && img.discNumber === slot.discNumber);
  }

  protected readonly slotKey = slotKey;

  protected isBusy(slot: ScanStep): boolean {
    return this.busyKey() === slotKey(slot);
  }

  protected async onFileSelected(slot: ScanStep, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await this.uploadFile(slot, file);
    } finally {
      input.value = '';
    }
  }

  /** Shared by the file picker and the camera; resolves false on failure. */
  private async uploadFile(slot: ScanStep, file: File): Promise<boolean> {
    const key = slotKey(slot);
    this.busyKey.set(key);
    try {
      await this.uploadsApi.upload(this.vinylId(), slot.kind, slot.discNumber, file);
      this.imagesChanged.emit();
      return true;
    } catch {
      this.toast.show(`Couldn't upload ${slot.label}.`);
      return false;
    } finally {
      this.busyKey.set(null);
    }
  }

  protected takePhoto(slot: ScanStep): void {
    this.openCamera({
      kind: 'single',
      step: slot,
      onCapture: (step, file) => this.uploadFile(step, file),
    });
  }

  /**
   * Guided session. Its setup screen lets the user pick which photos to
   * take and how many discs the record has; filled slots start unticked.
   */
  protected scanRecord(): void {
    this.openCamera({
      kind: 'guided',
      discCount: this.discCount(),
      filledKeys: this.images().map(slotKey),
      onCapture: (step, file) => this.uploadFile(step, file),
    });
  }

  private openCamera(data: CameraCaptureData): void {
    this.dialog.open(CameraCaptureDialog, {
      data,
      width: '100vw',
      maxWidth: '100vw',
      height: '100dvh',
      ariaLabel: 'Camera',
    });
  }

  protected async deleteImage(slot: ScanStep): Promise<void> {
    const key = slotKey(slot);
    this.busyKey.set(key);
    try {
      await this.uploadsApi.delete(this.vinylId(), slot.kind, slot.discNumber);
      this.toast.show(`Deleted ${slot.label}.`, {
        undo: async () => {
          await this.uploadsApi.restore(this.vinylId(), slot.kind, slot.discNumber);
          this.imagesChanged.emit();
        },
      });
      this.imagesChanged.emit();
    } catch {
      this.toast.show(`Couldn't delete ${slot.label}.`);
    } finally {
      this.busyKey.set(null);
    }
  }

  protected toggleSwapMode(): void {
    this.swapMode.update((active) => !active);
    this.swapSelection.set([]);
  }

  protected isSwapSelected(slot: ScanStep): boolean {
    return this.swapSelection().some((s) => slotKey(s) === slotKey(slot));
  }

  protected toggleSwapSelection(slot: ScanStep): void {
    if (!this.swapMode() || !this.imageFor(slot)) return;
    const key = slotKey(slot);
    const current = this.swapSelection();
    if (current.some((s) => slotKey(s) === key)) {
      this.swapSelection.set(current.filter((s) => slotKey(s) !== key));
      return;
    }
    if (current.length >= 2) return;
    this.swapSelection.set([...current, slot]);
  }

  protected cancelSwapSelection(): void {
    this.swapSelection.set([]);
  }

  protected async confirmSwap(): Promise<void> {
    const [a, b] = this.swapSelection();
    if (!a || !b) return;
    this.swapping.set(true);
    try {
      await this.uploadsApi.swap(
        this.vinylId(),
        { kind: a.kind, discNumber: a.discNumber },
        { kind: b.kind, discNumber: b.discNumber },
      );
      this.toast.show(`Swapped ${a.label} and ${b.label}.`);
      this.imagesChanged.emit();
      this.swapSelection.set([]);
      this.swapMode.set(false);
    } catch {
      this.toast.show(`Couldn't swap ${a.label} and ${b.label}.`);
    } finally {
      this.swapping.set(false);
    }
  }
}
