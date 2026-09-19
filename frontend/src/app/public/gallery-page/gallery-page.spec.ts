import { Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VinylsApiService } from '../../core/services/vinyls-api';
import { GalleryPage } from './gallery-page';

/**
 * Stands in for VinylsApiService so the debounce behavior can be verified
 * without any real HTTP traffic: `listResource` just records the query
 * signal the component wired it up with, and returns an inert resource
 * shape (never loading, no error, an empty result) so the template renders
 * without needing a real httpResource/backend round trip.
 */
class FakeVinylsApiService {
  querySignal: Signal<string> | undefined;

  listResource(query: Signal<string>) {
    this.querySignal = query;
    return {
      isLoading: () => false,
      error: () => undefined,
      hasValue: () => true,
      value: () => [],
      reload: () => {},
    };
  }
}

describe('GalleryPage search debounce', () => {
  let fakeApi: FakeVinylsApiService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [{ provide: VinylsApiService, useClass: FakeVinylsApiService }, provideRouter([])],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createFixture() {
    const fixture = TestBed.createComponent(GalleryPage);
    fixture.detectChanges();
    fakeApi = TestBed.inject(VinylsApiService) as unknown as FakeVinylsApiService;
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type="search"]');
    return { fixture, input };
  }

  function typeInto(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('does not query immediately on keystroke', () => {
    const { fixture, input } = createFixture();
    typeInto(input, 'floyd');
    fixture.detectChanges();
    expect(fakeApi.querySignal?.()).toBe('');
  });

  it('queries with the typed value only after the debounce window elapses', () => {
    const { fixture, input } = createFixture();
    typeInto(input, 'floyd');
    fixture.detectChanges();

    vi.advanceTimersByTime(299);
    fixture.detectChanges();
    expect(fakeApi.querySignal?.()).toBe('');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(fakeApi.querySignal?.()).toBe('floyd');
  });

  it('resets the timer on every keystroke, only committing the final value', () => {
    const { fixture, input } = createFixture();

    typeInto(input, 'f');
    vi.advanceTimersByTime(200);
    typeInto(input, 'fl');
    vi.advanceTimersByTime(200);
    typeInto(input, 'flo');
    fixture.detectChanges();

    // Neither of the earlier, superseded keystrokes should ever have committed.
    vi.advanceTimersByTime(299);
    fixture.detectChanges();
    expect(fakeApi.querySignal?.()).toBe('');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(fakeApi.querySignal?.()).toBe('flo');
  });

  it('debounces back to an empty query when the search box is cleared', () => {
    const { fixture, input } = createFixture();
    typeInto(input, 'floyd');
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(fakeApi.querySignal?.()).toBe('floyd');

    typeInto(input, '');
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(fakeApi.querySignal?.()).toBe('');
  });
});
