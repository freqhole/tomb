// hand-written api client - wraps generated routes with fetch + zod validation
import { routes } from "./codegen/routes.js";
import type * as s from "./codegen/schema.js";
import { z } from "zod";

type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseError = { success: false; error: z.ZodError };
type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseError;

async function callInternal<Resp>(
  baseUrl: string,
  domain: string,
  routeName: string,
  respSchema: z.ZodType<Resp>,
  reqSchema: z.ZodTypeAny | null,
  method: string,
  path: string,
  params?: any,
): Promise<SafeParseResult<Resp>> {
  // for get/delete requests, params are used for path interpolation (not validated)
  // for post/put/etc, validate request body with safeparse
  if (method !== "GET" && method !== "DELETE" && reqSchema && params) {
    const validated = reqSchema.safeParse(params);
    if (!validated.success) {
      return { success: false, error: validated.error };
    }
    params = validated.data;
  }

  // interpolate path params (e.g. /users/{id} -> /users/123)
  let url = baseUrl + path;
  if (params && url.includes("{")) {
    url = url.replace(/\{(\w+)\}/g, (_, key) => {
      return params[key] !== undefined ? params[key] : `{${key}}`;
    });
  }

  // make request
  const options: RequestInit = {
    method: method,
    headers: { "Content-Type": "application/json" },
  };

  // only send body for post/put/patch methods
  if (method !== "GET" && method !== "DELETE" && params) {
    options.body = JSON.stringify(params);
  }

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      return {
        success: false,
        error: new z.ZodError([
          {
            code: "custom",
            path: [],
            message: `HTTP ${response.status}: ${response.statusText}`,
          },
        ]),
      };
    }

    const data = await response.json();

    // validate response with safeparse - properly typed, no cast needed!
    const result = respSchema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.error };
    }
  } catch (err) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          path: [],
          message: err instanceof Error ? err.message : "network error",
        },
      ]),
    };
  }
}

// generic call function for advanced use cases
export function call<T>(
  baseUrl: string,
  domain: keyof typeof routes,
  routeName: string,
  params?: any,
): Promise<SafeParseResult<T>> {
  const domainRoutes = routes[domain] as Record<string, any>;
  const route = domainRoutes[routeName];
  return callInternal(
    baseUrl,
    domain as string,
    routeName,
    route.resp,
    route.req,
    route.method,
    route.path,
    params,
  );
}

export function createClient(baseUrl: string) {
  return {
    app: {
      get_user: (params: { id: string }) =>
        callInternal(
          baseUrl,
          "app",
          "get_user",
          routes.app.get_user.resp,
          routes.app.get_user.req,
          routes.app.get_user.method,
          routes.app.get_user.path,
          params,
        ),
      login: (params: s.LoginRequest) =>
        callInternal(
          baseUrl,
          "app",
          "login",
          routes.app.login.resp,
          routes.app.login.req,
          routes.app.login.method,
          routes.app.login.path,
          params,
        ),
      create_user: (params: s.CreateUserRequest) =>
        callInternal(
          baseUrl,
          "app",
          "create_user",
          routes.app.create_user.resp,
          routes.app.create_user.req,
          routes.app.create_user.method,
          routes.app.create_user.path,
          params,
        ),
    },
    music: {
      get_album: (params: { id: string }) =>
        callInternal(
          baseUrl,
          "music",
          "get_album",
          routes.music.get_album.resp,
          routes.music.get_album.req,
          routes.music.get_album.method,
          routes.music.get_album.path,
          params,
        ),
      list_albums: (params: s.QueryParams) =>
        callInternal(
          baseUrl,
          "music",
          "list_albums",
          routes.music.list_albums.resp,
          routes.music.list_albums.req,
          routes.music.list_albums.method,
          routes.music.list_albums.path,
          params,
        ),
      get_song: (params: { id: string }) =>
        callInternal(
          baseUrl,
          "music",
          "get_song",
          routes.music.get_song.resp,
          routes.music.get_song.req,
          routes.music.get_song.method,
          routes.music.get_song.path,
          params,
        ),
      list_songs: (params: s.QueryParams) =>
        callInternal(
          baseUrl,
          "music",
          "list_songs",
          routes.music.list_songs.resp,
          routes.music.list_songs.req,
          routes.music.list_songs.method,
          routes.music.list_songs.path,
          params,
        ),
      create_playlist: (params: s.Playlist) =>
        callInternal(
          baseUrl,
          "music",
          "create_playlist",
          routes.music.create_playlist.resp,
          routes.music.create_playlist.req,
          routes.music.create_playlist.method,
          routes.music.create_playlist.path,
          params,
        ),
      get_playlist: (params: { id: string }) =>
        callInternal(
          baseUrl,
          "music",
          "get_playlist",
          routes.music.get_playlist.resp,
          routes.music.get_playlist.req,
          routes.music.get_playlist.method,
          routes.music.get_playlist.path,
          params,
        ),
      delete_playlist: (params: { id: string }) =>
        callInternal(
          baseUrl,
          "music",
          "delete_playlist",
          routes.music.delete_playlist.resp,
          routes.music.delete_playlist.req,
          routes.music.delete_playlist.method,
          routes.music.delete_playlist.path,
          params,
        ),
      list_playlists: (params: s.QueryParams) =>
        callInternal(
          baseUrl,
          "music",
          "list_playlists",
          routes.music.list_playlists.resp,
          routes.music.list_playlists.req,
          routes.music.list_playlists.method,
          routes.music.list_playlists.path,
          params,
        ),
      add_songs_to_playlist: (params: s.AddSongsToPlaylistRequest) =>
        callInternal(
          baseUrl,
          "music",
          "add_songs_to_playlist",
          routes.music.add_songs_to_playlist.resp,
          routes.music.add_songs_to_playlist.req,
          routes.music.add_songs_to_playlist.method,
          routes.music.add_songs_to_playlist.path,
          params,
        ),
    },
  };
}
