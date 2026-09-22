import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { ApiConfigService } from '../../core/services/api-config';
import { ToastService } from '../../core/services/toast';
import { UploadsApiService } from '../../core/services/uploads-api';
import { DISC_IMAGE_KINDS, ImageKind, VinylImage } from '../../models/vinyl.model';

interface ImageSlot {
  kind: ImageKind;
  discNumber: number;
  label: string;
}

const PACKAGING_SLOTS: ImageSlot[] = [
  { kind: 'COVER_FRONT', discNumber: 1, label: 'Cover front' },
  { kind: 'COVER_BACK', discNumber: 1, label: 'Cover back' },
  { kind: 'INNER_SLEEVE_A', discNumber: 1, label: 'Inner sleeve A' },
  { kind: 'INNER_SLEEVE_B', discNumber: 1, label: 'Inner sleeve B' },
];

/** One upload/replace/delete slot per image kind + disc number. */
@Component({
  selector: 'app-image-upload-panel',
  templateUrl: './image-upload-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageUploadPanel {
  @Input({ required: true }) vinylId!: number;
  @Input({ required: true }) images!: VinylImage[];
  @Output() imagesChanged = new EventEmitter<void>();

  private readonly uploadsApi = inject(UploadsApiService);
  protected readonly apiConfig = inject(ApiConfigService);
  private readonly toast = inject(ToastService);

  protected readonly busyKey = signal<string | null>(null);
  private readonly extraDiscs = signal(0);

  protected readonly packagingSlots = PACKAGING_SLOTS;

  protected get discCount(): number {
    const maxFromImages = this.images.reduce(
      (max, img) => (DISC_IMAGE_KINDS.includes(img.kind) ? Math.max(max, img.discNumber) : max),
      1,
    );
    return Math.max(maxFromImages, 1 + this.extraDiscs());
  }

  protected get discSlots(): ImageSlot[] {
    const slots: ImageSlot[] = [];
    const multi = this.discCount > 1;
    for (let disc = 1; disc <= this.discCount; disc++) {
      slots.push({
        kind: 'DISC_SIDE_A',
        discNumber: disc,
        label: multi ? `Disc ${disc} · Side A` : 'Side A',
      });
      slots.push({
        kind: 'DISC_SIDE_B',
        discNumber: disc,
        label: multi ? `Disc ${disc} · Side B` : 'Side B',
      });
    }
    return slots;
  }

  protected addDisc(): void {
    this.extraDiscs.update((n) => n + 1);
  }

  protected imageFor(slot: ImageSlot): VinylImage | undefined {
    return this.images.find((img) => img.kind === slot.kind && img.discNumber === slot.discNumber);
  }

  protected slotKey(slot: ImageSlot): string {
    return `${slot.kind}-${slot.discNumber}`;
  }

  protected isBusy(slot: ImageSlot): boolean {
    return this.busyKey() === this.slotKey(slot);
  }

  protected async onFileSelected(slot: ImageSlot, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    const key = this.slotKey(slot);
    this.busyKey.set(key);
    try {
      await this.uploadsApi.upload(this.vinylId, slot.kind, slot.discNumber, file);
      this.imagesChanged.emit();
    } catch {
      this.toast.show(`Couldn't upload ${slot.label}.`);
    } finally {
      this.busyKey.set(null);
      input.value = '';
    }
  }

  protected async deleteImage(slot: ImageSlot): Promise<void> {
    const key = this.slotKey(slot);
    this.busyKey.set(key);
    try {
      await this.uploadsApi.delete(this.vinylId, slot.kind, slot.discNumber);
      this.toast.show(`Deleted ${slot.label}.`, {
        undo: async () => {
          await this.uploadsApi.restore(this.vinylId, slot.kind, slot.discNumber);
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
}
