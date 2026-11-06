import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Circle, Size } from './camera-capture.logic';
import {
  RimCandidate,
  detectDisc,
  fitOutline,
  isPlausibleRim,
  longestGap,
  pickRim,
  tracePath,
} from './disc-detect';
import { Pixels } from './sleeve-refine';

const ANGLES = 144;

/** Same limits as the measurements in the pull request: 2% of the radius. */
function expectOnRim(found: Circle | null, truth: Circle, label = ''): void {
  expect(found, `${label}: nothing found`).not.toBeNull();
  const off = Math.hypot(found!.cx - truth.cx, found!.cy - truth.cy) / truth.r;
  const size = Math.abs(found!.r - truth.r) / truth.r;
  expect(off, `${label}: centre`).toBeLessThanOrEqual(0.02);
  expect(size, `${label}: radius`).toBeLessThanOrEqual(0.02);
}

// ── The example photos ─────────────────────────────────────────────────────

const PHOTOS_DIR = 'src/app/admin/camera-capture/testing/disc-photos';

/**
 * Rims measured on the full 3072×4096 or 4096×3072 photos, as the mean radius
 * of an ellipse fitted to the edge at full resolution, checked by eye.
 * The photos aren't in the repo; see scripts/make-disc-fixtures.mjs.
 */
const PHOTOS: { name: string; about: string; size: Size; rim: Circle }[] = [
  {
    name: 'IMG_20261104_233602',
    about: 'splatter record on a table in a cluttered room',
    size: { width: 3072, height: 4096 },
    rim: { cx: 1497, cy: 2013, r: 895 },
  },
  {
    name: 'IMG_20261104_233608',
    about: 'the same, close up and tilted: an ellipse 9% out of round',
    size: { width: 3072, height: 4096 },
    rim: { cx: 1328, cy: 2024, r: 1135 },
  },
  {
    name: 'IMG_20261104_233611',
    about: 'the same on a turned table, tilted: 8% out of round',
    size: { width: 3072, height: 4096 },
    rim: { cx: 1272, cy: 1921, r: 839 },
  },
  {
    name: 'IMG_20261104_233617',
    about: 'white splatter record on a white sleeve on a creased bed',
    size: { width: 4096, height: 3072 },
    rim: { cx: 1991, cy: 1536, r: 962 },
  },
  {
    name: 'IMG_20261104_235901',
    about: 'clear record on a light sheet',
    size: { width: 4096, height: 3072 },
    rim: { cx: 1791, cy: 1495, r: 1041 },
  },
];

function photoFrame(name: string, size: Size, maxEdge: number): Pixels | null {
  const scale = maxEdge / Math.max(size.width, size.height);
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  const file = `${PHOTOS_DIR}/${name}-${width}x${height}.rgba.gz`;
  if (!existsSync(file)) return null;
  return { data: new Uint8ClampedArray(gunzipSync(readFileSync(file))), width, height };
}

describe('detectDisc on the example photos', () => {
  const present = PHOTOS.some((p) => photoFrame(p.name, p.size, 800));

  for (const { name, about, size, rim } of PHOTOS) {
    for (const maxEdge of [800, 560]) {
      it.skipIf(!present)(`finds the ${about}, at ${maxEdge} px`, () => {
        const frame = photoFrame(name, size, maxEdge);
        expect(frame, `run scripts/make-disc-fixtures.mjs for ${name}`).not.toBeNull();
        const k = frame!.width / size.width;
        const truth = { cx: rim.cx * k, cy: rim.cy * k, r: rim.r * k };
        expectOnRim(detectDisc(frame!), truth, name);
      });
    }
  }
});

// ── Rendered records, so the same cases run without the photos ─────────────

type Rgb = [number, number, number];

interface RenderedRecord {
  rx: number;
  ry: number;
  cx: number;
  cy: number;
  /** Color at `rho`, 0 at the centre and 1 at the rim, along direction `theta`. */
  surface: (rho: number, theta: number) => Rgb;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb;

/** Repeatable noise in 0–1. */
function noise(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function render(size: Size, background: (x: number, y: number) => Rgb, record?: RenderedRecord): Pixels {
  const { width, height } = size;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color = background(x, y);
      if (record) {
        const u = (x + 0.5 - record.cx) / record.rx;
        const v = (y + 0.5 - record.cy) / record.ry;
        const rho = Math.hypot(u, v);
        const onRecord = Math.min(1, Math.max(0, (1 - rho) * Math.min(record.rx, record.ry) + 0.5));
        if (onRecord > 0) {
          color = mix(color, record.surface(rho, Math.atan2(v, u)), onRecord);
        }
      }
      const grain = (noise(x, y) - 0.5) * 3;
      const i = (y * width + x) * 4;
      data.set([color[0] + grain, color[1] + grain, color[2] + grain, 255], i);
    }
  }
  return { data, width, height };
}

const FRAME: Size = { width: 420, height: 560 };

