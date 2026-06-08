import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		// created/updated + their authors and commit shas are stamped from git
		// history by scripts/gen-page-dates.mjs and rendered under the page title.
		// all optional so pages (and the splash home page) without them still build.
		schema: docsSchema({
			extend: z.object({
				created: z.date().optional(),
				createdBy: z.string().optional(),
				createdSha: z.string().optional(),
				updated: z.date().optional(),
				updatedBy: z.string().optional(),
				updatedSha: z.string().optional(),
			}),
		}),
	}),
};
