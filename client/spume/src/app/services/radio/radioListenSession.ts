import type { ApiClient } from "../../api/client";

interface PlayedItem {
  entity_type: "song" | "video";
  entity_id: string;
}

type SessionClient = {
  music: Pick<
    ApiClient["music"],
    "createPlaybackSession" | "updatePlaybackSessionItems" | "updatePlaybackSessionStatus"
  >;
};

export class RadioListenSession {
  private items: PlayedItem[] = [];
  private historyKeys = new Set<string>();
  private durationMs = 0;
  private started = false;
  private ended = false;
  private sessionId: string | null = null;
  private client: SessionClient | null = null;
  private syncedCount = -1;
  private pending = Promise.resolve();
  private initialItem: PlayedItem | null = null;
  private pendingTrack: { item: PlayedItem; historyKey: string; durationMs: number } | null = null;

  constructor(
    private stationId: string,
    private label: string,
    private getClient: () => Promise<SessionClient>
  ) {}

  record(item: PlayedItem, historyKey: string, durationMs = 0): void {
    if (this.ended || !item.entity_id || this.historyKeys.has(historyKey)) return;
    if (!this.started) {
      this.pendingTrack = { item, historyKey, durationMs };
      return;
    }
    this.historyKeys.add(historyKey);
    if (
      this.initialItem?.entity_type === item.entity_type &&
      this.initialItem.entity_id === item.entity_id
    ) {
      this.initialItem = null;
      return;
    }
    this.initialItem = null;
    this.items.push(item);
    this.durationMs += Math.max(0, durationMs);
    if (this.started) this.enqueue(() => this.sync());
  }

  start(initialItem?: PlayedItem, durationMs = 0): void {
    if (this.ended) return;
    const previousCount = this.items.length;
    const firstStart = !this.started;
    this.started = true;
    const pending = this.pendingTrack;
    this.pendingTrack = null;
    if (
      firstStart &&
      pending &&
      (!initialItem ||
        (pending.item.entity_type === initialItem.entity_type &&
          pending.item.entity_id === initialItem.entity_id))
    ) {
      this.record(pending.item, pending.historyKey, pending.durationMs);
    } else if (initialItem && this.items.length === 0) {
      this.record(
        initialItem,
        `initial:${initialItem.entity_type}:${initialItem.entity_id}`,
        durationMs
      );
      this.initialItem = initialItem;
    }
    if (this.items.length === previousCount) this.enqueue(() => this.sync());
  }

  end(status: "completed" | "abandoned"): Promise<void> {
    this.ended = true;
    if (!this.started) return this.pending;
    return this.enqueue(async () => {
      await this.sync();
      if (!this.client || !this.sessionId) return;
      const result = await this.client.music.updatePlaybackSessionStatus(this.sessionId, status);
      if (!result.success) throw result.error;
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.pending = this.pending.then(operation).catch((error) => {
      console.warn("[radio] listen session update failed:", error);
    });
    return this.pending;
  }

  private async sync(): Promise<void> {
    if (!this.client) this.client = await this.getClient();
    const items = [...this.items];
    if (this.sessionId && this.syncedCount === items.length) return;
    const params = {
      items,
      label: this.label,
      total_items: items.length,
      total_duration_ms: this.durationMs,
    };
    if (!this.sessionId) {
      const result = await this.client.music.createPlaybackSession({
        ...params,
        session_type: "radio",
        entity_id: this.stationId,
      });
      if (!result.success) throw result.error;
      this.sessionId = result.data.id;
    } else {
      const result = await this.client.music.updatePlaybackSessionItems(this.sessionId, {
        ...params,
        id: this.sessionId,
      });
      if (!result.success) throw result.error;
    }
    this.syncedCount = items.length;
  }
}
