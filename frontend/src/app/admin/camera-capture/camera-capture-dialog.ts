import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  WritableSignal,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  Circle,
  DETECT_MAX_EDGE,
  LIVE_DETECT_MAX_EDGE,
  Point,
  Quad,
  SteadyDisc,
  Size,
  circleMaskPath,
  clampCircle,
  clampPoint,
  fitScale,
  guideCircle,
  guideFrameQuad,
  loupeSide,
  pickSleeveQuad,
  quadMaskPath,
  quadPoints,
  scaleCircle,
  scalePoints,
  squareOutputSize,
  steadyDisc,
} from './camera-capture.logic';
import {
  canvasSize,
  cropDiscToPngFile,
  cropSleeveWithoutWarp,
  detectionImage,
  drawLoupe,
  fileToWorkingCanvas,
  fullImageData,
  imageDataToJpegFile,
  toWorkingCanvas,
} from './camera-crop';
import { DiscDetector } from './disc-detector';
import { OpenCvScanDetector } from './scan-detector';
import { REFINE_BAND_DETECTION_PX, refineSleeveQuad } from './sleeve-refine';
import {
  ScanStep,
  StepStatus,
  discSide,
  nextPendingIndex,
  slotKey,
  withStatus,
} from './scan-session.logic';
import { ScanSetup } from './scan-setup';

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
/** What is being dragged on the adjust screen. */
type DragHandle = { corner: number } | 'center' | 'radius';

// Minimal typing for ImageCapture (Chrome/Android only, not in lib.dom).
interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

const LIVE_DETECT_INTERVAL_MS = 250;
// Keep showing the last live outline through a couple of missed frames,
// so it doesn't flicker while the phone moves slightly.
const LIVE_MISSES_BEFORE_CLEAR = 2;
/** Crop-handle radius as a share of the photo's longer edge. */
const HANDLE_RADIUS_FRACTION = 0.022;
/** On-screen size of the magnifier shown while dragging a handle. */
const LOUPE_CSS_PX = 128;
/** How much bigger the magnifier shows the photo than the adjust screen. */
const LOUPE_ZOOM = 3;

/**
 * Snaps a detected outline onto the sleeve's edges at the photo's full
 * working resolution (detection only saw a downscaled copy). Keeps the
 * detected outline if the pixels can't be read, e.g. out of memory.
 */
function refineSleeve(canvas: HTMLCanvasElement, quad: Quad): Quad {
  const band = REFINE_BAND_DETECTION_PX / fitScale(canvasSize(canvas), DETECT_MAX_EDGE);
  try {
    return refineSleeveQuad(fullImageData(canvas), quad, band);
  } catch {
    return quad;
  }
}

/**
 * Full-screen camera for photographing sleeves and discs, opened from
 * image-upload-panel. A guided session starts on a setup screen
 * (ScanSetup) and shows a progress strip of all its steps (tap one to
 * jump). Flow per step: live viewfinder (with a square or circle guide
 * and, once a detector is ready, the live detection drawn on top) → still
 * photo with an auto-detected, draggable crop → cropped File handed to
 * data.onCapture for upload. Sleeves get perspective-corrected to a
 * square JPEG; discs are cut round into a PNG with transparent corners.
 *
 * Needs a secure context for getUserMedia (prod is HTTPS via Cloudflare;
 * see `npm run start:lan` for phones in dev). Without a camera it still
 * works through "Pick from gallery".
 */
