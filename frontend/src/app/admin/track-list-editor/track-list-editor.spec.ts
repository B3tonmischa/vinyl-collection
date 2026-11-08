import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { TrackListEditorComponent } from './track-list-editor';
import { TrackFormRow, createEmptyTrackRow, knownSides } from './track-list-editor.logic';

describe('TrackListEditorComponent sides', () => {
  let fixture: ComponentFixture<TrackListEditorComponent>;
  let rows: TrackFormRow[];
  let added: string[];

  function render(): void {
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('sides', knownSides(rows, added));
    fixture.detectChanges();
  }

  const selects = () =>
    Array.from(fixture.nativeElement.querySelectorAll('select')) as HTMLSelectElement[];
  const button = (label: string) =>
    Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.includes(label) || b.getAttribute('aria-label') === label,
    )!;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TrackListEditorComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(TrackListEditorComponent);
    rows = [
      { ...createEmptyTrackRow(1), side: 'A' },
      { ...createEmptyTrackRow(2), side: 'C' },
    ];
    added = [];
    fixture.componentRef.setInput('albumArtists', []);
    fixture.componentInstance.rowsChange.subscribe((next) => {
      rows = next;
      render();
    });
    fixture.componentInstance.sideAdded.subscribe((side) => {
      added = [...added, side];
      render();
    });
    render();
  });

  it("shows each row's side as the selected dropdown option", () => {
    expect(selects().map((s) => s.value)).toEqual(['A', 'C']);
    expect(Array.from(selects()[0].options).map((o) => o.value)).toEqual(['', 'A', 'B', 'C']);
  });

  it('starts a new track on the side last picked on any row', () => {
    const first = selects()[0];
    first.value = 'B';
    first.dispatchEvent(new Event('change'));

    button('+ Add track').click();

    expect(rows.map((r) => r.side)).toEqual(['B', 'C', 'B']);
    expect(selects()[2].value).toBe('B');
  });

  it("starts a new track on the last row's side when nothing was picked yet", () => {
    button('+ Add track').click();
    expect(rows.at(-1)?.side).toBe('C');
  });

  it('adds the next side to every dropdown and puts the row on it', () => {
    button('Add side D').click();

    expect(added).toEqual(['D']);
    expect(rows[0].side).toBe('D');
    for (const select of selects()) {
      expect(Array.from(select.options).map((o) => o.value)).toContain('D');
    }
  });
});