/** A light sheet with soft diagonal folds. */
const sheet = (x: number, y: number): Rgb => {
  const fold = 8 * Math.sin((x + y * 0.6) / 37) + 5 * Math.sin((x * 0.4 - y) / 23);
  return [226 + fold, 214 + fold, 200 + fold];
};

/** Wood with grain along its length, up to a straight edge with a floor behind it. */
const table = (x: number, y: number): Rgb => {
  if (y < 70) return [90, 80, 72];
  const grain = 10 * Math.sin(x / 3.1 + Math.sin(y / 40) * 2) + 7 * Math.sin(x / 11);
  return [176 + grain, 128 + grain * 0.8, 72 + grain * 0.5];
};

const label = (color: Rgb) => (rho: number) => (rho < 0.02 ? ([40, 36, 34] as Rgb) : color);

/** Black vinyl, with the light catching the grooves in two opposite wedges. */
const blackVinyl = (rho: number, theta: number): Rgb => {
  if (rho < 0.33) return label([200, 60, 44])(rho);
  const sheen = 60 * Math.abs(Math.cos(theta + 0.7)) ** 20 + 3 * Math.sin(rho * 200);
  return [18 + sheen, 18 + sheen, 20 + sheen];
};

/** White vinyl with streaks of color running out from the middle, stopping short of the rim. */
const splatter = (rho: number, theta: number): Rgb => {
  if (rho < 0.33) return label([196, 52, 44])(rho);
  const spoke = Math.floor(((theta + Math.PI) / (2 * Math.PI)) * 60);
  const tip = 0.72 + 0.22 * noise(spoke, 3);
  const inStreak = noise(spoke, 1) > 0.45 && rho < tip && rho > 0.4 + 0.2 * noise(spoke, 2);
  return inStreak ? [178, 58, 84] : [236, 238, 240];
};

/** Clear vinyl: the sheet shows through it, darker, up to a flat lip paler than the grooves. */
const clearVinyl = (rho: number): Rgb => {
  if (rho < 0.33) return label([28, 28, 30])(rho);
  return rho > 0.94 ? [200, 196, 186] : [172 + 3 * Math.sin(rho * 150), 182, 170];
};

describe('detectDisc on rendered records', () => {
  const upright = { cx: 212, cy: 284, rx: 165, ry: 165 };

  it('finds a black record on a light sheet', () => {
    const image = render(FRAME, sheet, { ...upright, surface: blackVinyl });
    expectOnRim(detectDisc(image), { cx: 212, cy: 284, r: 165 });
  });

  it('finds a black record on a table with an edge in view', () => {
    const image = render(FRAME, table, { ...upright, surface: blackVinyl });
    expectOnRim(detectDisc(image), { cx: 212, cy: 284, r: 165 });
  });

  it('finds the rim of a splatter record, not a circle through its streaks', () => {
    const image = render(FRAME, table, { ...upright, surface: splatter });
    expectOnRim(detectDisc(image), { cx: 212, cy: 284, r: 165 });
  });

  it('finds the rim of a clear record, past its lip', () => {
    const image = render(FRAME, sheet, { ...upright, surface: clearVinyl });
    expectOnRim(detectDisc(image), { cx: 212, cy: 284, r: 165 });
  });

  it('finds a record shot at an angle, whose rim is an ellipse', () => {
    const image = render(FRAME, sheet, {
      cx: 205,
      cy: 290,
      rx: 170,
      ry: 156,
      surface: blackVinyl,
    });
    expectOnRim(detectDisc(image), { cx: 205, cy: 290, r: 163 });
  });

  it('finds a record away from the middle of the frame', () => {
    const image = render(FRAME, sheet, { cx: 180, cy: 340, rx: 150, ry: 150, surface: splatter });
    expectOnRim(detectDisc(image), { cx: 180, cy: 340, r: 150 });
  });

  it('finds no record on an empty sheet', () => {
    expect(detectDisc(render(FRAME, sheet))).toBeNull();
  });

  it('finds no record on a sleeve', () => {
    const sleeve = (x: number, y: number): Rgb =>
      x > 60 && x < 360 && y > 130 && y < 430 ? [40, 44, 90] : sheet(x, y);
    expect(detectDisc(render(FRAME, sleeve))).toBeNull();
  });

  it('reports the circle in the pixels of the image it was given', () => {
    const big: Size = { width: FRAME.width * 2, height: FRAME.height * 2 };
    const image = render(big, (x, y) => sheet(x / 2, y / 2), {
      cx: 424,
      cy: 568,
      rx: 330,
      ry: 330,
      surface: blackVinyl,
    });
    expectOnRim(detectDisc(image), { cx: 424, cy: 568, r: 330 });
  });
});

// ── The steps ──────────────────────────────────────────────────────────────

