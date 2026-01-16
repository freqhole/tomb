import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { IconToggle } from "../src/components/buttons/IconToggle";
import { Icon } from "../src/components/icons/registry";

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

// favorite toggle (inactive state)
export const FavoriteInactive: Story = {
  render: () => (
    <div class="p-4">
      <div class="w-10 h-10">
        <IconToggle
          active={false}
          onToggle={() => {}}
          activeIcon={<Icon name="favorite" size={16} color="currentColor" />}
          inactiveIcon={
            <Icon name="favoriteOutline" size={16} color="currentColor" />
          }
          activeTitle="remove from favorites"
          inactiveTitle="add to favorites"
        />
      </div>
    </div>
  ),
};

// favorite toggle (active state)
export const FavoriteActive: Story = {
  render: () => (
    <div class="p-4">
      <div class="w-10 h-10">
        <IconToggle
          active={true}
          onToggle={() => {}}
          activeIcon={<Icon name="favorite" size={16} color="currentColor" />}
          inactiveIcon={
            <Icon name="favoriteOutline" size={16} color="currentColor" />
          }
          activeTitle="remove from favorites"
          inactiveTitle="add to favorites"
        />
      </div>
    </div>
  ),
};

// star toggle (inactive)
export const StarInactive: Story = {
  render: () => (
    <div class="p-4">
      <div class="w-10 h-10">
        <IconToggle
          active={false}
          onToggle={() => {}}
          activeIcon={<Icon name="star" size={16} color="currentColor" />}
          inactiveIcon={
            <Icon name="starOutline" size={16} color="currentColor" />
          }
          activeTitle="unstar"
          inactiveTitle="star this item"
        />
      </div>
    </div>
  ),
};

// star toggle (active)
export const StarActive: Story = {
  render: () => (
    <div class="p-4">
      <div class="w-10 h-10">
        <IconToggle
          active={true}
          onToggle={() => {}}
          activeIcon={<Icon name="star" size={16} color="currentColor" />}
          inactiveIcon={
            <Icon name="starOutline" size={16} color="currentColor" />
          }
          activeTitle="unstar"
          inactiveTitle="star this item"
        />
      </div>
    </div>
  ),
};

// disabled state
export const Disabled: Story = {
  render: () => (
    <div class="p-4">
      <div class="w-10 h-10">
        <IconToggle
          active={false}
          disabled={true}
          onToggle={() => {}}
          activeIcon={<Icon name="favorite" size={16} color="currentColor" />}
          inactiveIcon={
            <Icon name="favoriteOutline" size={16} color="currentColor" />
          }
          activeTitle="remove from favorites"
          inactiveTitle="add to favorites"
        />
      </div>
    </div>
  ),
};

// interactive favorite toggle
export const InteractiveFavorite: Story = {
  render: () => {
    const [isFavorite, setIsFavorite] = createSignal(false);

    return (
      <div class="p-4 space-y-4 bg-[var(--color-bg-primary)]">
        <div class="text-[var(--color-text-secondary)] text-sm">
          status:{" "}
          <span class="text-[var(--color-accent-500)]">
            {isFavorite() ? "favorited ❤️" : "not favorited"}
          </span>
        </div>
        <div class="w-10 h-10">
          <IconToggle
            active={isFavorite()}
            onToggle={() => setIsFavorite(!isFavorite())}
            activeIcon={<Icon name="favorite" size={16} color="currentColor" />}
            inactiveIcon={
              <Icon name="favoriteOutline" size={16} color="currentColor" />
            }
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
      <div class="p-4 space-y-4 bg-[var(--color-bg-primary)]">
        <div class="text-[var(--color-text-secondary)] text-sm space-y-1">
          <p>
            status:{" "}
            <span class="text-[var(--color-accent-500)]">
              {isStarred() ? "starred ⭐" : "not starred"}
            </span>
          </p>
          <p>
            toggled:{" "}
            <span class="text-[var(--color-accent-500)]">{toggleCount()}</span>{" "}
            times
          </p>
        </div>
        <div class="w-10 h-10">
          <IconToggle
            active={isStarred()}
            onToggle={handleToggle}
            activeIcon={<Icon name="star" size={16} color="currentColor" />}
            inactiveIcon={
              <Icon name="starOutline" size={16} color="currentColor" />
            }
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
    const [states, setStates] = createSignal([
      false,
      false,
      false,
      false,
      false,
    ]);

    const toggle = (index: number) => {
      const newStates = [...states()];
      newStates[index] = !newStates[index];
      setStates(newStates);
    };

    return (
      <div class="p-4 space-y-4 bg-[var(--color-bg-primary)]">
        <div class="text-[var(--color-text-secondary)] text-sm">
          active count:{" "}
          <span class="text-[var(--color-accent-500)]">
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
                activeIcon={
                  <Icon name="favorite" size={16} color="currentColor" />
                }
                inactiveIcon={
                  <Icon name="favoriteOutline" size={16} color="currentColor" />
                }
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
