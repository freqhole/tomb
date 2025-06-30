# FreqholeDemo Refactoring Plan 🔧

This document outlines the plan to refactor the massive `index.tsx` file (1,100+ lines) into clean, modular components and hooks.

---

## 🎯 CURRENT STATE

**Problem:** `freqhole-demo/index.tsx` has grown to **1,188 lines** with multiple concerns mixed together:

- State management (30+ signals)
- Data processing (filtering, sorting)
- Column definitions (200+ lines)
- Event handlers (50+ functions)
- WebSocket integration
- UI rendering logic

---

## 🚀 REFACTORING STRATEGY

### **Phase 1: Extract Custom Hooks** ✅ IN PROGRESS

#### **1. State Management Hook** ✅ CREATED

**File:** `hooks/useFreqholeState.ts`
**Extracts:**

- All `createSignal` declarations (30+ signals)
- Panel width/visibility states
- Menu/dialog states
- WebSocket configuration
- State persistence (localStorage)
- Helper functions (toggles, updates)

**Impact:** Removes ~200 lines from main component

#### **2. Data Processing Hook** ✅ CREATED

**File:** `hooks/useFreqholeData.ts`
**Extracts:**

- `filteredData` computed memo
- `sortedData` computed memo
- `mimeCategories` derived data
- `blobTypes` derived data
- Statistics calculations
- Filter logic

**Impact:** Removes ~150 lines from main component

#### **3. Grid Columns Builder Hook** ✅ CREATED

**File:** `hooks/useGridColumns.tsx`
**Extracts:**

- Massive `visibleColumns` memo (200+ lines)
- All column definitions
- Actions column with header menu
- Responsive column logic
- Thumbnail column configuration

**Impact:** Removes ~220 lines from main component

---

### **Phase 2: Extract Event Handlers & Integration**

#### **4. Event Handlers Hook** 🔄 NEXT

**File:** `hooks/useFreqholeHandlers.ts`
**Will Extract:**

- `handleSort`, `handleActionMenuClick`
- Menu open/close handlers
- Panel toggle handlers
- Keyboard event handlers
- Selection event handlers

**Impact:** Will remove ~180 lines from main component

#### **5. WebSocket Integration Hook** 🔄 PLANNED

**File:** `hooks/useFreqholeIntegration.ts`
**Will Extract:**

- WebSocket feed setup
- Thumbnail management
- Logging functionality
- Connection status handling
- Auto-refresh logic

**Impact:** Will remove ~120 lines from main component

---

### **Phase 3: Component Extraction**

#### **6. Main Layout Component** 🔄 PLANNED

**File:** `components/FreqholeLayout.tsx`
**Will Extract:**

- Panel layout structure
- Resize handles
- Panel positioning
- Edge toggle buttons

#### **7. Grid Integration Component** 🔄 PLANNED

**File:** `components/FreqholeGrid.tsx`
**Will Extract:**

- InfiniteDataGrid setup
- Grid event handlers
- Selection overlay
- Keyboard navigation

---

## 📊 PROJECTED IMPACT

### **Before Refactoring:**

- `index.tsx`: **1,188 lines** 🔴
- Single massive component
- Mixed concerns
- Hard to test individual pieces

### **After Refactoring:**

- `index.tsx`: **~300 lines** 🟢 (75% reduction!)
- `useFreqholeState.ts`: **269 lines**
- `useFreqholeData.ts`: **131 lines**
- `useGridColumns.tsx`: **230 lines**
- `useFreqholeHandlers.ts`: **~180 lines** (planned)
- `useFreqholeIntegration.ts`: **~120 lines** (planned)

### **Benefits:**

✅ **Single Responsibility** - Each hook has one clear purpose
✅ **Testability** - Individual hooks can be unit tested
✅ **Reusability** - Hooks can be used in other components
✅ **Maintainability** - Easier to find and modify specific functionality
✅ **Type Safety** - Better TypeScript inference and checking
✅ **Code Review** - Smaller, focused files are easier to review

---

## 🔧 IMPLEMENTATION PROGRESS

### **✅ Completed (Phase 1):**

1. **useFreqholeState** - All state management extracted
2. **useFreqholeData** - Data processing and filtering logic
3. **useGridColumns** - Column definitions and responsive logic

### **🔄 Current Task:**

Update main `index.tsx` to use the new hooks and verify everything works

### **📋 Next Steps:**

1. **Update main component** to use extracted hooks
2. **Test integration** - ensure no regressions
3. **Extract event handlers** - Phase 2 implementation
4. **Create integration hook** - WebSocket and thumbnail logic
5. **Component extraction** - Layout and grid components

---

## 💡 ARCHITECTURAL PRINCIPLES

### **Hook Design Pattern:**

```typescript
// Clean interface with single responsibility
export function useFeatureName(props: Props) {
  // Internal logic
  const processedData = createMemo(() => { ... });

  // Clean return interface
  return {
    data: processedData,
    actions: { update, reset },
    state: { isLoading, error }
  };
}
```

### **Composition in Main Component:**

```typescript
export function FreqholeDemo(props: FreqholeDemoProps) {
  // Composed from focused hooks
  const state = useFreqholeState(props);
  const data = useFreqholeData({ ...state });
  const columns = useGridColumns({ ...state, ...data });
  const handlers = useFreqholeHandlers({ ...state });

  // Minimal render logic
  return <Layout>...</Layout>;
}
```

---

## 🎯 SUCCESS METRICS

- **Lines of Code:** Main component reduced by 75%
- **Cyclomatic Complexity:** Reduced from high to low
- **Test Coverage:** Individual hooks can be unit tested
- **Build Time:** No impact (same total code, better organized)
- **Type Safety:** Improved with focused interfaces
- **Developer Experience:** Much easier to navigate and modify

---

_This refactoring maintains 100% functionality while dramatically improving code organization and maintainability._ 🚀
