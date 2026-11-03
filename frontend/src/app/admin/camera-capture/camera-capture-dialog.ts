import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  Circle,
  LIVE_DETECT_MAX_EDGE,
  Point,
  Quad,
  Size,
  clampCircle,
  clampPoint,
  guideCircle,
  guideFrameQuad,
  pickSleeveQuad,
  scaleCircle,
  scalePoints,
  squareOutputSize,
} from './camera-capture.logic';
import {
  canvasSize,
  cropDiscToPngFile,
  cropSleeveWithoutWarp,
  detectionImage,
  fileToWorkingCanvas,
  fullImageData,
  imageDataToJpegFile,
  toWorkingCanvas,
} from './camera-crop';
import { OpenCvScanDetector } from './scan-detector';
import {
  MAX_DISCS,
  ScanStep,
  SetupItem,
  StepStatus,
  buildSetupItems,
  nextPendingIndex,
  selectedSteps,
  slotKey,
  toggleSetupItem,
  withStatus,
} from './scan-session.logic';

/** Uploads the cropped photo for a step; resolves false on failure. */
export type CaptureUpload = (step: ScanStep, file: File) => Promise<boolean>;

export type CameraCaptureData =
  /** One slot's "Photo" button: straight to the camera. */
  | { kind: 'single'; step: ScanStep; onCapture: CaptureUpload }
  /**
   * "Scan record": a setup screen to choose which photos to take (and
   * how many discs), then one step per photo with a progress strip.
   */
  | { kind: 'guided'; discCount: number; filledKeys: string[]; onCapture: CaptureUpload };

type Phase = 'setup' | 'viewfinder' | 'adjust' | 'processing' | 'finished';
type DiscHandle = 'center' | 'radius';

// Minimal typing for ImageCapture (Chrome/Android only, not in lib.dom).
interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

const LIVE_DETECT_INTERVAL_MS = 250;
// Keep showing the last live outline through a couple of missed frames,
// so it doesn't flicker while the phone moves slightly.
const LIVE_MISSES_BEFORE_CLEAR = 2;

/**
 * Full-screen camera for photographing sleeves and discs, opened from
 * image-upload-panel. A guided session starts on a setup screen and shows
 * a progress strip of all its steps (tap one to jump). Flow per step: live viewfinder (with a square or
 * circle guide and, once OpenCV is loaded, the live detection drawn on
 * top) → still photo with an auto-detected, draggable crop → cropped
 * File handed to data.onCapture for upload. Sleeves get perspective-
 * corrected to a square JPEG; discs are cut round into a PNG with
 * transparent corners.
 *
 * Needs a secure context for getUserMedia (prod is HTTPS via Cloudflare;
 * see `npm run start:lan` for phones in dev). Without a camera it still
 * works through "Pick from gallery".
 */
