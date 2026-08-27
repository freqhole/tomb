import { createSignal, Show, For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AddMediaModal } from "../src/components/modals/AddMediaModal";
import { ImportReviewModal } from "../src/components/modals/ImportReviewModal";
import {
  ImportAlbumEditorPanel,
  type ImportAlbumEdit,
} from "../src/components/import/ImportAlbumEditorPanel";
import type { ImportReviewAlbum } from "../src/components/import/ImportGroupingView";
import { Modal } from "../src/components/modals/Modal";
import { Tab, TabList, TabPanel, Tabs } from "../src/components/navigation/Tabs";

const meta = {
  title: "Components/Overlays/AddMediaModal",
  component: AddMediaModal,
  tags: ["autodocs"],
} satisfies Meta<typeof AddMediaModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    const handleMusicFilesSelected = (files: FileList) => {
      console.log(
        "music files selected:",
        Array.from(files).map((f) => f.name)
      );
      setIsOpen(false);
    };

    const handleVideoFilesSelected = (files: FileList) => {
      console.log(
        "video files selected:",
        Array.from(files).map((f) => f.name)
      );
      setIsOpen(false);
    };

    const handleMusicUrlsSubmitted = (urls: string[]) => {
      console.log("music urls submitted:", urls);
      setIsOpen(false);
    };

    const handleVideoUrlsSubmitted = (urls: string[]) => {
      console.log("video urls submitted:", urls);
      setIsOpen(false);
    };

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)] p-8">
        <button
          class="px-4 py-2 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] rounded"
          onClick={() => setIsOpen(true)}
        >
          open add media modal
        </button>

        <AddMediaModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onMusicFilesSelected={handleMusicFilesSelected}
          onVideoFilesSelected={handleVideoFilesSelected}
          onMusicUrlsSubmitted={handleMusicUrlsSubmitted}
          onVideoUrlsSubmitted={handleVideoUrlsSubmitted}
          fetchVideoEnabled
        />
      </div>
    );
  },
};

export const FilesTab: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)]">
        <AddMediaModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onMusicFilesSelected={(files) =>
            console.log(
              "music files:",
              Array.from(files).map((f) => f.name)
            )
          }
          onVideoFilesSelected={(files) =>
            console.log(
              "video files:",
              Array.from(files).map((f) => f.name)
            )
          }
        />
      </div>
    );
  },
};

export const UrlsTab: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)]">
        <AddMediaModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onMusicUrlsSubmitted={(urls) => console.log("music urls:", urls)}
        />
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// story: urls tab with video fetching enabled - shows the music/video/both
// domain toggle (no precheck configured here, so the toggle renders on the
// idle paste screen rather than after a confirm step).
// -------------------------------------------------------------------------

export const UrlsTabWithVideoToggle: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)]">
        <AddMediaModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          fetchVideoEnabled
          onMusicUrlsSubmitted={(urls) => console.log("music urls:", urls)}
          onVideoUrlsSubmitted={(urls) => console.log("video urls:", urls)}
        />
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// mock data shared by review stories
// -------------------------------------------------------------------------

const mockSessionAlbums: ImportReviewAlbum[] = [
  {
    id: "a1",
    title: "loveless",
    artist: "my bloody valentine",
    songs: [
      { id: "s1", title: "only shallow", trackNumber: 1, durationSeconds: 274 },
      { id: "s2", title: "loomer", trackNumber: 2, durationSeconds: 240 },
      { id: "s3", title: "touched", trackNumber: 3, durationSeconds: 56 },
    ],
  },
  {
    id: "a2",
    title: "lofi beats vol. 3",
    artist: "various",
    songs: [
      { id: "l1", title: "midnight study", trackNumber: 1, durationSeconds: 222 },
      { id: "l2", title: "rainy afternoon", trackNumber: 2, durationSeconds: 247 },
    ],
  },
];

function toEditState(album: ImportReviewAlbum): ImportAlbumEdit {
  return {
    title: album.title,
    artistName: album.artist ?? "",
    albumType: "album",
    artworkBlobId: null,
    artworkPreview: null,
    entityUrls: [],
    songs: album.songs.map((s) => ({
      id: s.id,
      title: s.title,
      trackNumber: s.trackNumber ?? null,
      discNumber: null,
      artistName: null,
      durationSeconds: s.durationSeconds ?? null,
    })),
  };
}

