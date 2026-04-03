import type { WidgetFactory } from "./widget-types";

/**
 * a registry of widget factories, keyed by type string.
 * the canvas uses this to look up how to create a widget
 * when it encounters a widget entry in the canvas document.
 */
export class WidgetRegistry {
  private factories = new Map<string, WidgetFactory>();

  /** register a widget factory. throws if the type is already registered. */
  register(factory: WidgetFactory): void {
    if (this.factories.has(factory.type)) {
      throw new Error(`widget type "${factory.type}" is already registered`);
    }
    this.factories.set(factory.type, factory);
  }

  /** look up a factory by type string. returns undefined if not found. */
  get(type: string): WidgetFactory | undefined {
    return this.factories.get(type);
  }

  /** check if a type is registered. */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  /** return all registered type strings. */
  types(): string[] {
    return [...this.factories.keys()];
  }

  /** return all registered factories. */
  all(): WidgetFactory[] {
    return [...this.factories.values()];
  }
}
