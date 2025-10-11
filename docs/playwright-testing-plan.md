# Advanced Playwright Testing Plan for Multiple Freqhole Applications

## Overview

This plan outlines setting up comprehensive browser testing for multiple applications that share a common freqhole library package. The focus is on type-safe, maintainable testing patterns that handle complex UI interactions while avoiding brittle query selectors.

## Multi-Application Architecture

```
freqhole-e2e-tests/
├── README.md
├── package.json
├── playwright.config.ts
├── tsconfig.json
├── .env.example
├── .gitignore
├── shared/
│   ├── types/
│   │   ├── test-ids.ts          # Type-safe test identifier system
│   │   ├── app-config.ts        # Multi-app configuration types
│   │   └── test-patterns.ts     # Shared testing pattern types
│   ├── utils/
│   │   ├── selector-helpers.ts  # Type-safe selector utilities
│   │   ├── interaction-helpers.ts # Complex interaction patterns
│   │   ├── assertion-helpers.ts # Custom assertions
│   │   └── test-data-factory.ts # Test data generation
│   ├── fixtures/
│   │   ├── base-test.ts         # Extended test fixture
│   │   └── multi-app-fixtures.ts
│   └── page-objects/
│       ├── base-page.ts         # Shared page object patterns
│       ├── infinite-grid.ts     # Complex grid interactions
│       ├── context-menu.ts      # Context menu patterns
│       └── keyboard-shortcuts.ts # Shortcut testing patterns
├── apps/
│   ├── freqhole-admin/
│   │   ├── tests/
│   │   ├── config/
│   │   └── page-objects/
│   ├── freqhole-client/
│   │   ├── tests/
│   │   ├── config/
│   │   └── page-objects/
│   └── freqhole-mobile/
│       ├── tests/
│       ├── config/
│       └── page-objects/
├── reports/
│   ├── coverage/
│   └── html-report/
└── scripts/
    ├── generate-test-ids.ts     # Auto-generate test IDs
    └── validate-test-coverage.ts # Ensure test ID coverage
```

## Type-Safe Test Identifier System

### 1. Test ID Generation & Types

```typescript
// shared/types/test-ids.ts

// Base test identifier structure
export interface TestId {
  readonly component: string;
  readonly element?: string;
  readonly variant?: string;
  readonly action?: string;
}

// Type-safe test ID builder
export class TestIdBuilder {
  constructor(private component: string) {}

  element(name: string): TestIdBuilder {
    return new TestIdBuilder(`${this.component}-${name}`);
  }

  variant(name: string): TestIdBuilder {
    return new TestIdBuilder(`${this.component}-${name}`);
  }

  action(name: string): TestIdBuilder {
    return new TestIdBuilder(`${this.component}-${name}`);
  }

  build(): string {
    return this.component;
  }
}

// Component-specific test ID generators
export const TestIds = {
  InfiniteGrid: {
    container: () => "infinite-grid",
    cell: (row: number, col: number) => `infinite-grid-cell-${row}-${col}`,
    loadingSpinner: () => "infinite-grid-loading",
    contextMenu: () => "infinite-grid-context-menu",
    header: (column: string) => `infinite-grid-header-${column}`,
    selection: () => "infinite-grid-selection",
    virtualScrollContainer: () => "infinite-grid-virtual-scroll",
  },
  ContextMenu: {
    container: () => "context-menu",
    item: (action: string) => `context-menu-${action}`,
    separator: () => "context-menu-separator",
    submenu: (name: string) => `context-menu-submenu-${name}`,
  },
  KeyboardShortcuts: {
    // These are data attributes for tracking shortcut usage
    trigger: (shortcut: string) => `keyboard-shortcut-${shortcut}`,
    handler: (action: string) => `shortcut-handler-${action}`,
  },
  Auth: {
    loginForm: () => "auth-login-form",
    usernameInput: () => "auth-username-input",
    loginButton: () => "auth-login-button",
    webAuthnPrompt: () => "auth-webauthn-prompt",
    errorMessage: () => "auth-error-message",
  },
} as const;

// Type helper for test ID validation
export type ValidTestId = ReturnType<
  (typeof TestIds)[keyof typeof TestIds][keyof (typeof TestIds)[keyof typeof TestIds]]
>;
```

