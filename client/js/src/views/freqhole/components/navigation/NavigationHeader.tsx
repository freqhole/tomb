import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal } from "solid-js";
import { storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";

export function NavigationHeader() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const events = useGlobalEvents();
  const [query, setQuery] = createSignal((searchParams.q as string) || "");

  const handleSearch = (searchQuery: string) => {
    setQuery(searchQuery);
    storeActions.setSearchQuery(searchQuery);

    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
      events.emit("search:query", { query: searchQuery });
    } else {
      storeActions.clearSearch();
      events.emit("search:clear", {});
      navigate("/songs");
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      const target = e.target as HTMLInputElement;
      handleSearch(target.value);
    }
  };

  return (
    <div class="p-4">
      <div class="mb-4">
        <h1 class="text-xl font-bold text-white lowercase">
          freq<span class="text-magenta-500">h</span>ole
        </h1>
      </div>

      <div class="relative">
        <input
          type="text"
          placeholder="search music..."
          value={query()}
          onInput={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          class="w-full px-3 py-2 bg-gray-800 text-white rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:bg-gray-700 hover:bg-gray-700 transition-all duration-200"
        />

        <button
          onClick={() => handleSearch(query())}
          class="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-magenta-400 transition-colors duration-200"
        >
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
