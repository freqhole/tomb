/* @jsxImportSource solid-js */
import { createSignal, Show } from 'solid-js';
import type { Playlist } from '../types/playlist.js';

interface PlaylistDetailProps {
  playlist: Playlist;
  onPlaylistUpdate: (playlist: Playlist | null) => void;
}

export function PlaylistDetail(props: PlaylistDetailProps) {
  const [isEditing, setIsEditing] = createSignal(false);

  return (
    <div class="h-full p-6">
      <div class="max-w-4xl mx-auto">
        {/* Header */}
        <div class="flex items-start space-x-6 mb-8">
          {/* Playlist cover */}
          <div class="flex-shrink-0">
            <div class="w-48 h-48 bg-gray-700 rounded-lg overflow-hidden">
              <Show
                when={props.playlist.image}
                fallback={
                  <div class="w-full h-full flex items-center justify-center text-gray-400">
                    <svg class="w-16 h-16" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.369 4.369 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                    </svg>
                  </div>
                }
              >
                <img
                  src={props.playlist.image}
                  alt={props.playlist.title}
                  class="w-full h-full object-cover"
                />
              </Show>
            </div>
          </div>

          {/* Playlist info */}
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between mb-2">
              <h1 class="text-4xl font-bold text-white truncate">
                {props.playlist.title}
              </h1>
              <button
                onClick={() => setIsEditing(!isEditing())}
                class="px-3 py-1 text-sm text-gray-400 hover:text-white border border-gray-600 rounded hover:border-gray-400 transition-colors"
              >
                {isEditing() ? 'Cancel' : 'Edit'}
              </button>
            </div>

            <Show when={props.playlist.description}>
              <p class="text-gray-300 text-lg mb-4">
                {props.playlist.description}
              </p>
            </Show>

            <div class="flex items-center text-sm text-gray-400 space-x-4">
              <span>{props.playlist.songIds?.length || 0} songs</span>
              <span>•</span>
              <span>Created {new Date(props.playlist.createdAt).toLocaleDateString()}</span>
            </div>

            {/* Play button */}
            <div class="mt-6">
              <button class="px-8 py-3 bg-magenta-500 text-white rounded-full hover:bg-magenta-600 transition-colors font-semibold">
                <svg class="w-5 h-5 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                </svg>
                Play All
              </button>
            </div>
          </div>
        </div>

        {/* Songs list */}
        <div class="bg-gray-900 bg-opacity-30 rounded-lg p-6">
          <h2 class="text-xl font-semibold mb-4 text-white">Songs</h2>

          <Show
            when={(props.playlist.songIds?.length || 0) > 0}
            fallback={
              <div class="text-center py-12">
                <div class="text-gray-400 text-4xl mb-4">🎵</div>
                <p class="text-gray-400 text-lg">No songs in this playlist yet</p>
                <p class="text-gray-500 text-sm mt-2">
                  Drag and drop audio files here to add them
                </p>
              </div>
            }
          >
            <div class="space-y-2">
              {/* Placeholder song rows */}
              <div class="text-gray-400 text-sm">
                Songs will appear here once implemented...
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