### 2. Type-Safe Selector Utilities

```typescript
// shared/utils/selector-helpers.ts

import { Locator, Page } from "@playwright/test";
import { TestIds } from "../types/test-ids";

export class TypeSafeSelectors {
  constructor(private page: Page) {}

  // Get element by test ID with type safety
  getByTestId<T extends string>(testId: T): Locator {
    return this.page.getByTestId(testId);
  }

  // Infinite grid specific selectors
  infiniteGrid() {
    return {
      container: () => this.getByTestId(TestIds.InfiniteGrid.container()),
      cell: (row: number, col: number) =>
        this.getByTestId(TestIds.InfiniteGrid.cell(row, col)),
      cellInViewport: (row: number, col: number) =>
        this.getByTestId(TestIds.InfiniteGrid.cell(row, col)).and(
          this.page.locator(":in-viewport"),
        ),
      selectedCells: () =>
        this.getByTestId(TestIds.InfiniteGrid.selection()).locator(
          '[aria-selected="true"]',
        ),
      visibleCells: () =>
        this.getByTestId(TestIds.InfiniteGrid.container()).locator(
          "[data-row-index]",
        ),
    };
  }

  // Context menu selectors
  contextMenu() {
    return {
      container: () => this.getByTestId(TestIds.ContextMenu.container()),
      item: (action: string) =>
        this.getByTestId(TestIds.ContextMenu.item(action)),
      visibleMenu: () =>
        this.getByTestId(TestIds.ContextMenu.container()).and(
          this.page.locator(":visible"),
        ),
    };
  }

  // Authentication selectors
  auth() {
    return {
      loginForm: () => this.getByTestId(TestIds.Auth.loginForm()),
      usernameInput: () => this.getByTestId(TestIds.Auth.usernameInput()),
      loginButton: () => this.getByTestId(TestIds.Auth.loginButton()),
      errorMessage: () => this.getByTestId(TestIds.Auth.errorMessage()),
    };
  }
}
```

### 3. Complex Interaction Patterns

