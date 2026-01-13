// generated route config
import * as s from './schema';
import { z } from 'zod';

export const routes = {
  app: {
    get_user: { method: 'GET', path: '/api/users/{id}', req: null, resp: s.UserSchema },
    login: { method: 'POST', path: '/api/users/login', req: s.LoginRequestSchema, resp: s.LoginResponseSchema },
    create_user: { method: 'POST', path: '/api/users', req: s.CreateUserRequestSchema, resp: s.UserSchema },
  },
  music: {
    get_album: { method: 'GET', path: '/api/music/albums/{id}', req: null, resp: s.AlbumSchema },
    list_albums: { method: 'POST', path: '/api/music/albums/list', req: s.QueryParamsSchema, resp: s.AlbumSchema.array() },
    get_song: { method: 'GET', path: '/api/music/songs/{id}', req: null, resp: s.SongSchema },
    list_songs: { method: 'POST', path: '/api/music/songs/list', req: s.QueryParamsSchema, resp: s.SongSchema.array() },
    add_songs_to_playlist: { method: 'POST', path: '/api/music/playlists/add-songs', req: s.AddSongsToPlaylistRequestSchema, resp: s.PlaylistUpdateResultSchema },
    delete_playlist: { method: 'DELETE', path: '/api/music/playlists/{id}', req: null, resp: z.boolean() },
    create_playlist: { method: 'POST', path: '/api/music/playlists', req: s.PlaylistSchema, resp: s.PlaylistSchema },
    get_playlist: { method: 'GET', path: '/api/music/playlists/{id}', req: null, resp: s.PlaylistSchema },
    list_playlists: { method: 'POST', path: '/api/music/playlists/list', req: s.QueryParamsSchema, resp: s.PlaylistQueryResultSchema.array() },
  },
};
