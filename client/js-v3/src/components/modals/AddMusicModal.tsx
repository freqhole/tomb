import { Show, createSignal } from "solid-js";
import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { TextArea } from "../forms/TextArea";
import { Icon } from "../icons/registry";
import { Tab, TabList, TabPanel, Tabs } from "../navigation/Tabs";

export interface AddMusicModalProps {
  /** whether modal is open */
  isOpen: boolean;
  /** callback when close button clicked */
  onClose: () => void;
  /** callback when files are selected */
  onFilesSelected?: (files: FileList) => void;
  /** callback when urls are submitted */
  onUrlsSubmitted?: (urls: string[]) => void;
  /** additional classes */
  class?: string;
}

export function AddMusicModal(props: AddMusicModalProps) {
  const [uploadMode, setUploadMode] = createSignal("files");
  const [urlText, setUrlText] = createSignal("");
  let fileInputRef: HTMLInputElement | undefined;

  const handleSelectFiles = () => {
    fileInputRef?.click();
  };

  const handleFileChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      props.onFilesSelected?.(target.files);
      target.value = ""; // reset input
    }
  };

  const handleDownloadUrls = () => {
    const text = urlText().trim();
    if (!text) return;

    const urls = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (urls.length > 0) {
      props.onUrlsSubmitted?.(urls);
      setUrlText(""); // reset textarea
    }
  };

  return (
    <Show when={props.isOpen}>
      {/* overlay */}
      <div
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-8"
        onClick={props.onClose}
      >
        {/* modal content */}
        <div
          class={`max-w-3xl w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg overflow-hidden ${props.class || ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* modal header */}
          <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
            <h2 class="heading-5 text-[var(--color-text-primary)]">
              add music
            </h2>
            <IconButton
              icon="close"
              variant="ghost"
              aria-label="close modal"
              onClick={props.onClose}
            />
          </div>

          {/* tabs */}
          <div class="px-4 pt-4">
            <Tabs activeTab={uploadMode()} onTabChange={setUploadMode}>
              <TabList class="justify-center">
                <Tab id="files" label="upload files" />
                <Tab id="urls" label="download urls" />
              </TabList>

              <div class="py-6">
                <TabPanel id="files">
                  <div class="border-2 border-dashed border-[var(--color-border-default)] rounded-lg p-12 text-center">
                    <div class="mx-auto mb-4">
                      <Icon
                        name="music"
                        size={48}
                        color="var(--color-text-muted)"
                      />
                    </div>
                    <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">
                      add music files
                    </h3>
                    <p class="body-small text-[var(--color-text-secondary)] mb-2">
                      drag audio files here or click to select
                    </p>
                    <p class="body-xs text-[var(--color-text-tertiary)] mb-4">
                      supports mp3, flac, wav, m4a, ogg
                    </p>
                    <Button variant="primary" onClick={handleSelectFiles}>
                      select files
                    </Button>

                    {/* hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*,.mp3,.flac,.wav,.m4a,.ogg"
                      multiple
                      class="hidden"
                      onChange={handleFileChange}
                    />
                  </div>
                </TabPanel>

                <TabPanel id="urls">
                  <div class="space-y-4">
                    <div class="text-center mb-4">
                      <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">
                        download from urls
                      </h3>
                      <p class="body-small text-[var(--color-text-secondary)]">
                        paste audio file urls (one per line)
                      </p>
                    </div>

                    <TextArea
                      value={urlText()}
                      onInput={(e) => setUrlText(e.currentTarget.value)}
                      placeholder="https://example.com/song.mp3"
                      rows={6}
                      variant="filled"
                    />

                    <div class="flex justify-center">
                      <Button
                        variant="primary"
                        onClick={handleDownloadUrls}
                        disabled={!urlText().trim()}
                      >
                        download
                      </Button>
                    </div>
                  </div>
                </TabPanel>
              </div>
            </Tabs>
          </div>
        </div>
      </div>
    </Show>
  );
}