```typescript
// shared/utils/interaction-helpers.ts

import { Page, expect, Locator } from "@playwright/test";
import { TypeSafeSelectors } from "./selector-helpers";

export class ComplexInteractions {
  private selectors: TypeSafeSelectors;

  constructor(private page: Page) {
    this.selectors = new TypeSafeSelectors(page);
  }

  // Infinite scroll grid interactions
  async infiniteGridActions() {
    return {
      // Scroll to specific cell and ensure it's loaded
      scrollToCell: async (row: number, col: number) => {
        const grid = this.selectors.infiniteGrid().container();

        // Calculate scroll position
        const scrollTop = row * 50; // Assuming 50px row height
        await grid.evaluate((el, scrollTop) => {
          el.scrollTop = scrollTop;
        }, scrollTop);

        // Wait for cell to be rendered
        await this.selectors
          .infiniteGrid()
          .cell(row, col)
          .waitFor({ state: "visible" });
      },

      // Select range of cells
      selectRange: async (
        startRow: number,
        startCol: number,
        endRow: number,
        endCol: number,
      ) => {
        const startCell = this.selectors
          .infiniteGrid()
          .cell(startRow, startCol);
        const endCell = this.selectors.infiniteGrid().cell(endRow, endCol);

        // Click start cell
        await startCell.click();

        // Hold shift and click end cell
        await this.page.keyboard.down("Shift");
        await endCell.click();
        await this.page.keyboard.up("Shift");

        // Verify selection
        const selectedCells = this.selectors.infiniteGrid().selectedCells();
        const expectedCount =
          (Math.abs(endRow - startRow) + 1) * (Math.abs(endCol - startCol) + 1);
        await expect(selectedCells).toHaveCount(expectedCount);
      },

      // Test virtual scrolling performance
      testVirtualScrolling: async (scrollDistance: number = 5000) => {
        const grid = this.selectors.infiniteGrid().container();
        const startTime = Date.now();

        await grid.evaluate((el, distance) => {
          el.scrollTop = distance;
        }, scrollDistance);

        // Wait for stabilization
        await this.page.waitForTimeout(100);

        const endTime = Date.now();
        const scrollTime = endTime - startTime;

        // Assert smooth scrolling (less than 200ms)
        expect(scrollTime).toBeLessThan(200);
      },

      // Test infinite loading
      testInfiniteLoading: async () => {
        const grid = this.selectors.infiniteGrid().container();

        // Scroll to bottom
        await grid.evaluate((el) => {
          el.scrollTop = el.scrollHeight - el.clientHeight;
        });

        // Wait for loading indicator
        const loading = this.selectors.infiniteGrid().loadingSpinner();
        await loading.waitFor({ state: "visible" });

        // Wait for new content to load
        await loading.waitFor({ state: "hidden", timeout: 5000 });
      },
    };
  }

  // Keyboard shortcut testing
  async keyboardActions() {
    return {
      // Test specific shortcut
      triggerShortcut: async (shortcut: string, expectedAction: string) => {
        // Mark shortcut as triggered for tracking
        await this.page.evaluate((shortcut) => {
          document.body.setAttribute(`data-last-shortcut`, shortcut);
        }, shortcut);

        // Execute the shortcut
        const keys = shortcut.split("+");
        const modifiers = keys.slice(0, -1);
        const key = keys[keys.length - 1];

        for (const modifier of modifiers) {
          await this.page.keyboard.down(modifier);
        }
        await this.page.keyboard.press(key);
        for (const modifier of modifiers.reverse()) {
          await this.page.keyboard.up(modifier);
        }

        // Verify the action was triggered
        await expect(
          this.page.locator(`[data-shortcut-handler="${expectedAction}"]`),
        ).toBeVisible();
      },

      // Test shortcut conflicts
      testShortcutConflicts: async (
        shortcuts: Array<{ shortcut: string; expectedAction: string }>,
      ) => {
        for (const { shortcut, expectedAction } of shortcuts) {
          await this.triggerShortcut(shortcut, expectedAction);
          await this.page.waitForTimeout(100); // Debounce
        }
      },

      // Test shortcut help overlay
      showShortcutHelp: async () => {
        await this.page.keyboard.press("?");
        await expect(
          this.page.locator('[data-testid="shortcut-help-modal"]'),
        ).toBeVisible();
      },
    };
  }

  // Context menu interactions
  async contextMenuActions() {
    return {
      // Right-click to open context menu
      openContextMenu: async (targetElement: Locator) => {
        await targetElement.click({ button: "right" });
        await this.selectors
          .contextMenu()
          .visibleMenu()
          .waitFor({ state: "visible" });
      },

      // Select menu item and verify action
      selectMenuItem: async (action: string) => {
        const menuItem = this.selectors.contextMenu().item(action);
        await menuItem.click();

        // Verify menu closes
        await this.selectors
          .contextMenu()
          .container()
          .waitFor({ state: "hidden" });
      },

      // Test menu positioning
      testMenuPositioning: async (targetElement: Locator) => {
        const targetBox = await targetElement.boundingBox();
        await this.openContextMenu(targetElement);

        const menu = this.selectors.contextMenu().container();
        const menuBox = await menu.boundingBox();

        // Verify menu appears near the target
        expect(menuBox?.x).toBeGreaterThanOrEqual(targetBox?.x || 0);
        expect(menuBox?.y).toBeGreaterThanOrEqual(targetBox?.y || 0);
      },
    };
  }
}
```

### 4. Multi-Application Configuration

