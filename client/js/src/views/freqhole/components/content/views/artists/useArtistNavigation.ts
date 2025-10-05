import { createSignal, createMemo } from "solid-js";
import type { ArtistSummary } from "../../../../../../lib/music/schemas";

// Normalize accented characters and get first letter
const getFirstLetter = (name: string): string => {
  if (!name) return "#";

  // Normalize accented characters
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .toLowerCase();

  const firstChar = normalized.charAt(0);

  // Check if it's A-Z
  if (firstChar >= "a" && firstChar <= "z") {
    return firstChar.toUpperCase();
  }

  // Everything else goes to #
  return "#";
};

interface UseArtistNavigationProps {
  artists: ArtistSummary[];
  onLoadAllToLetter: (targetLetter: string) => Promise<void>;
  getLatestArtists: () => ArtistSummary[];
}

export function useArtistNavigation(props: UseArtistNavigationProps) {
  const [currentLetter, setCurrentLetter] = createSignal<string | null>(null);
  const [loadingToLetter, setLoadingToLetter] = createSignal<string | null>(
    null
  );
  const [disabledLetters, setDisabledLetters] = createSignal<Set<string>>(
    new Set()
  );

  // Group artists by letter for easy lookup
  const artistsByLetter = createMemo(() => {
    const groups = new Map<string, ArtistSummary[]>();

    console.log(
      "🎵 Grouping artists by letter. Total artists:",
      props.artists.length
    );

    props.artists.forEach((artist, index) => {
      const letter = getFirstLetter(artist.artist);
      if (index < 5) {
        console.log(`🔤 Artist "${artist.artist}" → letter "${letter}"`);
      }
      if (!groups.has(letter)) {
        groups.set(letter, []);
      }
      groups.get(letter)!.push(artist);
    });

    console.log("📊 Letters found:", Array.from(groups.keys()).sort());
    groups.forEach((artists, letter) => {
      console.log(`📝 Letter ${letter}: ${artists.length} artists`);
    });

    return groups;
  });

  // Update disabled letters based on what we've loaded so far
  const updateDisabledLetters = () => {
    const loadedLetters = new Set(artistsByLetter().keys());
    const allLetters = [
      "#",
      ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
    ];

    // Only disable letters if we've loaded all artists (or at least attempted to load to that letter)
    const newDisabled = new Set<string>();

    allLetters.forEach((letter) => {
      if (!loadedLetters.has(letter)) {
        // Only disable if we've tried to load past this letter
        const currentArtists = props.artists;
        if (currentArtists.length > 0) {
          const lastArtist = currentArtists[currentArtists.length - 1];
          if (lastArtist) {
            const lastLetter = getFirstLetter(lastArtist.artist);

            // If we've loaded past this letter alphabetically and it's still not present
            if (letter !== "#" && letter < lastLetter) {
              newDisabled.add(letter);
            } else if (letter === "#" && lastLetter >= "A") {
              newDisabled.add(letter);
            }
          }
        }
      }
    });

    setDisabledLetters(newDisabled);
  };

  // Find the position of the first artist with the given letter
  const findLetterPosition = (targetLetter: string): number => {
    const artists = props.getLatestArtists();
    console.log(
      `🔍 findLetterPosition: Looking for "${targetLetter}" in ${artists.length} artists`
    );

    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      if (artist) {
        const letter = getFirstLetter(artist.artist);
        if (i < 5 || letter === targetLetter) {
          console.log(
            `🔍 Artist ${i}: "${artist.artist}" → letter "${letter}"`
          );
        }
        if (letter === targetLetter) {
          console.log(
            `✅ Found first ${targetLetter} artist at position ${i}: "${artist.artist}"`
          );
          return i;
        }
      }
    }
    console.log(
      `❌ No ${targetLetter} artists found in ${artists.length} artists`
    );
    return -1;
  };

  // Handle letter click
  const handleLetterClick = async (letter: string) => {
    console.log("🔤 Letter clicked:", letter);

    const disabled = disabledLetters();
    if (disabled.has(letter)) {
      console.log("❌ Letter is disabled:", letter);
      return;
    }

    setCurrentLetter(letter);

    const position = findLetterPosition(letter);
    console.log("📍 Found position for letter", letter, ":", position);

    if (position === -1) {
      // Letter not found in current data, need to load more
      console.log("🔄 Loading more artists to find letter:", letter);
      setLoadingToLetter(letter);

      try {
        await props.onLoadAllToLetter(letter);

        // After loading, find the position again
        console.log(
          `🔄 After loading, total artists available: ${props.getLatestArtists().length}`
        );
        const newPosition = findLetterPosition(letter);
        console.log("📍 After loading, position for", letter, ":", newPosition);
        if (newPosition !== -1) {
          scrollToPosition(newPosition);
        } else {
          console.log(
            `❌ Still couldn't find ${letter} after loading. Last few artists:`,
            props
              .getLatestArtists()
              .slice(-5)
              .map((a) => `"${a.artist}" → ${getFirstLetter(a.artist)}`)
          );
        }
      } catch (error) {
        console.error("Failed to load artists for letter:", letter, error);
      } finally {
        setLoadingToLetter(null);
      }
    } else {
      // Letter found, scroll to it
      console.log("📜 Scrolling to position:", position);
      scrollToPosition(position);
    }

    updateDisabledLetters();
  };

  // Scroll to a specific position in the artist list
  const scrollToPosition = (position: number) => {
    console.log("🎯 Dispatching scroll event for position:", position);
    // This will be implemented by the consuming component
    // We'll emit an event or use a callback
    const event = new CustomEvent("artistNavigation:scrollTo", {
      detail: { position },
    });
    window.dispatchEvent(event);
  };

  // Get current letter based on scroll position
  const updateCurrentLetterFromPosition = (position: number) => {
    const artists = props.getLatestArtists();
    if (position >= 0 && position < artists.length) {
      const artist = artists[position];
      if (artist) {
        const letter = getFirstLetter(artist.artist);
        setCurrentLetter(letter);
      }
    }
  };

  // Update disabled letters when artists change
  createMemo(() => {
    updateDisabledLetters();
  });

  return {
    currentLetter,
    loadingToLetter,
    disabledLetters,
    artistsByLetter,
    handleLetterClick,
    updateCurrentLetterFromPosition,
    findLetterPosition,
  };
}
