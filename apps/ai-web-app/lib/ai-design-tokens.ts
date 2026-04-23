export const AI_APP_BRAND = {
  name: 'Aetherline',
  eyebrow: 'Atmospheric Intelligence',
  tagline: 'Grounded Discord intelligence for server owners and admins.',
  loginLabel: 'Login with Discord',
  shellLabel: 'AI Bot Control',
} as const;

export const aiHeroSignals = [
  'Owner and administrator guilds only',
  'Grounded website and custom Q&A control surface',
  'Separate AI brand on a standalone panel domain',
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
    label: 'Accessible guilds',
    value: 'Owner/Admin',
  },
  {
    label: 'Auth model',
    value: 'Discord OAuth',
  },
  {
    label: 'Control surface',
    value: 'Mobile-first',
  },
] as const;

export const aiReadinessPillars = [
  {
    title: 'Tonal layering',
    detail: 'Surfaces define hierarchy through lift and light, not heavy dividing lines.',
  },
  {
    title: 'Dense without clutter',
    detail: 'Each card carries one high-signal metric plus the next action the panel will enable.',
  },
  {
    title: 'Motion restraint',
    detail: 'Only the status pulse and CTA glow move by default, with reduced-motion respected globally.',
  },
] as const;

export const aiDesignPalette = {
  background: '#f7f9fb',
  surface: '#f2f4f6',
  surfaceRaised: '#ffffff',
  primary: '#2346d5',
  secondary: '#4361ee',
  tertiary: '#5bd5fc',
  text: '#191c1e',
  textMuted: '#444655',
  outline: 'rgb(196 197 215 / 0.24)',
  ambientShadow: '0 12px 40px rgb(35 70 213 / 0.08)',
} as const;