```typescript
// shared/types/app-config.ts

export interface AppConfig {
  name: string;
  baseUrl: string;
  buildCommand: string;
  devCommand: string;
  buildDir: string;
  testPort: number;
  features: {
    hasAuth: boolean;
    hasInfiniteGrid: boolean;
    hasRealtime: boolean;
    hasMobile: boolean;
  };
}

export const AppConfigs: Record<string, AppConfig> = {
  "freqhole-admin": {
    name: "Freqhole Admin",
    baseUrl: "http://localhost:5173",
    buildCommand: "npm run build:admin",
    devCommand: "npm run dev:admin",
    buildDir: "dist/admin",
    testPort: 5173,
    features: {
      hasAuth: true,
      hasInfiniteGrid: true,
      hasRealtime: true,
      hasMobile: false,
    },
  },
  "freqhole-client": {
    name: "Freqhole Client",
    baseUrl: "http://localhost:5174",
    buildCommand: "npm run build:client",
    devCommand: "npm run dev:client",
    buildDir: "dist/client",
    testPort: 5174,
    features: {
      hasAuth: true,
      hasInfiniteGrid: true,
      hasRealtime: true,
      hasMobile: true,
    },
  },
  "freqhole-mobile": {
    name: "Freqhole Mobile",
    baseUrl: "http://localhost:5175",
    buildCommand: "npm run build:mobile",
    devCommand: "npm run dev:mobile",
    buildDir: "dist/mobile",
    testPort: 5175,
    features: {
      hasAuth: true,
      hasInfiniteGrid: false,
      hasRealtime: true,
      hasMobile: true,
    },
  },
};
```

### 5. Extended Test Fixtures

```typescript
// shared/fixtures/base-test.ts

import { test as base, Page } from "@playwright/test";
import { TypeSafeSelectors } from "../utils/selector-helpers";
import { ComplexInteractions } from "../utils/interaction-helpers";
import { AppConfig, AppConfigs } from "../types/app-config";

interface TestFixtures {
  selectors: TypeSafeSelectors;
  interactions: ComplexInteractions;
  appConfig: AppConfig;
}

export const test = base.extend<TestFixtures>({
  selectors: async ({ page }, use) => {
    await use(new TypeSafeSelectors(page));
  },

  interactions: async ({ page }, use) => {
    await use(new ComplexInteractions(page));
  },

  appConfig: async ({}, use, testInfo) => {
    // Determine app from test file path
    const appName = testInfo.file.includes("/freqhole-admin/")
      ? "freqhole-admin"
      : testInfo.file.includes("/freqhole-client/")
        ? "freqhole-client"
        : testInfo.file.includes("/freqhole-mobile/")
          ? "freqhole-mobile"
          : "freqhole-client"; // default

    await use(AppConfigs[appName]);
  },
});

export { expect } from "@playwright/test";
```

### 6. Complex Test Examples

