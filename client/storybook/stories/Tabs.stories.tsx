import { createSignal, For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Badge } from "../src/components/badges/Badge";
import { Button } from "../src/components/buttons/Button";
import { IconButton } from "../src/components/buttons/IconButton";
import { TextArea } from "../src/components/forms/TextArea";
import { TextInput } from "../src/components/forms/TextInput";
import { Icon } from "../src/components/icons/registry";
import {
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "../src/components/navigation/Tabs";

const meta = {
  title: "Components/Navigation/Tabs",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// basic tabs
export const BasicTabs: Story = {
  render: () => {
    const [activeTab, setActiveTab] = createSignal("metadata");

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <Tabs activeTab={activeTab()} onTabChange={setActiveTab}>
            <TabList>
              <Tab id="metadata" label="metadata" />
              <Tab id="images" label="images" />
              <Tab id="search" label="search" />
            </TabList>

            <div class="pt-6">
              <TabPanel id="metadata">
                <div class="text-[var(--color-text-secondary)]">
                  <p class="body-base mb-4">
                    edit song metadata like title, artist, album, year, and
                    genre.
                  </p>
                  <div class="p-4 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-default)]">
                    metadata form fields would go here
                  </div>
                </div>
              </TabPanel>

              <TabPanel id="images">
                <div class="text-[var(--color-text-secondary)]">
                  <p class="body-base mb-4">
                    upload or select album artwork for this song.
                  </p>
                  <div class="p-4 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-default)]">
                    image upload area would go here
                  </div>
                </div>
              </TabPanel>

              <TabPanel id="search">
                <div class="text-[var(--color-text-secondary)]">
                  <p class="body-base mb-4">
                    search for song information on musicbrainz and other
                    sources.
                  </p>
                  <div class="p-4 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-default)]">
                    search interface would go here
                  </div>
                </div>
              </TabPanel>
            </div>
          </Tabs>
        </div>
      </div>
    );
  },
};

// tabs with badges
export const TabsWithBadges: Story = {
  render: () => {
    const [activeTab, setActiveTab] = createSignal("all");

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <Tabs activeTab={activeTab()} onTabChange={setActiveTab}>
            <TabList>
              <Tab id="all" label="all songs" badge={342} />
              <Tab id="favorites" label="favorites" badge={28} />
              <Tab id="recent" label="recent" badge={12} />
              <Tab id="untagged" label="untagged" badge={5} />
            </TabList>

            <div class="pt-6">
              <TabPanel id="all">
                <div class="text-[var(--color-text-secondary)]">
                  showing all 342 songs in your library
                </div>
              </TabPanel>

              <TabPanel id="favorites">
                <div class="text-[var(--color-text-secondary)]">
                  showing your 28 favorite songs
                </div>
              </TabPanel>

              <TabPanel id="recent">
                <div class="text-[var(--color-text-secondary)]">
                  showing 12 recently played songs
                </div>
              </TabPanel>

              <TabPanel id="untagged">
                <div class="text-[var(--color-text-secondary)]">
                  showing 5 songs without tags
                </div>
              </TabPanel>
            </div>
          </Tabs>
        </div>
      </div>
    );
  },
};

// tabs with disabled state
export const TabsWithDisabled: Story = {
  render: () => {
    const [activeTab, setActiveTab] = createSignal("overview");

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <Tabs activeTab={activeTab()} onTabChange={setActiveTab}>
            <TabList>
              <Tab id="overview" label="overview" />
              <Tab id="analytics" label="analytics" />
              <Tab id="export" label="export" disabled />
              <Tab id="settings" label="settings" />
            </TabList>

            <div class="pt-6">
              <TabPanel id="overview">
                <div class="text-[var(--color-text-secondary)]">
                  overview content
                </div>
              </TabPanel>

              <TabPanel id="analytics">
                <div class="text-[var(--color-text-secondary)]">
                  analytics content
                </div>
              </TabPanel>

              <TabPanel id="export">
                <div class="text-[var(--color-text-secondary)]">
                  export content (disabled)
                </div>
              </TabPanel>

              <TabPanel id="settings">
                <div class="text-[var(--color-text-secondary)]">
                  settings content
                </div>
              </TabPanel>
            </div>
          </Tabs>

          <div class="mt-4 caption text-[var(--color-text-muted)]">
            the export tab is currently disabled
          </div>
        </div>
      </div>
    );
  },
};

