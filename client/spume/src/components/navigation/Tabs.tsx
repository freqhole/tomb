import type { JSX, ParentComponent } from "solid-js";
import { createContext, splitProps, useContext } from "solid-js";
import { Badge } from "../badges/Badge";

export interface Tab {
  id: string;
  label: string;
  badge?: string | number;
  disabled?: boolean;
}

interface TabsContextValue {
  activeTab: () => string;
  setActiveTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue>();

export interface TabsProps {
  activeTab: string;
  onTabChange: (id: string) => void;
  class?: string;
}

interface TabListProps {
  class?: string;
  children: JSX.Element;
}

interface TabProps {
  id: string;
  label: string;
  badge?: string | number;
  disabled?: boolean;
  class?: string;
}

interface TabPanelProps {
  id: string;
  class?: string;
  children: JSX.Element;
}

// tabs container component - provides context
export const Tabs: ParentComponent<TabsProps> = (props) => {
  const [local, rest] = splitProps(props, ["activeTab", "onTabChange", "class", "children"]);

  const contextValue: TabsContextValue = {
    activeTab: () => local.activeTab,
    setActiveTab: (id: string) => local.onTabChange(id),
  };

  return (
    <TabsContext.Provider value={contextValue}>
      <div class={local.class || ""} {...rest}>
        {local.children}
      </div>
    </TabsContext.Provider>
  );
};

// tab list component - renders the tab buttons
export const TabList: ParentComponent<TabListProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  return (
    <div role="tablist" class={`flex ${local.class || ""}`} {...rest}>
      {local.children}
    </div>
  );
};

// individual tab button
export function Tab(props: TabProps) {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tab must be used within a Tabs component");
  }

  const [local, rest] = splitProps(props, ["id", "label", "badge", "disabled", "class"]);

  const isActive = () => context.activeTab() === local.id;

  const handleClick = () => {
    if (!local.disabled) {
      context.setActiveTab(local.id);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (local.disabled) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      context.setActiveTab(local.id);
    }
  };

  return (
    <button
      role="tab"
      aria-selected={isActive()}
      aria-controls={`panel-${local.id}`}
      id={`tab-${local.id}`}
      tabIndex={isActive() ? 0 : -1}
      disabled={local.disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      classList={{
        "px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2": true,
        "text-[var(--color-accent-500)] border-b-2 border-[var(--color-accent-500)] -mb-[2px]":
          isActive(),
        "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]": !isActive(),
        "opacity-50 cursor-not-allowed": local.disabled,
        "cursor-pointer": !local.disabled,
        [local.class || ""]: true,
      }}
      {...rest}
    >
      <span>{local.label}</span>
      {local.badge !== undefined && (
        <Badge variant={isActive() ? "accent" : "default"} size="sm">
          {local.badge}
        </Badge>
      )}
    </button>
  );
}

// tab panel - content area for each tab
export const TabPanel: ParentComponent<TabPanelProps> = (props) => {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("TabPanel must be used within a Tabs component");
  }

  const [local, rest] = splitProps(props, ["id", "class", "children"]);

  const isActive = () => context.activeTab() === local.id;

  return (
    <div
      role="tabpanel"
      id={`panel-${local.id}`}
      aria-labelledby={`tab-${local.id}`}
      hidden={!isActive()}
      class={local.class || ""}
      {...rest}
    >
      {local.children}
    </div>
  );
};