```typescript
// apps/freqhole-admin/tests/infinite-grid.spec.ts

import { test, expect } from "../../../shared/fixtures/base-test";

test.describe("Infinite Grid Component", () => {
  test.beforeEach(async ({ page, appConfig }) => {
    await page.goto(`${appConfig.baseUrl}/#/dashboard`);
    await page.waitForLoadState("networkidle");
  });

  test("should handle complex selection patterns", async ({
    interactions,
    selectors,
  }) => {
    const gridActions = await interactions.infiniteGridActions();

    // Test multi-selection with Ctrl+Click
    await gridActions.scrollToCell(0, 0);
    await selectors.infiniteGrid().cell(0, 0).click();

    // Hold Ctrl and click multiple cells
    await page.keyboard.down("Control");
    await selectors.infiniteGrid().cell(0, 2).click();
    await selectors.infiniteGrid().cell(2, 0).click();
    await page.keyboard.up("Control");

    // Verify selection count
    await expect(selectors.infiniteGrid().selectedCells()).toHaveCount(3);

    // Test range selection
    await gridActions.selectRange(5, 5, 8, 8);
    await expect(selectors.infiniteGrid().selectedCells()).toHaveCount(16); // 4x4 selection
  });

  test("should handle keyboard navigation", async ({
    page,
    interactions,
    selectors,
  }) => {
    const keyboardActions = await interactions.keyboardActions();

    // Focus first cell
    await selectors.infiniteGrid().cell(0, 0).click();

    // Test arrow key navigation
    await page.keyboard.press("ArrowRight");
    await expect(selectors.infiniteGrid().cell(0, 1)).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(selectors.infiniteGrid().cell(1, 1)).toBeFocused();

    // Test keyboard shortcuts within grid context
    await keyboardActions.triggerShortcut("Ctrl+A", "select-all");
    await expect(
      selectors.infiniteGrid().selectedCells(),
    ).toHaveCountGreaterThan(100);
  });

  test("should open context menu with proper actions", async ({
    interactions,
    selectors,
  }) => {
    const contextActions = await interactions.contextMenuActions();
    const gridActions = await interactions.infiniteGridActions();

    // Select some cells first
    await gridActions.selectRange(2, 2, 4, 4);

    // Open context menu on selection
    const selectedCell = selectors.infiniteGrid().cell(3, 3);
    await contextActions.openContextMenu(selectedCell);

    // Verify context-appropriate menu items
    await expect(selectors.contextMenu().item("copy")).toBeVisible();
    await expect(selectors.contextMenu().item("delete")).toBeVisible();
    await expect(
      selectors.contextMenu().item("export-selection"),
    ).toBeVisible();

    // Test menu action
    await contextActions.selectMenuItem("copy");

    // Verify clipboard content (if possible in test environment)
    // Note: Real clipboard testing may need additional setup
  });

  test("should handle infinite scrolling performance", async ({
    interactions,
  }) => {
    const gridActions = await interactions.infiniteGridActions();

    // Test scrolling to various positions
    await gridActions.scrollToCell(100, 0);
    await gridActions.scrollToCell(500, 0);
    await gridActions.scrollToCell(1000, 0);

    // Test virtual scrolling performance
    await gridActions.testVirtualScrolling(10000);

    // Test infinite loading
    await gridActions.testInfiniteLoading();
  });
});
```

### 7. Multi-App Playwright Configuration

```typescript
// playwright.config.ts

import { defineConfig, devices } from "@playwright/test";
import { AppConfigs } from "./shared/types/app-config";

export default defineConfig({
  testDir: "./apps",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ["html", { outputFolder: "reports/html-report" }],
    ["json", { outputFile: "reports/results.json" }],
    ["junit", { outputFile: "reports/results.xml" }],
  ],

  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Admin App Tests
    {
      name: "freqhole-admin-chromium",
      testDir: "./apps/freqhole-admin",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: AppConfigs["freqhole-admin"].baseUrl,
      },
    },
    {
      name: "freqhole-admin-firefox",
      testDir: "./apps/freqhole-admin",
      use: {
        ...devices["Desktop Firefox"],
        baseURL: AppConfigs["freqhole-admin"].baseUrl,
      },
    },

    // Client App Tests
    {
      name: "freqhole-client-chromium",
      testDir: "./apps/freqhole-client",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: AppConfigs["freqhole-client"].baseUrl,
      },
    },
    {
      name: "freqhole-client-mobile",
      testDir: "./apps/freqhole-client",
      use: {
        ...devices["Pixel 5"],
        baseURL: AppConfigs["freqhole-client"].baseUrl,
      },
    },

    // Mobile App Tests
    {
      name: "freqhole-mobile-android",
      testDir: "./apps/freqhole-mobile",
      use: {
        ...devices["Pixel 5"],
        baseURL: AppConfigs["freqhole-mobile"].baseUrl,
      },
    },
    {
      name: "freqhole-mobile-ios",
      testDir: "./apps/freqhole-mobile",
      use: {
        ...devices["iPhone 12"],
        baseURL: AppConfigs["freqhole-mobile"].baseUrl,
      },
    },
  ],

  webServer: [
    {
      command: AppConfigs["freqhole-admin"].devCommand,
      url: AppConfigs["freqhole-admin"].baseUrl,
      reuseExistingServer: !process.env.CI,
      cwd: "../tomb/client/js",
    },
    {
      command: AppConfigs["freqhole-client"].devCommand,
      url: AppConfigs["freqhole-client"].baseUrl,
      reuseExistingServer: !process.env.CI,
      cwd: "../tomb/client/js",
    },
    {
      command: AppConfigs["freqhole-mobile"].devCommand,
      url: AppConfigs["freqhole-mobile"].baseUrl,
      reuseExistingServer: !process.env.CI,
      cwd: "../tomb/client/js",
    },
  ],
});
```

### 8. Integration with Your Solid.js Components

To make this work seamlessly with your existing code, you'd add test IDs like this:

```typescript
// In your Solid.js components
import { TestIds } from '@freqhole/test-ids'; // From shared library