// -------------------------------------------------------------------------
// story: add media modal with a conditional "review" tab (music only)
//
// this story simulates how the review tab will look when there are pending
// sessions. the tab appears alongside "upload files" and "download urls"
// and shows the count badge. clicking "review now" opens ImportReviewModal.
// -------------------------------------------------------------------------

export const WithReviewTab: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);
    const [activeTab, setActiveTab] = createSignal("files");
    const [showReviewModal, setShowReviewModal] = createSignal(false);
    const [pendingSessions] = createSignal(mockSessionAlbums);
    const pendingCount = () => pendingSessions().length;

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)]">
        {/* standalone modal shell simulating AddMediaModal with 3 tabs */}
        <Modal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          title="add media"
          size="lg"
          scrollBody
        >
          <div class="px-4 pt-4 pb-2">
            <Tabs activeTab={activeTab()} onTabChange={setActiveTab}>
              <TabList class="justify-center">
                <Tab id="files" label="upload files" />
                <Tab id="urls" label="download urls" />
                {/* review tab only shown when there are pending sessions */}
                <Show when={pendingCount() > 0}>
                  <Tab id="review" label="review" badge={pendingCount()} />
                </Show>
              </TabList>

              <div class="py-6">
                <TabPanel id="files">
                  <div class="border-2 border-dashed border-[var(--color-border-default)] rounded-lg p-12 flex flex-col items-center justify-center text-center gap-3">
                    <p class="body-small text-[var(--color-text-secondary)]">file upload ui here</p>
                  </div>
                </TabPanel>

                <TabPanel id="urls">
                  <div class="border-2 border-dashed border-[var(--color-border-default)] rounded-lg p-12 flex flex-col items-center justify-center text-center gap-3">
                    <p class="body-small text-[var(--color-text-secondary)]">url input ui here</p>
                  </div>
                </TabPanel>

                <TabPanel id="review">
                  <div class="flex flex-col gap-3">
                    <p class="body-small text-[var(--color-text-secondary)]">
                      {pendingCount()} import session{pendingCount() !== 1 ? "s" : ""} waiting for
                      review. music is already in your library - review to fix metadata and artwork.
                    </p>

                    <For each={pendingSessions()}>
                      {(album) => (
                        <button
                          class="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] w-full text-left cursor-pointer hover:border-[var(--color-accent-400)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                          onClick={() => setShowReviewModal(true)}
                        >
                          <div class="w-10 h-10 rounded bg-[var(--color-bg-tertiary)] flex-shrink-0 flex items-center justify-center text-[var(--color-text-muted)] text-xs">
                            art
                          </div>
                          <div class="flex-1 min-w-0">
                            <p class="body-small text-[var(--color-text-primary)] truncate">
                              {album.title}
                            </p>
                            <p class="body-xs text-[var(--color-text-muted)]">
                              {album.songs.length} tracks - tap to review
                            </p>
                          </div>
                          <span class="body-xs text-amber-400 flex-shrink-0">pending</span>
                        </button>
                      )}
                    </For>
                  </div>
                </TabPanel>
              </div>
            </Tabs>
          </div>
        </Modal>

        <button
          class="fixed bottom-4 left-4 px-3 py-1.5 bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded body-xs text-[var(--color-text-secondary)]"
          onClick={() => setIsOpen(true)}
        >
          reopen modal
        </button>

        <ImportReviewModal
          isOpen={showReviewModal()}
          onClose={() => setShowReviewModal(false)}
          albums={pendingSessions()}
          onMergeAlbums={(src, tgt) => console.log("merge", src, "->", tgt)}
          onMoveSong={(sid, aid) => console.log("move", sid, "->", aid)}
          onCreateAlbumForSong={(sid, title, artist) => console.log("create album", title, artist, "for", sid)}
          onMarkReviewed={(id) => console.log("reviewed:", id)}
          onComplete={() => setShowReviewModal(false)}
          renderAlbumEditor={(editorProps) => {
            const [edit, setEdit] = createSignal<ImportAlbumEdit>(toEditState(editorProps.album));
            return <ImportAlbumEditorPanel value={edit()} onChange={setEdit} />;
          }}
        />
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// story: the standalone AddMediaModal (no review tab - no pending sessions)
// -------------------------------------------------------------------------

export const WithPendingReviewCard: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)]">
        <AddMediaModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onMusicUrlsSubmitted={(urls) => console.log("urls:", urls)}
        />
      </div>
    );
  },
};
