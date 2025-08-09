import { describe, it, expect } from "vitest";

// Test just the component imports and basic structure
describe("Component Validation", () => {
  it("can import all components without errors", async () => {
    // Test that components can be imported
    const { PlaylistSidebar } = await import("./PlaylistSidebar.tsx");
    const { SongRow } = await import("./SongRow.tsx");
    const { Playlistz } = await import("./index.tsx");

    expect(PlaylistSidebar).toBeDefined();
    expect(SongRow).toBeDefined();
    expect(Playlistz).toBeDefined();
  });

  it("can import database service functions", async () => {
    const { getSongById, getAllSongs, getAllPlaylists } = await import(
      "../services/indexedDBService.js"
    );

    expect(getSongById).toBeDefined();
    expect(getAllSongs).toBeDefined();
    expect(getAllPlaylists).toBeDefined();
    expect(typeof getSongById).toBe("function");
    expect(typeof getAllSongs).toBe("function");
    expect(typeof getAllPlaylists).toBeDefined();
  });
});