@Component({
  selector: 'app-camera-capture-dialog',
  imports: [NgTemplateOutlet, ScanSetup],
  templateUrl: './camera-capture-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full' },
  styles: [
    `
      .guide {
        fill: none;
        stroke: white;
        stroke-opacity: 0.6;
        stroke-width: 2;
        stroke-dasharray: 8 6;
        vector-effect: non-scaling-stroke;
      }
      .live {
        fill: rgb(16 185 129 / 0.15);
        stroke: rgb(52 211 153);
        stroke-width: 3;
        vector-effect: non-scaling-stroke;
      }
      .crop-mask {
        fill: black;
        fill-opacity: 0.55;
        fill-rule: evenodd;
        pointer-events: none;
      }
      /* No fill here: the disc outline is filled transparent as a drag target. */
      .crop-outline {
        stroke: rgb(129 140 248);
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
      }
      .handle-dot {
        fill: white;
        stroke: rgb(99 102 241);
        stroke-width: 3;
        vector-effect: non-scaling-stroke;
        pointer-events: none;
      }
    `,
  ],
})
export class CameraCaptureDialog implements OnInit, OnDestroy {
  protected readonly data = inject<CameraCaptureData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef<void>);
  private readonly detector = inject(OpenCvScanDetector);
  private readonly discDetector = inject(DiscDetector);

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly still = viewChild.required<ElementRef<HTMLCanvasElement>>('still');
  private readonly adjustSvg = viewChild<ElementRef<SVGSVGElement>>('adjustSvg');
  private readonly loupe = viewChild.required<ElementRef<HTMLCanvasElement>>('loupe');

  protected readonly guided = this.data.kind === 'guided' ? this.data : null;
  protected readonly phase = signal<Phase>(this.guided ? 'setup' : 'viewfinder');

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
  /** Cropping or uploading the photo failed; shown on the adjust screen. */
  protected readonly saveFailed = signal(false);

  protected readonly videoSize = signal<Size | null>(null);
  protected readonly liveQuad = signal<Quad | null>(null);
  protected readonly liveCircle = signal<Circle | null>(null);

  protected readonly stillSize = signal<Size>({ width: 1, height: 1 });
  protected readonly quad = signal<Quad | null>(null);
  protected readonly circle = signal<Circle | null>(null);
  protected readonly autoDetected = signal(false);
  /** Top corner the magnifier shows in while a handle is dragged, else null. */
  protected readonly loupeAt = signal<'left' | 'right' | null>(null);
  protected readonly loupeCssPx = LOUPE_CSS_PX;

  protected readonly step = computed<ScanStep | undefined>(() => this.steps()[this.stepIndex()]);

  /** One line under the title saying what to do right now. */
  protected readonly instruction = computed(() => {
    const step = this.step();
    switch (this.phase()) {
      case 'setup':
      case 'finished':
        return null;
      case 'adjust':
        return step?.mode === 'disc'
          ? 'Check the circle sits on the rim of the record.'
          : 'Check the corners sit on the corners of the sleeve.';
      default:
        if (!step) return null;
        return step.mode === 'disc'
          ? `Lay the record flat, side ${discSide(step.kind)} up, and fit it in the circle.`
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
    return Math.max(width, height) * HANDLE_RADIUS_FRACTION;
  });

  protected readonly slotKey = slotKey;
  protected readonly quadPoints = quadPoints;
  protected readonly quadMaskPath = quadMaskPath;
  protected readonly circleMaskPath = circleMaskPath;

  private stream: MediaStream | null = null;
  private working: HTMLCanvasElement | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private liveBusy = false;
  private liveMisses = 0;
  private steady: SteadyDisc | null = null;
  private dragging: DragHandle | null = null;
  private grabOffset: Point = { x: 0, y: 0 };

  ngOnInit(): void {
    this.detector.warmUp();
    // A guided session opens the camera when the user starts it, so the
    // camera light isn't on while they're still ticking boxes.
    if (!this.guided) void this.startCamera();
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  protected startScan(steps: ScanStep[]): void {
    this.steps.set(steps);
    this.statuses.set(steps.map(() => 'pending'));
    this.stepIndex.set(0);
    this.phase.set('viewfinder');
    void this.startCamera();
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

  /** Draws what the detectors currently see, so the user knows when to shoot. */
  private async liveDetect(): Promise<void> {
    const size = this.videoSize();
    const step = this.step();
    if (this.liveBusy || !size || !step || this.phase() !== 'viewfinder') return;
    this.liveBusy = true;
    try {
      const image = detectionImage(this.video().nativeElement, size, LIVE_DETECT_MAX_EDGE);
      if (step.mode === 'sleeve') {
        this.showLive(this.liveQuad, await this.detectSleeve(image, size));
      } else {
        const found = await this.detectDisc(image, size);
        this.steady = found ? steadyDisc(this.steady, found) : this.steady;
        this.showLive(this.liveCircle, found && this.steady?.shown);
      }
    } finally {
      this.liveBusy = false;
    }
  }

  private showLive<T>(target: WritableSignal<T | null>, found: T | null | undefined): void {
    if (found) {
      this.liveMisses = 0;
      target.set(found);
    } else if (++this.liveMisses > LIVE_MISSES_BEFORE_CLEAR) {
      this.steady = null;
      target.set(null);
    }
  }

  /** The sleeve outline in `target` pixel space, or null. */
  private async detectSleeve(image: ImageData, target: Size): Promise<Quad | null> {
    const detSize = { width: image.width, height: image.height };
    const candidates = await this.detector.detectQuads(image);
    const quad = candidates ? pickSleeveQuad(candidates, detSize) : null;
    return quad ? scalePoints(quad, detSize, target) : null;
  }

  /** The record's circle in `target` pixel space, or null. */
  private async detectDisc(image: ImageData, target: Size): Promise<Circle | null> {
    const detSize = { width: image.width, height: image.height };
    const circle = await this.discDetector.detect(image);
    return circle ? scaleCircle(circle, detSize, target) : null;
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
    this.saveFailed.set(false);

    const image = detectionImage(canvas, size);
    if (this.step()?.mode === 'sleeve') {
      const quad = await this.detectSleeve(image, size);
      this.autoDetected.set(!!quad);
      this.quad.set(quad ? refineSleeve(canvas, quad) : guideFrameQuad(size));
    } else {
      const circle = await this.detectDisc(image, size);
      this.autoDetected.set(!!circle);
      this.circle.set(circle ? clampCircle(circle, size) : guideCircle(size));
    }
    this.phase.set('adjust');
  }

  protected startDrag(handle: DragHandle, event: PointerEvent): void {
    event.preventDefault();
    this.dragging = handle;
    // Handles move by the finger's delta rather than snapping under the
    // finger, so nothing jumps when grabbed off-center.
    const p = this.toStillCoords(event);
    const anchor = this.handlePoint(handle);
    this.grabOffset = p && anchor ? { x: anchor.x - p.x, y: anchor.y - p.y } : { x: 0, y: 0 };
    this.adjustSvg()?.nativeElement.setPointerCapture(event.pointerId);
    this.updateLoupe();
  }

  protected onDrag(event: PointerEvent): void {
    const handle = this.dragging;
    if (handle === null) return;
    const finger = this.toStillCoords(event);
    if (!finger) return;
    const p = { x: finger.x + this.grabOffset.x, y: finger.y + this.grabOffset.y };
    const size = this.stillSize();
    if (typeof handle === 'object') {
      const quad = this.quad();
      if (!quad) return;
      const next = [...quad] as Quad;
      next[handle.corner] = clampPoint(p, size);
      this.quad.set(next);
    } else {
      const c = this.circle();
      if (!c) return;
      const moved =
        handle === 'center'
          ? { ...c, cx: p.x, cy: p.y }
          : { ...c, r: Math.hypot(p.x - c.cx, p.y - c.cy) };
      this.circle.set(clampCircle(moved, size));
    }
    this.updateLoupe();
  }

  protected endDrag(): void {
    this.dragging = null;
    this.loupeAt.set(null);
  }

  /** Where a handle currently sits, in still-image pixels. */
  private handlePoint(handle: DragHandle): Point | null {
    if (typeof handle === 'object') return this.quad()?.[handle.corner] ?? null;
    const c = this.circle();
    if (!c) return null;
    return handle === 'center' ? { x: c.cx, y: c.cy } : { x: c.cx + c.r, y: c.cy };
  }

  /**
   * Redraws the magnifier around the corner or rim handle being dragged
   * (the finger hides exactly the spot that needs placing). Moving the
   * whole disc doesn't need one.
   */
  private updateLoupe(): void {
    const handle = this.dragging;
    const point = handle && handle !== 'center' ? this.handlePoint(handle) : null;
    const outline = typeof handle === 'object' ? this.quad() : this.circle();
    const still = this.still().nativeElement;
    const shownWidth = still.getBoundingClientRect().width;
    if (!point || !outline || !shownWidth) {
      this.loupeAt.set(null);
      return;
    }
    const loupe = this.loupe().nativeElement;
    const pixels = Math.round(LOUPE_CSS_PX * devicePixelRatio);
    if (loupe.width !== pixels) loupe.width = loupe.height = pixels;
    // How many photo pixels the loupe's width covers on screen, cut by the zoom.
    const span = (LOUPE_CSS_PX * still.width) / (shownWidth * LOUPE_ZOOM);
    drawLoupe(loupe, still, point, span, outline);
    this.loupeAt.set(loupeSide(point, this.stillSize()));
  }

  private toStillCoords(event: PointerEvent): Point | null {
    const svg = this.adjustSvg()?.nativeElement;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  /** Back to the live camera, e.g. to retake the photo. */
  protected showViewfinder(): void {
    this.working = null;
    this.liveQuad.set(null);
    this.liveCircle.set(null);
    this.liveMisses = 0;
    this.steady = null;
    this.phase.set('viewfinder');
    if (this.stream) void this.resumeVideo();
    else void this.startCamera();
  }

  protected async usePhoto(): Promise<void> {
    const working = this.working;
    const step = this.step();
    if (!working || !step) return;
    this.phase.set('processing');
    let saved: boolean;
    try {
      saved = await this.data.onCapture(step, await this.cropFile(working, step));
    } catch {
      saved = false;
    }
    if (!saved) {
      this.saveFailed.set(true);
      this.phase.set('adjust');
      return;
    }
    this.completeStep('done');
  }

  private async cropFile(working: HTMLCanvasElement, step: ScanStep): Promise<File> {
    const size = canvasSize(working);
    if (step.mode === 'disc') {
      return cropDiscToPngFile(working, this.circle() ?? guideCircle(size), 'disc');
    }
    const quad = this.quad() ?? guideFrameQuad(size);
    const warped = await this.detector.warp(fullImageData(working), quad, squareOutputSize(quad));
    return warped
      ? imageDataToJpegFile(warped, 'sleeve')
      : cropSleeveWithoutWarp(working, quad, 'sleeve');
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
    this.completeStep('skipped');
  }

  /** Progress strip: jump to any step, e.g. back to one that was skipped. */
  protected goTo(index: number): void {
    if (this.phase() === 'processing') return;
    if (this.isCurrent(index)) return;
    this.stepIndex.set(index);
    this.saveFailed.set(false);
    this.showViewfinder();
  }

  /** Marks the current step and moves to the next pending one, or finishes. */
  private completeStep(status: StepStatus): void {
    const statuses = withStatus(this.statuses(), this.stepIndex(), status);
    this.statuses.set(statuses);
    const nextIndex = nextPendingIndex(statuses, this.stepIndex());
    if (nextIndex >= 0) {
      this.stepIndex.set(nextIndex);
      this.showViewfinder();
    } else if (this.guided) {
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
