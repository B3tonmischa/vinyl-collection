import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { Artist, Track } from '../../models/vinyl.model';

interface SideGroup {
  side: string;
  tracks: Track[];
}

/** Tracklist grouped by side; each track shows its effectiveArtists when they differ from the album's. */
@Component({
  selector: 'app-tracklist',
  templateUrl: './tracklist.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TracklistComponent {
  @Input({ required: true }) tracks!: Track[];
  @Input({ required: true }) albumArtists!: Artist[];

  protected get sides(): SideGroup[] {
    const groups = new Map<string, Track[]>();
    for (const track of this.tracks) {
      const key = track.side ?? '—';
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

  protected differsFromAlbum(track: Track): boolean {
    const albumIds = new Set(this.albumArtists.map((a) => a.id));
    if (track.effectiveArtists.length !== albumIds.size) return true;
    return track.effectiveArtists.some((a) => !albumIds.has(a.id));
  }

  protected artistNames(artists: Artist[]): string {
    return artists.map((a) => a.name).join(', ');
  }
}
