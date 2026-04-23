export const AI_APP_BRAND = {
  name: 'Voodoo AI',
  eyebrow: 'Discord automation',
  tagline: 'Discord replies grounded in your sources.',
  loginLabel: 'Login with Discord',
  shellLabel: 'Voodoo AI Control',
} as const;

export const aiHeroSignals = [
  'Command mesh',
  'Guild access',
  'Live config',
] as const;

export const aiDashboardSections = [
  {
    id: 'overview',
    title: 'Overview',
    eyebrow: 'Node Status',
    metric: '99.8%',
    detail: 'Live readiness, sync health, and issue visibility stay above the fold.',
  },
  {
    id: 'reply-behavior',
    title: 'Reply Behavior',
    eyebrow: 'Reply Channels',
    metric: '12 lanes',
    detail: 'Thread mode, inline routing, and moderation guardrails anchor the future settings flow.',
  },
  {
    id: 'knowledge',
    title: 'Knowledge',
    eyebrow: 'Grounding',
    metric: '1,240 docs',
    detail: 'Approved sources, indexing state, and knowledge freshness remain visible without leaving the shell.',
  },
  {
    id: 'personality',
    title: 'Personality',
    eyebrow: 'Tone Control',
    metric: '4 presets',
    detail: 'Voice, instruction pressure, and response behavior are framed as a deliberate editorial layer.',
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics',
    eyebrow: 'Confidence',
    metric: '0 issues',
    detail: 'Refusals, drift, and failed syncs surface in a high-signal monitor instead of a noisy log wall.',
  },
] as const;

export const aiLaunchMetrics = [
  {
    label: 'Guild scope',
    value: 'Owner/Admin',
  },
  {
    label: 'Auth',
    value: 'Discord OAuth',
  },
  {
    label: 'Runtime',
    value: 'Port 3100',
  },
] as const;

export const aiReadinessPillars = [
  {
    title: 'Scene first',
    detail: 'The 3D canvas is the main surface, not a decorative side element.',
  },
  {
    title: 'Grayscale only',
    detail: 'No accent palette: just depth, contrast, and state hierarchy.',
  },
  {
    title: 'Useful controls',
    detail: 'Only login, guild access, theme, focus, and live configuration remain.',
  },
] as const;

export const aiDesignPalette = {
  background: '#000000',
  surface: '#080808',
  surfaceRaised: '#111111',
  primary: '#ffffff',
  secondary: '#d4d4d4',
  tertiary: '#737373',
  text: '#ffffff',
  textMuted: '#a3a3a3',
  outline: 'rgb(255 255 255 / 0.16)',
  ambientShadow: '0 24px 80px rgb(0 0 0 / 0.32)',
} as const;