// edit song modal example
export const EditSongModal: Story = {
  render: () => {
    const [activeTab, setActiveTab] = createSignal("metadata");
    const [formData, setFormData] = createSignal({
      title: "bohemian rhapsody",
      artist: "queen",
      album: "a night at the opera",
      year: "1975",
      genre: "rock, progressive rock",
    });

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-3xl mx-auto bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg overflow-hidden">
          {/* modal header */}
          <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
            <h2 class="heading-5 text-[var(--color-text-primary)]">
              edit song
            </h2>
            <IconButton icon="close" variant="ghost" aria-label="close modal" />
          </div>

          {/* persistent song info */}
          <div class="bg-[var(--color-bg-elevated)] p-4 border-b border-[var(--color-border-default)]">
            <div class="text-sm text-[var(--color-text-secondary)]">
              editing: {formData().title} - {formData().artist}
            </div>
            <div class="text-sm text-[var(--color-text-tertiary)] mt-1">
              {formData().album} • {formData().year}
            </div>
          </div>

          {/* tabs */}
          <div class="px-4 pt-4">
            <Tabs activeTab={activeTab()} onTabChange={setActiveTab}>
              <TabList>
                <Tab id="metadata" label="metadata" />
                <Tab id="images" label="images" />
                <Tab id="matches" label="musicbrainz" badge={3} />
                <Tab id="search" label="search" />
              </TabList>

              <div class="py-6">
                <TabPanel id="metadata">
                  <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                      <TextInput
                        label="title"
                        value={formData().title}
                        onInput={(e) =>
                          setFormData({
                            ...formData(),
                            title: e.currentTarget.value,
                          })
                        }
                      />
                      <TextInput
                        label="artist"
                        value={formData().artist}
                        onInput={(e) =>
                          setFormData({
                            ...formData(),
                            artist: e.currentTarget.value,
                          })
                        }
                      />
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                      <TextInput
                        label="album"
                        value={formData().album}
                        onInput={(e) =>
                          setFormData({
                            ...formData(),
                            album: e.currentTarget.value,
                          })
                        }
                      />
                      <TextInput
                        label="year"
                        type="number"
                        value={formData().year}
                        onInput={(e) =>
                          setFormData({
                            ...formData(),
                            year: e.currentTarget.value,
                          })
                        }
                      />
                    </div>

                    <TextInput
                      label="genre"
                      value={formData().genre}
                      onInput={(e) =>
                        setFormData({
                          ...formData(),
                          genre: e.currentTarget.value,
                        })
                      }
                    />
                  </div>
                </TabPanel>

                <TabPanel id="images">
                  <div class="space-y-4">
                    <div class="flex gap-4">
                      <div class="w-32 h-32 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded flex items-center justify-center">
                        <Icon
                          name="album"
                          size={48}
                          color="var(--color-text-muted)"
                        />
                      </div>
                      <div class="flex-1">
                        <p class="body-small text-[var(--color-text-secondary)] mb-4">
                          upload custom album artwork or select from search
                          results
                        </p>
                        <button
                          type="button"
                          class="px-4 py-2 bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] rounded transition-colors border border-[var(--color-border-default)]"
                        >
                          upload image
                        </button>
                      </div>
                    </div>
                  </div>
                </TabPanel>

                <TabPanel id="matches">
                  <div class="space-y-4">
                    <p class="body-small text-[var(--color-text-secondary)] mb-4">
                      found 3 matches on musicbrainz
                    </p>

                    <div class="space-y-3">
                      {[
                        {
                          title: "bohemian rhapsody",
                          artist: "queen",
                          album: "a night at the opera",
                          year: 1975,
                        },
                        {
                          title: "bohemian rhapsody",
                          artist: "queen",
                          album: "greatest hits",
                          year: 1981,
                        },
                        {
                          title: "bohemian rhapsody (remastered)",
                          artist: "queen",
                          album: "a night at the opera (deluxe edition)",
                          year: 2011,
                        },
                      ].map((match) => (
                        <div class="p-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded hover:border-[var(--color-border-strong)] transition-colors">
                          <div class="flex items-start justify-between">
                            <div class="flex-1">
                              <div class="body-small text-[var(--color-text-primary)] font-medium">
                                {match.title}
                              </div>
                              <div class="body-xs text-[var(--color-text-secondary)]">
                                {match.artist} • {match.album} ({match.year})
                              </div>
                            </div>
                            <Button variant="primary" size="sm">
                              apply
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabPanel>

                <TabPanel id="search">
                  <div class="space-y-4">
                    <TextInput
                      placeholder="search for song information..."
                      leftIcon={
                        <Icon
                          name="search"
                          size={18}
                          color="var(--color-text-muted)"
                        />
                      }
                    />
                    <div class="text-center text-[var(--color-text-tertiary)] py-8">
                      enter a search query to find song information
                    </div>
                  </div>
                </TabPanel>
              </div>
            </Tabs>
          </div>

          {/* modal footer */}
          <div class="flex gap-2 justify-end p-4 border-t border-[var(--color-border-default)]">
            <Button variant="secondary">cancel</Button>
            <Button variant="primary">save changes</Button>
          </div>
        </div>
      </div>
    );
  },
};

// add music modal example
export const AddMusicModal: Story = {
  render: () => {
    const [uploadMode, setUploadMode] = createSignal("files");

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-3xl mx-auto bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg overflow-hidden">
          {/* modal header */}
          <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
            <h2 class="heading-5 text-[var(--color-text-primary)]">
              add music
            </h2>
            <IconButton icon="close" variant="ghost" aria-label="close modal" />
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
                      supports mp3, flac, wav, m4a, ogg • max 1gb per file
                    </p>
                    <Button variant="primary">select files</Button>
                  </div>
                </TabPanel>

                <TabPanel id="urls">
                  <div class="space-y-4">
                    <div class="text-center mb-4">
                      <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">
                        download from urls
                      </h3>
                      <p class="body-small text-[var(--color-text-secondary)]">
                        enter youtube, soundcloud, or other supported urls (one
                        per line)
                      </p>
                    </div>

                    <TextArea
                      placeholder="https://www.youtube.com/watch?v=..."
                      rows={6}
                      variant="filled"
                    />

                    <div class="flex justify-center">
                      <Button variant="primary">download</Button>
                    </div>
                  </div>
                </TabPanel>
              </div>
            </Tabs>
          </div>
        </div>
      </div>
    );
  },
};

// search results with tabs
export const SearchResults: Story = {
  render: () => {
    const [activeTab, setActiveTab] = createSignal("all");

    const results = {
      songs: 12,
      albums: 5,
      artists: 3,
      playlists: 2,
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-4xl">
          <h2 class="heading-4 text-[var(--color-text-primary)] mb-6">
            search results for "pink floyd"
          </h2>

          <Tabs activeTab={activeTab()} onTabChange={setActiveTab}>
            <TabList>
              <Tab
                id="all"
                label="all"
                badge={
                  results.songs +
                  results.albums +
                  results.artists +
                  results.playlists
                }
              />
              <Tab id="songs" label="songs" badge={results.songs} />
              <Tab id="albums" label="albums" badge={results.albums} />
              <Tab id="artists" label="artists" badge={results.artists} />
              <Tab id="playlists" label="playlists" badge={results.playlists} />
            </TabList>

            <div class="pt-6">
              <TabPanel id="all">
                <div class="space-y-6">
                  <div>
                    <h3 class="heading-6 text-[var(--color-text-primary)] mb-3">
                      artists ({results.artists})
                    </h3>
                    <div class="text-[var(--color-text-secondary)]">
                      artist results would go here
                    </div>
                  </div>
                  <div>
                    <h3 class="heading-6 text-[var(--color-text-primary)] mb-3">
                      albums ({results.albums})
                    </h3>
                    <div class="text-[var(--color-text-secondary)]">
                      album results would go here
                    </div>
                  </div>
                  <div>
                    <h3 class="heading-6 text-[var(--color-text-primary)] mb-3">
                      songs ({results.songs})
                    </h3>
                    <div class="text-[var(--color-text-secondary)]">
                      song results would go here
                    </div>
                  </div>
                </div>
              </TabPanel>

              <TabPanel id="songs">
                <div class="text-[var(--color-text-secondary)]">
                  showing {results.songs} songs matching "pink floyd"
                </div>
              </TabPanel>

              <TabPanel id="albums">
                <div class="text-[var(--color-text-secondary)]">
                  showing {results.albums} albums matching "pink floyd"
                </div>
              </TabPanel>

              <TabPanel id="artists">
                <div class="text-[var(--color-text-secondary)]">
                  showing {results.artists} artists matching "pink floyd"
                </div>
              </TabPanel>

              <TabPanel id="playlists">
                <div class="text-[var(--color-text-secondary)]">
                  showing {results.playlists} playlists matching "pink floyd"
                </div>
              </TabPanel>
            </div>
          </Tabs>
        </div>
      </div>
    );
  },
};

// dynamic tabs
export const DynamicTabs: Story = {
  render: () => {
    const [activeTab, setActiveTab] = createSignal("tab-1");
    const [tabs, setTabs] = createSignal([
      { id: "tab-1", label: "tab 1" },
      { id: "tab-2", label: "tab 2" },
      { id: "tab-3", label: "tab 3" },
    ]);

    const addTab = () => {
      const newId = `tab-${tabs().length + 1}`;
      setTabs([...tabs(), { id: newId, label: `tab ${tabs().length + 1}` }]);
      setActiveTab(newId);
    };

    const removeTab = (id: string) => {
      const newTabs = tabs().filter((tab) => tab.id !== id);
      setTabs(newTabs);
      if (activeTab() === id && newTabs.length > 0) {
        setActiveTab(newTabs[0].id);
      }
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <div class="mb-4">
            <Button variant="primary" onClick={addTab}>
              add tab
            </Button>
          </div>

          <Tabs activeTab={activeTab()} onTabChange={setActiveTab}>
            <TabList>
              <For each={tabs()}>
                {(tab) => (
                  <div class="flex items-center group">
                    <Tab id={tab.id} label={tab.label} />
                    {tabs().length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTab(tab.id);
                        }}
                        class="ml-1 p-1 opacity-0 group-hover:opacity-100 hover:bg-[var(--color-bg-hover)] rounded transition-opacity"
                      >
                        <Icon
                          name="close"
                          size={14}
                          color="var(--color-text-muted)"
                        />
                      </button>
                    )}
                  </div>
                )}
              </For>
            </TabList>

            <div class="pt-6">
              <For each={tabs()}>
                {(tab) => (
                  <TabPanel id={tab.id}>
                    <div class="p-4 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-default)]">
                      <p class="body-base text-[var(--color-text-secondary)]">
                        content for {tab.label}
                      </p>
                    </div>
                  </TabPanel>
                )}
              </For>
            </div>
          </Tabs>
        </div>
      </div>
    );
  },
};
