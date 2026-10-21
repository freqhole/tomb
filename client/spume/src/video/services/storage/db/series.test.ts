import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeVideoDB, getVideoDB, STORE_VIDEO_SERIES } from "./init";
import {
  createLocalVideoSeries,
  findLocalVideoSeriesByTitle,
  getLocalVideoSeriesList,
  getLocalVideoSeriesById,
  getOrCreateLocalVideoSeries,
  updateLocalVideoSeries,
} from "./series";

describe("local series availability", () => {
  beforeEach(() => {
    closeVideoDB();
    indexedDB = new IDBFactory();
  });

  afterEach(() => closeVideoDB());

  it.each(["legacy", "remote"] as const)(
    "does not inherit %s source-host state on reads or updates",
    async (kind) => {
      const series = await createLocalVideoSeries({ title: "series" });
      expect(series.is_offline).toBe(false);
      const stored = { ...series, is_offline: true };
      if (kind === "legacy") Reflect.deleteProperty(stored, "is_offline");
      const db = await getVideoDB();
      await db.put(STORE_VIDEO_SERIES, stored);
      await expect(findLocalVideoSeriesByTitle("series")).resolves.toMatchObject({ is_offline: false });
      await expect(getLocalVideoSeriesById(series.id)).resolves.toMatchObject({ is_offline: false });
      await expect(getOrCreateLocalVideoSeries("series")).resolves.toMatchObject({ id: series.id, is_offline: false });
      const result = await getLocalVideoSeriesList();
      expect(result.total_count).toBe(1);
      expect(result.items[0].is_offline).toBe(false);
      await updateLocalVideoSeries(series.id, { description: "updated" });
      await expect(db.get(STORE_VIDEO_SERIES, series.id)).resolves.toMatchObject({
        description: "updated", is_offline: false,
      });
    }
  );

  it("detail lookup is not limited to the first browse page", async () => {
    for (let index = 0; index < 51; index++) {
      await createLocalVideoSeries({ title: `series ${index}` });
    }
    const last = await createLocalVideoSeries({ title: "selected series" });
    await expect(getLocalVideoSeriesById(last.id)).resolves.toMatchObject({ id: last.id });
    await expect(getLocalVideoSeriesById("missing")).resolves.toBeNull();
  });
});
