import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { Artist, ReleaseType, Track } from '../../models/vinyl.model';
import { showsTrackArtists } from './tracklist.logic';

const NO_SIDE = '—';

interface SideGroup {
  side: string;
  tracks: Track[];
}

/** Tracklist grouped by side; `showsTrackArtists` decides which tracks show their effectiveArtists. */
@Component({
  selector: 'app-tracklist',
  templateUrl: './tracklist.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TracklistComponent {
  @Input({ required: true }) tracks!: Track[];
  @Input({ required: true }) albumArtists!: Artist[];
  @Input() releaseType: ReleaseType | null = null;

  /** Group key for tracks without a side; that group gets no heading. */
  protected readonly noSide = NO_SIDE;

  protected trackCount(count: number): string {
    return count === 1 ? '1 track' : `${count} tracks`;
  }

  protected get sides(): SideGroup[] {
    const groups = new Map<string, Track[]>();
    for (const track of this.tracks) {
      const key = track.side ?? NO_SIDE;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(track);
      } else {
        groups.set(key, [track]);
      }
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([side, tracks]) => ({
        side,
        tracks: [...tracks].sort((a, b) => a.position - b.position),
      }));
  }

  protected showsArtists(track: Track): boolean {
    return showsTrackArtists(track.effectiveArtists, this.albumArtists, this.releaseType);
  }

  protected artistNames(artists: Artist[]): string {
    return artists.map((a) => a.name).join(', ');
  }
}