/** Polar edges with a single edge at radius `rimAt(ray)`. */
function polarWith(rimAt: (ray: number) => number, radii = 120) {
  const values = new Float32Array(ANGLES * radii);
  const brightening = new Uint8Array(ANGLES * radii);
  for (let ray = 0; ray < ANGLES; ray++) {
    values[ray * radii + Math.round(rimAt(ray))] = 10;
  }
  return { values, brightening, radii };
}

const angleOf = (ray: number) => (2 * Math.PI * ray) / ANGLES;

describe('tracePath', () => {
  it('follows a rim seen from off its centre, all the way round', () => {
    const rim = (ray: number) => 80 + 6 * Math.cos(angleOf(ray));
    const edges = polarWith(rim);
    const path = tracePath(edges, new Int32Array(ANGLES).fill(80), 14);
    for (let ray = 0; ray < ANGLES; ray++) {
      expect(Math.abs(path[ray] - rim(ray))).toBeLessThanOrEqual(1);
    }
  });

  it('bridges gaps in the rim', () => {
    const rim = (ray: number) => 80 + 6 * Math.cos(angleOf(ray));
    const edges = polarWith(rim);
    for (let ray = 20; ray < 50; ray++)
      edges.values.fill(0, ray * edges.radii, (ray + 1) * edges.radii);
    const path = tracePath(edges, new Int32Array(ANGLES).fill(80), 14);
    expect(Math.abs(path[35] - rim(35))).toBeLessThanOrEqual(6);
  });

  it('ends where it starts', () => {
    const path = tracePath(
      polarWith((ray) => 80 + 9 * Math.sin(angleOf(ray))),
      new Int32Array(ANGLES).fill(80),
      14,
    );
    expect(Math.abs(path[0] - path[ANGLES - 1])).toBeLessThanOrEqual(2);
  });
});

describe('fitOutline', () => {
  const pathOf = (rim: (ray: number) => number) =>
    Int32Array.from({ length: ANGLES }, (_, r) => Math.round(rim(r)));

  it('splits an outline into radius, centre shift and ovalness', () => {
    const rim = (ray: number) => {
      const a = angleOf(ray);
      return 90 + 5 * Math.cos(a) - 3 * Math.sin(a) + 4 * Math.cos(2 * a);
    };
    const outline = fitOutline(pathOf(rim), polarWith(rim))!;
    expect(outline.coverage).toBeGreaterThan(0.95);
    const [c0, c1, c2, c3] = outline.coefficients;
    expect(c0).toBeCloseTo(90, 0);
    expect(c1).toBeCloseTo(5, 0);
    expect(c2).toBeCloseTo(-3, 0);
    expect(c3).toBeCloseTo(4, 0);
  });

  it("isn't pulled away by a stretch off the rim", () => {
    const rim = () => 90;
    const stray = (ray: number) => (ray < 30 ? 110 : 90);
    const edges = polarWith(stray);
    const outline = fitOutline(pathOf(stray), edges)!;
    expect(outline.coefficients[0]).toBeCloseTo(rim(), 0);
    expect(outline.coverage).toBeCloseTo((ANGLES - 30) / ANGLES, 1);
  });
});

describe('longestGap', () => {
  it('measures the longest run off the outline, across the start of the circle', () => {
    const on = new Float64Array(ANGLES).fill(1);
    on.fill(0, 0, 10);
    on.fill(0, ANGLES - 26);
    expect(longestGap(on)).toBeCloseTo(36 / ANGLES);
  });

  it('is 1 when nothing lies on the outline', () => {
    expect(longestGap(new Float64Array(ANGLES))).toBe(1);
  });
});

describe('picking the rim', () => {
  const frame: Size = { width: 400, height: 300 };
  const rim: RimCandidate = {
    cx: 200,
    cy: 150,
    r: 120,
    coverage: 0.8,
    gap: 0.1,
    ellipticity: 0.03,
  };

  it('accepts a well-covered ring in the frame', () => {
    expect(isPlausibleRim(rim, frame)).toBe(true);
  });

  it.each([
    ['barely on edges', { coverage: 0.4 }],
    ['with a long stretch of nothing', { gap: 0.45 }],
    ['too oval to be a record', { ellipticity: 0.2 }],
    ['sticking out of the frame', { cx: 100 }],
    ['too small', { r: 30 }],
  ])('rejects a ring %s', (_, change) => {
    expect(isPlausibleRim({ ...rim, ...change }, frame)).toBe(false);
  });

  it('prefers the rim to the cleaner circles inside it', () => {
    const label = { ...rim, r: 56, coverage: 1 };
    expect(pickRim([label, rim], frame)).toBe(rim);
  });

  it('prefers the rim to a wider ring that only partly lies on edges', () => {
    const wider = { ...rim, r: 145, coverage: 0.61 };
    expect(pickRim([wider, rim], frame)).toBe(rim);
  });

  it('has nothing to pick from implausible candidates', () => {
    expect(pickRim([{ ...rim, coverage: 0.2 }], frame)).toBeNull();
  });
});
