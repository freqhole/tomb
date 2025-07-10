/* @jsxImportSource solid-js */
import { Show, For } from "solid-js";
import { CloseIcon } from "../icons";
import { QueueItem } from "../../hooks";

export interface QueueViewerProps {
  show: boolean;
  queue: QueueItem[];
  currentIndex: number;
  onClose: () => void;
  onClear: () => void;
  onJumpToIndex: (index: number) => void;
  onRemoveFromQueue: (queueId: string) => void;
}

export const QueueViewer = (props: QueueViewerProps) => {
  return (
    <Show when={props.show}>
      <div class="zune-queue">
        <div class="zune-queue-header">
          <h3>queue</h3>
          <div class="zune-queue-controls">
            <button onClick={props.onClear}>clear</button>
            <button onClick={props.onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>
        <div class="zune-queue-list">
          <For each={props.queue}>
            {(item, index) => (
              <div
                class={`zune-queue-item ${index() === props.currentIndex ? "current" : ""}`}
                onClick={() => props.onJumpToIndex(index())}
              >
                <div class="zune-queue-info">
                  <h4>{item.song.title}</h4>
                  <p>{item.song.artist}</p>
                </div>
                <button
                  class="zune-queue-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onRemoveFromQueue(item.id);
                  }}
                  title="Remove from queue"
                >
                  <CloseIcon />
                </button>
              </div>
            )}
          </For>
          <Show when={props.queue.length === 0}>
            <div class="zune-queue-empty">queue is empty</div>
          </Show>
        </div>
      </div>
    </Show>
  );
};
