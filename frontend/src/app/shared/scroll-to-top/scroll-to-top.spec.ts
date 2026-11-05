import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollToTop } from './scroll-to-top';

describe('ScrollToTop', () => {
  let fixture: ComponentFixture<ScrollToTop>;

  beforeEach(() => {
    vi.stubGlobal('scrollY', 0);
    fixture = TestBed.createComponent(ScrollToTop);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function isShownAfterScrollingTo(y: number): Promise<boolean> {
    vi.stubGlobal('scrollY', y);
    window.dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('button') !== null;
  }

  it('is hidden at the top of the page', async () => {
    expect(await isShownAfterScrollingTo(0)).toBe(false);
  });

  it('appears past 400px by default', async () => {
    expect(await isShownAfterScrollingTo(400)).toBe(false);
    expect(await isShownAfterScrollingTo(401)).toBe(true);
  });

  it('honours a custom threshold', async () => {
    fixture.componentRef.setInput('showAfter', 100);

    expect(await isShownAfterScrollingTo(100)).toBe(false);
    expect(await isShownAfterScrollingTo(101)).toBe(true);
  });

  it('hides again after scrolling back up', async () => {
    expect(await isShownAfterScrollingTo(500)).toBe(true);
    expect(await isShownAfterScrollingTo(0)).toBe(false);
  });
});
