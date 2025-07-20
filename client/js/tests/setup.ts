import { expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

// Add jest-dom matchers to vitest expect
expect.extend(matchers);

// Type declarations for jest-dom matchers
declare module "vitest" {
  interface Assertion<T = any> extends jest.Matchers<void, T> {
    toBeInTheDocument(): T;
    toHaveTextContent(text: string | RegExp): T;
    toHaveValue(value: string | string[] | number): T;
    toBeVisible(): T;
    toBeDisabled(): T;
    toBeEnabled(): T;
    toHaveClass(...classNames: string[]): T;
    toHaveAttribute(attr: string, value?: string): T;
    toBeChecked(): T;
    toBeEmptyDOMElement(): T;
    toHaveFocus(): T;
    toBeInvalid(): T;
    toBeValid(): T;
    toHaveDisplayValue(value: string | RegExp | string[] | RegExp[]): T;
    toHaveStyle(css: string | Record<string, any>): T;
  }
}
