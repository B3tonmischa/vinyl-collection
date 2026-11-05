import { Signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistsApiService } from '../../core/services/artists-api';
import { Artist } from '../../models/vinyl.model';
import { ArtistPickerComponent } from './artist-picker';

const faber: Artist = { id: 6, name: 'Faber' };

/** Answers searches like the backend: case-insensitive "contains". */
class FakeArtistsApiService {
  create = vi.fn(async (name: string): Promise<Artist> => ({ id: 100, name }));

  searchResource(query: Signal<string>) {
    return {
      isLoading: () => false,
      value: () => [faber].filter((a) => a.name.toLowerCase().includes(query().toLowerCase())),
    };
  }
}

describe('ArtistPickerComponent add option', () => {
  let fixture: ComponentFixture<ArtistPickerComponent>;
  let fakeApi: FakeArtistsApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: ArtistsApiService, useClass: FakeArtistsApiService }],
    });
    fakeApi = TestBed.inject(ArtistsApiService) as unknown as FakeArtistsApiService;
    fixture = TestBed.createComponent(ArtistPickerComponent);
  });

  async function search(query: string, selected: Artist[] = []): Promise<string[]> {
    fixture.componentRef.setInput('selected', selected);
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    input.value = query;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    return dropdownItems().map((item) => item.textContent!.trim());
  }

  function dropdownItems(): Element[] {
    return Array.from(document.querySelectorAll('[role="listbox"] li'));
  }

  it('offers both the suggestion and the add option for a similar name', async () => {
    expect(await search('Fa')).toEqual(['Faber', '+ Add "Fa"']);
  });

  it('creates and selects the similar name instead of the suggestion', async () => {
    const emitted: Artist[][] = [];
    fixture.componentInstance.selectedChange.subscribe((artists) => emitted.push(artists));

    await search('Fa');
    (dropdownItems()[1].querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(fakeApi.create).toHaveBeenCalledWith('Fa');
    expect(emitted).toEqual([[{ id: 100, name: 'Fa' }]]);
  });

  it('offers only the existing artist for an identical name', async () => {
    expect(await search('faber')).toEqual(['Faber']);
  });

  it('does not offer to add an identical name that is already selected', async () => {
    expect(await search('Faber', [faber])).toEqual(['No matches']);
  });

  it('offers the add option when nothing matches', async () => {
    expect(await search('Zaz')).toEqual(['+ Add "Zaz"']);
  });
});
