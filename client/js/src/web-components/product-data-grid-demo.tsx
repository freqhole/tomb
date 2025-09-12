/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import { createSignal, createMemo } from "solid-js";
import {
  GenericInfiniteGrid,
  GridColumn,
} from "../components/infinite-data-grid/GenericInfiniteGrid";

console.log("🚀 Product Data Grid Demo script loading");

// Product data types
interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  sku: string;
  description: string;
  rating: number;
  inStock: boolean;
}

// Generate fake product data
function generateProductData(count: number): Product[] {
  const categories = [
    "Electronics",
    "Clothing",
    "Books",
    "Home & Garden",
    "Sports",
    "Toys",
    "Beauty",
    "Automotive",
  ];
  const adjectives = [
    "Premium",
    "Deluxe",
    "Essential",
    "Professional",
    "Classic",
    "Modern",
    "Vintage",
    "Smart",
  ];
  const nouns = [
    "Widget",
    "Gadget",
    "Tool",
    "Device",
    "Kit",
    "Set",
    "Pack",
    "Bundle",
  ];

  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `${adjectives[i % adjectives.length]} ${nouns[i % nouns.length]} ${Math.floor(i / 10) + 1}`,
    category: categories[i % categories.length],
    price: Math.round((Math.random() * 500 + 10) * 100) / 100,
    stock: Math.floor(Math.random() * 100),
    sku: `SKU-${String(i + 1).padStart(6, "0")}`,
    description: `High-quality ${nouns[i % nouns.length].toLowerCase()} with premium features and excellent performance.`,
    rating: Math.round((Math.random() * 2 + 3) * 10) / 10,
    inStock: Math.random() > 0.2, // 80% chance of being in stock
  }));
}

function ProductDataGridDemo() {
  console.log("📦 ProductDataGridDemo component created");

  // State
  const [products] = createSignal(generateProductData(5000));
  const [sortField, setSortField] = createSignal<string>("id");
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("asc");

  // Sorted data
  const sortedProducts = createMemo(() => {
    const field = sortField();
    const direction = sortDirection();
    const sorted = [...products()];

    return sorted.sort((a, b) => {
      const aVal = (a as any)[field];
      const bVal = (b as any)[field];

      let comparison = 0;
      if (aVal < bVal) comparison = -1;
      if (aVal > bVal) comparison = 1;

      return direction === "desc" ? -comparison : comparison;
    });
  });

  // Column definitions
  const columns: GridColumn<Product>[] = [
    {
      key: "id",
      title: "ID",
      width: 80,
      sortable: true,
    },
    {
      key: "sku",
      title: "SKU",
      width: 120,
      sortable: true,
      render: (item, value) => (
        <code style="font-size: 12px; background: #333; padding: 2px 4px; border-radius: 3px;">
          {value}
        </code>
      ),
    },
    {
      key: "name",
      title: "Product Name",
      sortable: true,
    },
    {
      key: "category",
      title: "Category",
      width: 120,
      sortable: true,
    },
    {
      key: "price",
      title: "Price",
      width: 100,
      sortable: true,
      render: (item, value) => (
        <span style="color: #10b981; font-weight: 600;">
          ${value.toFixed(2)}
        </span>
      ),
    },
    {
      key: "stock",
      title: "Stock",
      width: 80,
      sortable: true,
      render: (item, value) => (
        <span
          style={`color: ${value > 20 ? "#10b981" : value > 5 ? "#f59e0b" : "#ef4444"}`}
        >
          {value}
        </span>
      ),
    },
    {
      key: "rating",
      title: "Rating",
      width: 100,
      sortable: true,
      render: (item, value) => (
        <span>
          {"★".repeat(Math.floor(value))}
          {"☆".repeat(5 - Math.floor(value))}
          <span style="margin-left: 4px; font-size: 12px; color: #888;">
            {value}
          </span>
        </span>
      ),
    },
    {
      key: "inStock",
      title: "Status",
      width: 100,
      sortable: true,
      render: (item, value) => (
        <span
          class={`status-badge ${value ? "status-in-stock" : "status-out-of-stock"}`}
          style={`
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            ${
              value
                ? "background: #10b981; color: white;"
                : "background: #ef4444; color: white;"
            }
          `}
        >
          {value ? "In Stock" : "Out of Stock"}
        </span>
      ),
    },
  ];

  // Event handlers
  const handleSort = (field: string, direction: "asc" | "desc") => {
    setSortField(field);
    setSortDirection(direction);
  };

  return (
    <div class="product-data-grid-demo">
      <style>{`
        .product-data-grid-demo {
          height: 100vh;
          background: #1a1a1a;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          flex-direction: column;
        }

        .demo-header {
          background: #2a2a2a;
          padding: 20px;
          border-bottom: 1px solid #3a3a3a;
        }

        .demo-header h1 {
          margin: 0 0 8px 0;
          font-size: 24px;
          font-weight: 700;
          color: #0070f3;
        }

        .demo-header p {
          margin: 0;
          font-size: 14px;
          color: #b0b0b0;
        }

        .grid-container {
          flex: 1;
          overflow: hidden;
        }
      `}</style>

      <div class="grid-container">
        <GenericInfiniteGrid
          data={sortedProducts()}
          columns={columns}
          onSort={handleSort}
          sortField={sortField()}
          sortDirection={sortDirection()}
          rowHeight={50}
          headerHeight={60}
          theme="dark"
        />
      </div>
    </div>
  );
}

// Custom element wrapper
class ProductDataGridDemoElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    console.log("🔌 ProductDataGridDemoElement connected");
    try {
      this.dispose = render(() => <ProductDataGridDemo />, this);
      console.log("✅ Product Data Grid Demo render successful");
    } catch (error) {
      console.error("❌ Product Data Grid Demo render failed:", error);
    }
  }

  disconnectedCallback() {
    console.log("🔌 ProductDataGridDemoElement disconnected");
    if (this.dispose) {
      this.dispose();
    }
  }
}

console.log("📝 About to register product-data-grid-demo custom element");

try {
  customElements.define("product-data-grid-demo", ProductDataGridDemoElement);
  console.log(
    "✅ Product Data Grid Demo custom element registered successfully"
  );
} catch (error) {
  console.error(
    "❌ Failed to register product-data-grid-demo custom element:",
    error
  );
}

export { ProductDataGridDemo, ProductDataGridDemoElement };
