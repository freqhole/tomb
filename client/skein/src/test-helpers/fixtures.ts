import { z } from "zod";

/**
 * create a valid instance of any Zod schema using its defaults.
 * override specific fields with the `overrides` parameter.
 *
 * this is the primary way to create test data in skein tests.
 * since every widget schema uses .default() on every field,
 * fixture(schema) always produces a valid instance with zero effort.
 */
export function fixture<S extends z.ZodType>(
  schema: S,
  overrides: Partial<z.infer<S>> = {},
): z.infer<S> {
  const base = getMinimalValid(schema);
  return schema.parse({ ...base, ...overrides });
}

/**
 * create N valid instances of a schema, each with an auto-incrementing index
 * available via the overrides callback.
 */
export function fixtureList<S extends z.ZodType>(
  schema: S,
  count: number,
  overrides?: (index: number) => Partial<z.infer<S>>,
): z.infer<S>[] {
  return Array.from({ length: count }, (_, i) =>
    fixture(schema, overrides?.(i) ?? {}),
  );
}

/**
 * produce a minimal valid object for a Zod schema by walking its shape
 * and using default values or minimal valid values for each field.
 */
function getMinimalValid(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<any>).shape;
    const result: Record<string, unknown> = {};
    for (const [key, fieldSchema] of Object.entries(shape)) {
      result[key] = getMinimalFieldValue(fieldSchema as z.ZodType);
    }
    return result;
  }
  return {};
}

function getMinimalFieldValue(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodDefault) return undefined; // let zod fill the default
  if (schema instanceof z.ZodOptional) return undefined;
  if (schema instanceof z.ZodNullable) return null;
  if (schema instanceof z.ZodString) return "";
  if (schema instanceof z.ZodNumber) return 0;
  if (schema instanceof z.ZodBoolean) return false;
  if (schema instanceof z.ZodArray) return [];
  if (schema instanceof z.ZodEnum) return (schema as z.ZodEnum<any>).options[0];
  if (schema instanceof z.ZodLiteral) return (schema as z.ZodLiteral<any>).value;
  if (schema instanceof z.ZodObject) return getMinimalValid(schema);
  return undefined;
}
