import { z } from "zod";

export const musicValidation = {
  /**
   * Validate a response using a Zod schema
   * Throws an error if validation fails
   */
  validateResponse<T>(
    schema: z.ZodSchema<T>,
    data: unknown,
    context: string,
  ): T {
    const result = schema.safeParse(data);
    if (result.success) {
      return result.data;
    }

    console.error(`${context} validation failed:`, result.error);
    console.error(`Raw data:`, data);
    throw new Error(`Invalid ${context} response format`);
  },

  /**
   * Parse a collection gracefully - omit invalid items instead of failing entirely
   * This is crucial for database-backed collections where some items might be corrupted
   */
  parseCollection<T>(
    schema: z.ZodSchema<T>,
    data: unknown[],
    context: string,
  ): T[] {
    if (!Array.isArray(data)) {
      console.error(`${context} collection parsing failed: data is not an array`, data);
      return [];
    }

    const results: T[] = [];
    let failedCount = 0;

    data.forEach((item, index) => {
      const parsed = schema.safeParse(item);
      if (parsed.success) {
        results.push(parsed.data);
      } else {
        failedCount++;
        console.warn(`Failed to parse ${context} at index ${index}:`, {
          error: parsed.error.errors,
          data: item,
        });
      }
    });

    if (failedCount > 0) {
      console.warn(`${context} collection: ${failedCount} items failed validation, ${results.length} items parsed successfully`);
    }

    return results;
  },

  /**
   * Parse a collection response that contains a collection field
   * Gracefully handles invalid items in the collection
   */
  parseCollectionResponse<T, R>(
    responseSchema: z.ZodSchema<R>,
    itemSchema: z.ZodSchema<T>,
    data: unknown,
    context: string,
    collectionField: string,
  ): R & { [K in keyof R]: R[K] extends T[] ? T[] : R[K] } {
    const response = this.validateResponse(responseSchema, data, context);

    // If the response has a collection field, parse it gracefully
    if (response && typeof response === 'object' && collectionField in response) {
      const collection = (response as any)[collectionField];
      const parsedCollection = this.parseCollection(itemSchema, collection, context);

      return {
        ...response,
        [collectionField]: parsedCollection,
      } as R & { [K in keyof R]: R[K] extends T[] ? T[] : R[K] };
    }

    return response as R & { [K in keyof R]: R[K] extends T[] ? T[] : R[K] };
  },

  /**
   * Safe parse with logging - returns undefined if parsing fails
   */
  safeParse<T>(
    schema: z.ZodSchema<T>,
    data: unknown,
    context: string,
  ): T | undefined {
    const result = schema.safeParse(data);
    if (result.success) {
      return result.data;
    }

    console.warn(`${context} parsing failed:`, {
      error: result.error.errors,
      data: data,
    });
    return undefined;
  },
};