@Component({
  selector: 'app-camera-capture-dialog',
  imports: [NgTemplateOutlet],
  templateUrl: './camera-capture-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full' },
})
export class CameraCaptureDialog implements OnInit, OnDestroy {
  protected readonly data = inject<CameraCaptureData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef<void>);
  private readonly detector = inject(OpenCvScanDetector);

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly still = viewChild.required<ElementRef<HTMLCanvasElement>>('still');
  private readonly adjustSvg = viewChild<ElementRef<SVGSVGElement>>('adjustSvg');

  protected readonly isGuided = this.data.kind === 'guided';
  protected readonly phase = signal<Phase>(this.isGuided ? 'setup' : 'viewfinder');

  // Setup screen (guided only).
  protected readonly discCount = signal(this.data.kind === 'guided' ? this.data.discCount : 1);
  private readonly filledKeys = new Set(this.data.kind === 'guided' ? this.data.filledKeys : []);
  protected readonly setupItems = signal<SetupItem[]>(
    buildSetupItems(this.discCount(), this.filledKeys),
  );
  protected readonly selectedCount = computed(() => selectedSteps(this.setupItems()).length);
  protected readonly packagingItems = computed(() =>
    this.setupItems().filter((item) => item.step.mode === 'sleeve'),
  );
  protected readonly discItems = computed(() =>
    this.setupItems().filter((item) => item.step.mode === 'disc'),
  );
  protected readonly maxDiscs = MAX_DISCS;

  // Steps of the session and how far along each is.
  protected readonly steps = signal<ScanStep[]>(
    this.data.kind === 'single' ? [this.data.step] : [],
  );
  protected readonly statuses = signal<StepStatus[]>(this.steps().map(() => 'pending'));
  protected readonly stepIndex = signal(0);
  protected readonly doneCount = computed(() => this.statuses().filter((s) => s === 'done').length);
  protected readonly skippedCount = computed(
    () => this.statuses().filter((s) => s === 'skipped').length,
  );
  protected readonly cameraError = signal<string | null>(null);
  protected readonly uploadFailed = signal(false);

  protected readonly videoSize = signal<Size | null>(null);
  protected readonly liveQuad = signal<Quad | null>(null);
  protected readonly liveCircle = signal<Circle | null>(null);

  protected readonly stillSize = signal<Size>({ width: 1, height: 1 });
  protected readonly quad = signal<Quad | null>(null);
  protected readonly circle = signal<Circle | null>(null);
  protected readonly autoDetected = signal(false);

  protected readonly step = computed<ScanStep | undefined>(() => this.steps()[this.stepIndex()]);

  /** One line under the title saying what to do right now. */
  protected readonly instruction = computed(() => {
    const step = this.step();
    switch (this.phase()) {
      case 'setup':
        return null;
      case 'finished':
        return null;
      case 'adjust':
        return step?.mode === 'disc'
          ? 'Check the circle sits on the rim of the record.'
          : 'Check the corners sit on the corners of the sleeve.';
      default:
        if (!step) return null;
        return step.mode === 'disc'
          ? `Lay the record flat, ${sideHint(step)} up, and fit it in the circle.`
          : `Lay the ${step.label.toLowerCase()} flat and fit it in the square.`;
    }
  });

  protected readonly guideQuad = computed(() => {
    const size = this.videoSize();
    return size ? guideFrameQuad(size) : null;
  });
  protected readonly guideDisc = computed(() => {
    const size = this.videoSize();
    return size ? guideCircle(size) : null;
  });
  /** Handle radius in still-image pixels, so handles look the same on any photo. */
  protected readonly handleRadius = computed(() => {
    const { width, height } = this.stillSize();
    return Math.max(width, height) * 0.022;
  });

  private stream: MediaStream | null = null;
  private working: HTMLCanvasElement | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private liveBusy = false;
  private liveMisses = 0;
  private dragging: number | DiscHandle | null = null;
  private grabOffset: Point = { x: 0, y: 0 };

  ngOnInit(): void {
    this.detector.warmUp();
    // A guided session opens the camera when the user starts it, so the
    // camera light isn't on while they're still ticking boxes.
    if (!this.isGuided) void this.startCamera();
  }

  // ── Setup (guided) ────────────────────────────────────────────────────

  protected readonly slotKey = slotKey;

  protected toggleItem(item: SetupItem): void {
    this.setupItems.update((items) => toggleSetupItem(items, slotKey(item.step)));
  }

  protected changeDiscs(delta: number): void {
    const count = Math.min(MAX_DISCS, Math.max(1, this.discCount() + delta));
    if (count === this.discCount()) return;
    this.discCount.set(count);
    this.setupItems.update((items) => buildSetupItems(count, this.filledKeys, items));
  }

  protected startScan(): void {
    const steps = selectedSteps(this.setupItems());
    if (steps.length === 0) return;
    this.steps.set(steps);
    this.statuses.set(steps.map(() => 'pending'));
    this.stepIndex.set(0);
    this.phase.set('viewfinder');
    void this.startCamera();
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  // ── Camera ────────────────────────────────────────────────────────────

  private async startCamera(): Promise<void> {
    if (this.stream) return;
    if (!window.isSecureContext) {
      this.cameraError.set(
        'The camera only works over HTTPS. Use "Pick from gallery", or open the site via https://.',
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraError.set('This browser has no camera access. Use "Pick from gallery" instead.');
      return;
    }
    try {
      // Ask for 4K so phones don't hand back their 640×480 default; the
      // browser picks the closest the rear camera supports.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
    } catch (err) {
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      this.cameraError.set(
        denied
          ? 'Camera permission was denied. Allow it in the browser settings, or use "Pick from gallery".'
          : 'No camera could be opened. Use "Pick from gallery" instead.',
      );
      return;
    }
    const video = this.video().nativeElement;
    // The template attributes don't set these properties, and iOS only
    // autoplays inline video that is muted *as a property*.
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    video.onloadedmetadata = () => {
      this.videoSize.set({ width: video.videoWidth, height: video.videoHeight });
    };
    await this.resumeVideo();
    if (!this.liveTimer) {
      this.liveTimer = setInterval(() => void this.liveDetect(), LIVE_DETECT_INTERVAL_MS);
    }
  }

  /** Some browsers pause a video while it's display:none (the adjust step). */
  private async resumeVideo(): Promise<void> {
    if (!this.stream) return;
    try {
      await this.video().nativeElement.play();
    } catch {
      // Autoplay is allowed for muted inline video; ignore odd rejections.
    }
  }

  private stopCamera(): void {
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** Draws what OpenCV currently sees, so the user knows when to shoot. */
  private async liveDetect(): Promise<void> {
    const size = this.videoSize();
    const step = this.step();
    if (this.liveBusy || !size || !step || this.phase() !== 'viewfinder') return;
    this.liveBusy = true;
    try {
      const image = detectionImage(this.video().nativeElement, size, LIVE_DETECT_MAX_EDGE);
      const detSize = { width: image.width, height: image.height };
      if (step.mode === 'sleeve') {
        const candidates = await this.detector.detectQuads(image);
        const quad = candidates ? pickSleeveQuad(candidates, detSize) : null;
        if (quad) {
          this.liveMisses = 0;
          this.liveQuad.set(scalePoints(quad, detSize, size));
        } else if (++this.liveMisses > LIVE_MISSES_BEFORE_CLEAR) {
          this.liveQuad.set(null);
        }
      } else {
        const c = await this.detector.detectCircle(image);
        this.liveCircle.set(c ? scaleCircle(c, detSize, size) : null);
      }
    } finally {
      this.liveBusy = false;
    }
  }

  protected async shutter(): Promise<void> {
    const size = this.videoSize();
    const track = this.stream?.getVideoTracks()[0];
    if (!size || !track) return;
    this.phase.set('processing');
    let canvas: HTMLCanvasElement | null = null;
    // Full sensor resolution where supported (Chrome/Android); elsewhere
    // the video frame is the best we can get.
    const ImageCaptureImpl = (window as unknown as { ImageCapture?: ImageCaptureCtor })
      .ImageCapture;
    if (ImageCaptureImpl) {
      try {
        canvas = await fileToWorkingCanvas(await new ImageCaptureImpl(track).takePhoto());
      } catch {
        canvas = null;
      }
    }
    canvas ??= toWorkingCanvas(this.video().nativeElement, size);
    await this.enterAdjust(canvas);
  }

  protected async onGalleryFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.phase.set('processing');
    try {
      await this.enterAdjust(await fileToWorkingCanvas(file));
    } catch {
      this.phase.set('viewfinder');
      this.cameraError.set("Couldn't read that image.");
    }
  }

  // ── Adjust ────────────────────────────────────────────────────────────

  private async enterAdjust(canvas: HTMLCanvasElement): Promise<void> {
    this.working = canvas;
    const size = canvasSize(canvas);
    const still = this.still().nativeElement;
    still.width = size.width;
    still.height = size.height;
    still.getContext('2d')?.drawImage(canvas, 0, 0);
    this.stillSize.set(size);
    this.uploadFailed.set(false);

    const image = detectionImage(canvas, size);
    const detSize = { width: image.width, height: image.height };
    if (this.step()?.mode === 'sleeve') {
      const candidates = await this.detector.detectQuads(image);
      const quad = candidates ? pickSleeveQuad(candidates, detSize) : null;
      this.autoDetected.set(!!quad);
      this.quad.set(quad ? scalePoints(quad, detSize, size) : guideFrameQuad(size));
    } else {
      const c = await this.detector.detectCircle(image);
      this.autoDetected.set(!!c);
      this.circle.set(c ? clampCircle(scaleCircle(c, detSize, size), size) : guideCircle(size));
    }
    this.phase.set('adjust');
  }

  protected quadPoints(quad: Quad): string {
    return quad.map((p) => `${p.x},${p.y}`).join(' ');
  }

  /** Whole image minus the quad (evenodd), to dim what gets cut away. */
  protected quadMaskPath(quad: Quad): string {
    const { width, height } = this.stillSize();
    const [a, b, c, d] = quad;
    return `M0 0H${width}V${height}H0Z M${a.x} ${a.y}L${b.x} ${b.y}L${c.x} ${c.y}L${d.x} ${d.y}Z`;
  }

  protected circleMaskPath(c: Circle): string {
    const { width, height } = this.stillSize();
    return (
      `M0 0H${width}V${height}H0Z M${c.cx - c.r} ${c.cy}` +
      `a${c.r} ${c.r} 0 1 0 ${c.r * 2} 0a${c.r} ${c.r} 0 1 0 ${-c.r * 2} 0Z`
    );
  }

  protected startDrag(handle: number | DiscHandle, event: PointerEvent): void {
    event.preventDefault();
    this.dragging = handle;
    // Grabbing the disc anywhere moves it by the finger's delta rather
    // than snapping its centre under the finger.
    const p = this.toStillCoords(event);
    const c = this.circle();
    this.grabOffset =
      handle === 'center' && p && c ? { x: c.cx - p.x, y: c.cy - p.y } : { x: 0, y: 0 };
    this.adjustSvg()?.nativeElement.setPointerCapture(event.pointerId);
  }

  protected onDrag(event: PointerEvent): void {
    if (this.dragging === null) return;
    const p = this.toStillCoords(event);
    if (!p) return;
    const size = this.stillSize();
    const handle = this.dragging;
    if (typeof handle === 'number') {
      const quad = this.quad();
      if (!quad) return;
      const next = [...quad] as Quad;
      next[handle] = clampPoint(p, size);
      this.quad.set(next);
    } else {
      const c = this.circle();
      if (!c) return;
      const moved =
        handle === 'center'
          ? { ...c, cx: p.x + this.grabOffset.x, cy: p.y + this.grabOffset.y }
          : { ...c, r: Math.hypot(p.x - c.cx, p.y - c.cy) };
      this.circle.set(clampCircle(moved, size));
    }
  }

  protected endDrag(): void {
    this.dragging = null;
  }

  private toStillCoords(event: PointerEvent): Point | null {
    const svg = this.adjustSvg()?.nativeElement;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  protected retake(): void {
    this.showViewfinder();
  }

  private showViewfinder(): void {
    this.working = null;
    this.liveQuad.set(null);
    this.liveCircle.set(null);
    this.liveMisses = 0;
    this.phase.set('viewfinder');
    if (this.stream) void this.resumeVideo();
    else void this.startCamera();
  }

  protected async usePhoto(): Promise<void> {
    const working = this.working;
    if (!working) return;
    this.phase.set('processing');
    let file: File;
    try {
      file = await this.cropFile(working);
    } catch {
      this.uploadFailed.set(true);
      this.phase.set('adjust');
      return;
    }
    const step = this.step();
    const ok = !!step && (await this.data.onCapture(step, file));
    if (!ok) {
      this.uploadFailed.set(true);
      this.phase.set('adjust');
      return;
    }
    this.next('done');
  }

  private async cropFile(working: HTMLCanvasElement): Promise<File> {
    if (this.step()?.mode === 'disc') {
      return cropDiscToPngFile(working, this.circle() ?? guideCircle(canvasSize(working)));
    }
    const quad = this.quad() ?? guideFrameQuad(canvasSize(working));
    const warped = await this.detector.warp(fullImageData(working), quad, squareOutputSize(quad));
    return warped ? imageDataToJpegFile(warped, 'sleeve') : cropSleeveWithoutWarp(working, quad);
  }

  // ── Steps ─────────────────────────────────────────────────────────────

  protected isCurrent(index: number): boolean {
    return index === this.stepIndex() && this.phase() !== 'finished';
  }

  protected chipClass(index: number): string {
    if (this.isCurrent(index)) return 'bg-white font-semibold text-neutral-900';
    switch (this.statuses()[index]) {
      case 'done':
        return 'bg-emerald-700 text-white';
      case 'skipped':
        return 'bg-neutral-800 text-neutral-500';
      default:
        return 'bg-neutral-800 text-neutral-200';
    }
  }

  protected skip(): void {
    this.next('skipped');
  }

  /** Progress strip: jump to any step, e.g. back to one that was skipped. */
  protected goTo(index: number): void {
    if (this.phase() === 'processing') return;
    if (index === this.stepIndex() && this.phase() !== 'finished') return;
    this.stepIndex.set(index);
    this.uploadFailed.set(false);
    this.showViewfinder();
  }

  private next(status: StepStatus): void {
    const statuses = withStatus(this.statuses(), this.stepIndex(), status);
    this.statuses.set(statuses);
    const nextIndex = nextPendingIndex(statuses, this.stepIndex());
    if (nextIndex >= 0) {
      this.stepIndex.set(nextIndex);
      this.showViewfinder();
    } else if (this.isGuided) {
      this.stopCamera();
      this.phase.set('finished');
    } else {
      this.dialogRef.close();
    }
  }

  protected close(): void {
    this.dialogRef.close();
  }
}

function sideHint(step: ScanStep): string {
  return step.kind === 'DISC_SIDE_A' ? 'side A' : 'side B';
}
