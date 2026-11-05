import { Signal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { VinylsApiService } from '../../core/services/vinyls-api';
import { Vinyl } from '../../models/vinyl.model';
import { VinylFormPage } from './vinyl-form-page';

/**
 * Stands in for VinylsApiService so `detailResource` can be driven directly:
 * tests set `detail.set(vinyl)` to simulate the record the route's `:id`
 * currently resolves to, without any real HTTP round trip.
 */
class FakeVinylsApiService {
  detail = signal<Vinyl | undefined>(undefined);
  reloadCount = 0;

  detailResource(_id: Signal<number | null | undefined>) {
    return {
      isLoading: () => false,
      error: () => undefined,
      hasValue: () => this.detail() !== undefined,
      value: () => this.detail(),
      reload: () => {
        this.reloadCount++;
      },
    };
  }
}

function makeVinyl(overrides: Partial<Vinyl>): Vinyl {
  return {
    id: 1,
    title: 'Original Title',
    year: 1970,
    label: null,
    catalogNumber: null,
    releaseType: null,
    discSize: null,
    speed: null,
    genre: null,
    notes: null,
    artists: [],
    tracks: [],
    images: [],
    ...overrides,
  };
}

describe('VinylFormPage form-state refresh', () => {
  let fakeApi: FakeVinylsApiService;
  let fixture: ComponentFixture<VinylFormPage>;
  let component: VinylFormPage;

  beforeEach(() => {
    fakeApi = new FakeVinylsApiService();
    TestBed.configureTestingModule({
      providers: [
        { provide: VinylsApiService, useValue: fakeApi },
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    fixture = TestBed.createComponent(VinylFormPage);
    component = fixture.componentInstance;
    component.id = '1';
    fixture.detectChanges();
  });

  function fields(): Record<string, unknown> {
    return {
      title: (component as unknown as { title: Signal<string> }).title(),
      year: (component as unknown as { year: Signal<number | null> }).year(),
    };
  }

  it('populates the form when the record for the routed id loads', () => {
    fakeApi.detail.set(makeVinyl({ id: 1, title: 'Original Title', year: 1970 }));
    fixture.detectChanges();

    expect(fields()).toEqual({ title: 'Original Title', year: 1970 });
  });

  it('re-populates every field when the route moves to a different vinyl', () => {
    fakeApi.detail.set(makeVinyl({ id: 1, title: 'Original Title', year: 1970 }));
    fixture.detectChanges();

    // Simulate the import flow: the route's :id changes to a newly-created
    // vinyl while this component instance is reused (Angular does not
    // destroy/recreate it just because a route param changed).
    component.id = '2';
    fakeApi.detail.set(makeVinyl({ id: 2, title: 'Imported Title', year: 2024 }));
    fixture.detectChanges();

    expect(fields()).toEqual({ title: 'Imported Title', year: 2024 });
  });

  it('does not clobber in-progress edits when the same vinyl reloads (e.g. after an image change)', () => {
    fakeApi.detail.set(makeVinyl({ id: 1, title: 'Original Title', year: 1970 }));
    fixture.detectChanges();

    (component as unknown as { title: { set(v: string): void } }).title.set('User is mid-edit');

    // Same vinyl id reloads (e.g. detailResource.reload() after an image upload).
    fakeApi.detail.set(makeVinyl({ id: 1, title: 'Original Title', year: 1970 }));
    fixture.detectChanges();

    expect(fields()['title']).toBe('User is mid-edit');
  });
});
