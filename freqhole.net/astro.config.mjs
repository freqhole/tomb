// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
	site: 'https://freqhole.net',
	// short alias so the desktop app (and humans) can point at the stable
	// /download url; astro emits a redirect to the actual docs page at build.
	redirects: {
		'/download': '/getting-started/download',
	},
	integrations: [
		// mermaid must come before starlight so it can register its remark plugin
		// and client script. renders ```mermaid fences client-side (no headless
		// browser at build) with automatic light/dark theme switching.
		//
		// useMaxWidth: false makes diagrams render at their natural size instead
		// of being squeezed to fit the content column - the big er diagrams on the
		// database page are unreadable otherwise. custom.css adds horizontal scroll
		// for the cases where the natural size is wider than the page.
		mermaid({
			autoTheme: true,
			mermaidConfig: {
				er: { useMaxWidth: false },
				flowchart: { useMaxWidth: false },
			},
		}),
		starlight({
			title: 'freqhole',
			tagline: 'self-hosted music library && web, android, and desktop clientz that can talk http or p2p',
			customCss: ['./src/styles/custom.css'],
			head: [
				{ tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: 'any' } },
			],
			social: [{ icon: 'external', label: 'spume', href: 'https://spume.freqhole.net' }, { icon: 'github', label: 'GitHub', href: 'https://github.com/freqhole/tomb' }],
			components: {
				Hero: './src/components/CustomHero.astro',
				PageTitle: './src/components/CustomPageTitle.astro',
			},
			sidebar: [
				{
					label: 'getting started',
					items: [
						{ label: 'brainstorm', slug: 'getting-started/brainstorm' },
						{ label: 'download', slug: 'getting-started/download' },
						{ label: 'prerequisites', slug: 'getting-started/prerequisites' },
						{ label: 'thankz', slug: 'getting-started/thankz' },
					],
				},
				{
					label: 'concepts',
					items: [
						{ label: 'configuration', slug: 'concepts/configuration' },
						{ label: 'the database', slug: 'concepts/database' },
						{ label: 'HTTP vs P2P', slug: 'concepts/transports' },
						{ label: 'web app architecture', slug: 'concepts/web-app' },
						{ label: 'where music lives', slug: 'concepts/storage' },
						{ label: 'user roles', slug: 'concepts/user-roles' },
						{ label: 'invite codes', slug: 'concepts/invite-codes' },
					],
				},
				{
					label: 'guides',
					items: [
						{ label: 'scanning music', slug: 'guides/scanning' },
						{ label: 'metadata enrichment', slug: 'guides/metadata-enrichment' },
						{ label: 'sharing with friends', slug: 'guides/sharing' },
						{ label: 'maintenance', slug: 'guides/maintenance' },
					],
				},

			],
		}),
	],
});
