import type * as Preset from '@docusaurus/preset-classic';
import type {Config} from '@docusaurus/types';
import {themes as prismThemes} from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'CodeRunner',
  tagline: 'Browser-based IDE and simulator for FRC programming training',
  favicon: 'img/coderunner-icon.png',

  future: {
    v4: true,
  },

  // Deployed to GitHub Pages as a project site at
  // https://mathewdunne.github.io/CodeRunner/ (see .github/workflows/deploy-docs.yml).
  url: 'https://mathewdunne.github.io',
  baseUrl: '/CodeRunner/',

  // GitHub Pages deployment config (used by `docusaurus deploy` and for metadata).
  organizationName: 'mathewdunne',
  projectName: 'CodeRunner',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          // Decision logs are maintainer/agent records, not site content.
          exclude: [
            'decisions/**',
          ],
          editUrl: 'https://github.com/mathewdunne/CodeRunner/tree/main/docs/',
        },
        blog: false,
        pages: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'CodeRunner',
      logo: {
        alt: 'CodeRunner logo',
        src: 'img/coderunner-icon.png',
      },
      items: [
        {
          href: 'https://github.com/mathewdunne/CodeRunner',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} CodeRunner contributors. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['java', 'bash', 'json', 'groovy', 'docker', 'hcl'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
