// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://freqhole.net',
	integrations: [
		starlight({
			title: 'freqhole',
			tagline: 'self-hosted music library && web, android, and desktop client that talks http or p2p',
			customCss: ['./src/styles/custom.css'],
			head: [
				{ tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: 'any' } },
			],
			social: [{ icon: 'external', label: 'spume', href: 'https://spume.freqhole.net' }, { icon: 'github', label: 'GitHub', href: 'https://github.com/freqhole/tomb' }],
			components: {
				Hero: './src/components/CustomHero.astro',
			},
			sidebar: [
				{
					label: 'getting started',
					items: [
						{ label: 'download', slug: 'getting-started/download' },
						{ label: 'prerequisites', slug: 'getting-started/prerequisites' },
						{ label: 'thankz', slug: 'getting-started/thankz' },
					],
				},
				{
					label: 'concepts',
					items: [
						{ label: 'configuration', slug: 'concepts/configuration' },
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
