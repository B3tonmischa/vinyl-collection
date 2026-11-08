import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { VinylImage } from '../../models/vinyl.model';
import { ImageUploadPanel } from './image-upload-panel';

describe('ImageUploadPanel disc slots', () => {
  let fixture: ComponentFixture<ImageUploadPanel>;

  function render(sides: string[], images: VinylImage[] = []): void {
    fixture.componentRef.setInput('images', images);
    fixture.componentRef.setInput('sides', sides);
    fixture.detectChanges();
  }

  /** Labels under the "Disc scans" heading. */
  const discLabels = () => {
    const sections = fixture.nativeElement.querySelectorAll(':scope > div > div');
    const discSection = sections[sections.length - 1] as HTMLElement;
    return Array.from(discSection.querySelectorAll('p')).map((p) => p.textContent?.trim());
  };
  const addDiscButton = () =>
    Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.includes('Add another disc'),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ImageUploadPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ImageUploadPanel);
    fixture.componentRef.setInput('vinylId', 1);
  });

  it('has one disc for sides A and B', () => {
    render(['A', 'B']);
    expect(discLabels()).toEqual(['Side A', 'Side B']);
  });

  it('adds a disc for sides C and D', () => {
    render(['A', 'B', 'C']);
    expect(discLabels()).toEqual([
      'Disc 1 · Side A',
      'Disc 1 · Side B',
      'Disc 2 · Side A',
      'Disc 2 · Side B',
    ]);
  });

  it('keeps discs that already have images even without their sides', () => {
    render(['A', 'B'], [
      { id: 9, kind: 'DISC_SIDE_A', discNumber: 3, fullPath: 'f', thumbPath: 't' },
    ]);
    expect(discLabels()).toHaveLength(6);
  });

  it('adds a disc beyond the ones the sides already call for', () => {
    render(['A', 'B', 'C', 'D']);
    addDiscButton()!.click();
    fixture.detectChanges();
    expect(discLabels()).toHaveLength(6);
  });

  it('stops offering another disc at the maximum', () => {
    render(['S', 'T']);
    expect(discLabels()).toHaveLength(20);
    expect(addDiscButton()).toBeUndefined();
  });
});