// Infinite Grid Component
export function InfiniteGrid() {
  return (
    <div data-testid={TestIds.InfiniteGrid.container()}>
      <div data-testid={TestIds.InfiniteGrid.virtualScrollContainer()}>
        <For each={visibleRows()}>
          {(row, rowIndex) => (
            <For each={row.cells}>
              {(cell, colIndex) => (
                <div
                  data-testid={TestIds.InfiniteGrid.cell(rowIndex(), colIndex())}
                  data-row-index={rowIndex()}
                  data-col-index={colIndex()}
                  class="grid-cell"
                  onContextMenu={handleContextMenu}
                >
                  {cell.content}
                </div>
              )}
            </For>
          )}
        </For>
      </div>
      <Show when={loading()}>
        <div data-testid={TestIds.InfiniteGrid.loadingSpinner()}>
          Loading...
        </div>
      </Show>
    </div>
  );
}

// Context Menu Component
export function ContextMenu(props: {actions: ContextAction[]}) {
  return (
    <div data-testid={TestIds.ContextMenu.container()}>
      <For each={props.actions}>
        {(action) => (
          <button
            data-testid={TestIds.ContextMenu.item(action.id)}
            onClick={() => action.handler()}
          >
            {action.label}
          </button>
        )}
      </For>
    </div>
  );
}
```

### 9. Auto-Generated Test IDs (Optional)

```typescript
// scripts/generate-test-ids.ts

// This script could analyze your components and generate test IDs
// Run this as part of your build process to ensure consistency

import * as fs from "fs";
import * as path from "path";

function generateTestIds() {
  const components = scanComponents("./src/views/freqhole");
  const testIds = generateTestIdTypes(components);

  fs.writeFileSync(
    path.join(__dirname, "../shared/types/generated-test-ids.ts"),
    testIds,
  );
}

function scanComponents(dir: string): ComponentInfo[] {
  // Scan your .tsx files and extract component names and elements
  // This would use TypeScript AST parsing
  return [];
}

if (require.main === module) {
  generateTestIds();
}
```

## Benefits of This Approach

1. **Type Safety**: Full TypeScript support for test selectors with autocomplete and error checking
2. **Maintainability**: Centralized test ID management with type-safe helpers
3. **Multi-App Support**: Clean separation between different applications while sharing common patterns
4. **Complex Interactions**: Built-in support for infinite scroll, keyboard shortcuts, context menus
5. **No Query Selector Brittleness**: All selectors are based on semantic test IDs
6. **Minimal Code Pollution**: Test IDs are generated from a central system, minimal impact on component code
7. **Coverage Tracking**: Can track which test IDs are actually used in tests
8. **IDE Support**: Full IntelliSense and refactoring support for test identifiers

This architecture gives you clean separation between apps, type-safe testing patterns, and sophisticated interaction testing without brittle query selectors!
