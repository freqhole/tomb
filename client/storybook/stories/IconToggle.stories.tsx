import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { IconToggle } from "../src/components/buttons/IconToggle";

const meta = {
  title: "Components/IconToggle",
  component: IconToggle,
  tags: ["autodocs"],
  argTypes: {
    active: {
      control: "boolean",
      description: "current toggle state",
    },
    disabled: {
      control: "boolean",
      description: "whether the button is disabled",
    },
  },
} satisfies Meta<typeof IconToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

// heart icon svg elements
const HeartFilled = (
  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);

const HeartOutline = (
  <svg
    class="w-4 h-4"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

// star icon svg elements
const StarFilled = (
  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const StarOutline = (
  <svg
    class="w-4 h-4"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
  >
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

// favorite toggle (inactive state)
export const FavoriteInactive: Story = {
  args: {
    active: false,
    activeIcon: HeartFilled,
    inactiveIcon: HeartOutline,
    activeTitle: "remove from favorites",
    inactiveTitle: "add to favorites",
  },
};

// favorite toggle (active state)
export const FavoriteActive: Story = {
  args: {
    active: true,
    activeIcon: HeartFilled,
    inactiveIcon: HeartOutline,
    activeTitle: "remove from favorites",
    inactiveTitle: "add to favorites",
  },
};

// star toggle (inactive)
export const StarInactive: Story = {
  args: {
    active: false,
    activeIcon: StarFilled,
    inactiveIcon: StarOutline,
    activeTitle: "unstar",
    inactiveTitle: "star this item",
  },
};

// star toggle (active)
export const StarActive: Story = {
  args: {
    active: true,
    activeIcon: StarFilled,
    inactiveIcon: StarOutline,
    activeTitle: "unstar",
    inactiveTitle: "star this item",
  },
};

// disabled state
export const Disabled: Story = {
  args: {
    active: false,
    disabled: true,
    activeIcon: HeartFilled,
    inactiveIcon: HeartOutline,
    activeTitle: "remove from favorites",
    inactiveTitle: "add to favorites",
  },
};

// interactive favorite toggle
export const InteractiveFavorite: Story = {
  render: () => {
    const [isFavorite, setIsFavorite] = createSignal(false);

    return (
      <div class="p-4 space-y-4">
        <div class="text-gray-300 text-sm">
          status:{" "}
          <span class="text-magenta-400">
            {isFavorite() ? "favorited ❤️" : "not favorited"}
          </span>
        </div>
        <div class="w-10 h-10">
          <IconToggle
            active={isFavorite()}
            onToggle={() => setIsFavorite(!isFavorite())}
            activeIcon={HeartFilled}
            inactiveIcon={HeartOutline}
            activeTitle="remove from favorites"
            inactiveTitle="add to favorites"
          />
        </div>
      </div>
    );
  },
};

// interactive star toggle with counter
export const InteractiveStar: Story = {
  render: () => {
    const [isStarred, setIsStarred] = createSignal(false);
    const [toggleCount, setToggleCount] = createSignal(0);

    const handleToggle = () => {
      setIsStarred(!isStarred());
      setToggleCount(toggleCount() + 1);
    };

    return (
      <div class="p-4 space-y-4">
        <div class="text-gray-300 text-sm space-y-1">
          <p>
            status:{" "}
            <span class="text-magenta-400">
              {isStarred() ? "starred ⭐" : "not starred"}
            </span>
          </p>
          <p>
            toggled: <span class="text-magenta-400">{toggleCount()}</span> times
          </p>
        </div>
        <div class="w-10 h-10">
          <IconToggle
            active={isStarred()}
            onToggle={handleToggle}
            activeIcon={StarFilled}
            inactiveIcon={StarOutline}
            activeTitle="unstar"
            inactiveTitle="star this item"
          />
        </div>
      </div>
    );
  },
};

// multiple toggles in a row
export const MultipleToggles: Story = {
  render: () => {
    const [states, setStates] = createSignal([false, false, false, false, false]);

    const toggle = (index: number) => {
      const newStates = [...states()];
      newStates[index] = !newStates[index];
      setStates(newStates);
    };

    return (
      <div class="p-4 space-y-4">
        <div class="text-gray-300 text-sm">
          active count:{" "}
          <span class="text-magenta-400">
            {states().filter(Boolean).length}
          </span>{" "}
          / {states().length}
        </div>
        <div class="flex gap-2">
          {states().map((active, i) => (
            <div class="w-10 h-10">
              <IconToggle
                active={active}
                onToggle={() => toggle(i)}
                activeIcon={HeartFilled}
                inactiveIcon={HeartOutline}
                activeTitle="remove from favorites"
                inactiveTitle="add to favorites"
              />
            </div>
          ))}
        </div>
      </div>
    );
  },
};
