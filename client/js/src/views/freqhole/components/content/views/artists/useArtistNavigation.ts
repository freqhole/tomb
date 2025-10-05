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

    props.artists.forEach((artist) => {
      const letter = getFirstLetter(artist.artist);
      if (!groups.has(letter)) {
        groups.set(letter, []);
      }
      groups.get(letter)!.push(artist);
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

    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      if (artist) {
        const letter = getFirstLetter(artist.artist);
        if (letter === targetLetter) {
          return i;
        }
      }
    }
    return -1;
  };

  // Handle letter click
  const handleLetterClick = async (letter: string) => {
    const disabled = disabledLetters();
    if (disabled.has(letter)) {
      return;
    }

    setCurrentLetter(letter);

    const position = findLetterPosition(letter);

    if (position === -1) {
      // Letter not found in current data, need to load more
      setLoadingToLetter(letter);

      try {
        await props.onLoadAllToLetter(letter);

        // After loading, find the position again
        const newPosition = findLetterPosition(letter);
        if (newPosition !== -1) {
          scrollToPosition(newPosition);
        }
      } catch (error) {
        console.error("Failed to load artists for letter:", letter, error);
      } finally {
        setLoadingToLetter(null);
      }
    } else {
      // Letter found, scroll to it
      scrollToPosition(position);
    }

    updateDisabledLetters();
  };

  // Scroll to a specific position in the artist list
  const scrollToPosition = (position: number) => {
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
