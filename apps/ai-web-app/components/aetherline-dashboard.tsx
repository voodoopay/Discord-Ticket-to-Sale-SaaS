'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Bot, CheckCircle2, LockKeyhole, Moon, Orbit, ShieldCheck, Sun } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { AiControlPlane } from '@/components/ai-control-plane';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AI_APP_BRAND } from '@/lib/ai-design-tokens';
import type { AiDashboardSessionData } from '@/lib/ai-session';

type FocusMode = 'routing' | 'sources' | 'guardrails';
type UiTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'voodoo-ai-theme';

const focusModes: Record<FocusMode, { label: string; detail: string; intensity: number }> = {
  routing: {
    label: 'Routing',
    detail: 'Reply channels, inline/thread mode, and bot presence.',
    intensity: 0.88,
  },
  sources: {
    label: 'Sources',
    detail: 'Website sync and custom Q&A grounding.',
    intensity: 0.66,
  },
  guardrails: {
    label: 'Guardrails',
    detail: 'Role rules, refusals, activation, and diagnostics.',
    intensity: 0.78,
  },
};

const satellites = [
  [-1.52, 0.28, 0.18, 0.08],
  [1.36, -0.36, -0.28, 0.11],
  [0.24, 1.36, 0.14, 0.07],
  [-0.3, -1.44, -0.16, 0.06],
] as const;

function AetherCore({
  focusMode,
  autopilot,
  reducedMotion,
  theme,
}: {
  focusMode: FocusMode;
  autopilot: boolean;
  reducedMotion: boolean;
  theme: UiTheme;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const intensity = focusModes[focusMode].intensity;
  const ringTilt = focusMode === 'routing' ? 0.18 : focusMode === 'sources' ? -0.42 : 0.68;
  const sceneColor = theme === 'dark' ? '#ffffff' : '#000000';
  const sceneMutedColor = theme === 'dark' ? '#737373' : '#525252';
  const wireColor = theme === 'dark' ? '#0a0a0a' : '#000000';

  const particleGeometry = useMemo(() => {
    const positions = new Float32Array(360 * 3);
    for (let index = 0; index < 360; index += 1) {
      const radius = 2.4 + (Math.sin(index * 17.17) + 1) * 1.45;
      const theta = index * 2.399963;
      positions[index * 3] = Math.cos(theta) * radius;
      positions[index * 3 + 1] = Math.sin(index * 4.31) * 1.55;
      positions[index * 3 + 2] = Math.sin(theta) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) {
      return;
    }

    const pointerX = reducedMotion ? 0 : state.pointer.x;
    const pointerY = reducedMotion ? 0 : state.pointer.y;
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, pointerY * 0.14, 0.06);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      pointerX * 0.22 + (autopilot && !reducedMotion ? state.clock.elapsedTime * 0.07 : 0.05),
      0.045,
    );
    if (autopilot && !reducedMotion) {
      groupRef.current.rotation.z += delta * 0.006;
    }
  });

  return (
    <group ref={groupRef}>
      <points geometry={particleGeometry}>
        <pointsMaterial color={sceneColor} size={0.018} transparent opacity={0.38} sizeAttenuation />
      </points>

      <mesh rotation={[0, 0, ringTilt]}>
        <torusGeometry args={[1.52, 0.006, 16, 220]} />
        <meshBasicMaterial color={sceneColor} transparent opacity={0.8} />
      </mesh>
      <mesh rotation={[1.18, 0.18, -0.72 + ringTilt]}>
        <torusGeometry args={[1.92, 0.004, 16, 260]} />
        <meshBasicMaterial color={theme === 'dark' ? '#d4d4d4' : '#171717'} transparent opacity={0.5 + intensity * 0.24} />
      </mesh>
      <mesh rotation={[0.44, 1.12, 0.36 - ringTilt]}>
        <torusGeometry args={[2.28, 0.003, 16, 280]} />
        <meshBasicMaterial color={sceneMutedColor} transparent opacity={0.42} />
      </mesh>

      <mesh>
        <sphereGeometry args={[1.04, 64, 64]} />
        <meshPhysicalMaterial
          color={sceneColor}
          emissive={sceneColor}
          emissiveIntensity={0.08 + intensity * 0.08}
          metalness={0}
          roughness={0.05}
          transparent
          opacity={0.055}
          transmission={0.25}
          thickness={0.8}
        />
      </mesh>

      <mesh>
        <icosahedronGeometry args={[0.82, 3]} />
        <meshStandardMaterial
          color={wireColor}
          emissive={sceneColor}
          emissiveIntensity={0.06 + intensity * 0.1}
          metalness={0.7}
          roughness={0.24}
          wireframe
        />
      </mesh>

      {satellites.map(([x, y, z, radius]) => (
        <mesh key={`${x}:${y}:${z}`} position={[x, y, z]}>
          <sphereGeometry args={[radius, 32, 32]} />
          <meshStandardMaterial color={sceneColor} emissive={sceneColor} emissiveIntensity={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function CommandScene({
  focusMode,
  autopilot,
  theme,
}: {
  focusMode: FocusMode;
  autopilot: boolean;
  theme: UiTheme;
}) {
  const [mounted, setMounted] = useState(false);
  const shouldReduceMotion = Boolean(useReducedMotion());

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex min-h-[28rem] items-center justify-center rounded-xl border border-border bg-background text-sm text-muted-foreground lg:min-h-[42rem]">
        Loading...
      </div>
    );
  }

  return (
    <div className="ai-canvas-shell relative min-h-[28rem] overflow-hidden rounded-xl border border-border bg-background lg:min-h-[42rem]">
      <Canvas
        camera={{ position: [0, 0, 5.7], fov: 46 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true }}
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            WebGL is unavailable in this browser.
          </div>
        }
      >
        <color attach="background" args={[theme === 'dark' ? '#000000' : '#f5f5f5']} />
        <fog attach="fog" args={[theme === 'dark' ? '#000000' : '#f5f5f5', 5.2, 10]} />
        <ambientLight intensity={0.36} />
        <pointLight position={[-3, 3, 4]} intensity={1.8} color="#ffffff" />
        <pointLight position={[3, -1, 3]} intensity={0.8} color="#a3a3a3" />
        <AetherCore focusMode={focusMode} autopilot={autopilot} reducedMotion={shouldReduceMotion} theme={theme} />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-xl border border-border bg-background/72 p-3 backdrop-blur">
        <p className="ai-mono text-[0.68rem] uppercase text-muted-foreground">Focus</p>
        <p className="mt-1 text-lg font-semibold">{focusModes[focusMode].label}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{focusModes[focusMode].detail}</p>
      </div>
    </div>
  );
}

export function AetherlineDashboard({
  sessionData,
  initialGuildId,
  authError,
}: {
  sessionData: AiDashboardSessionData | null;
  initialGuildId: string | null;
  authError: string | undefined;
}) {
  const [focusMode, setFocusMode] = useState<FocusMode>('routing');
  const [theme, setTheme] = useState<UiTheme>('dark');
  const guildCount = sessionData?.discordGuilds.length ?? 0;

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark';
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  function toggleTheme() {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      document.documentElement.dataset.theme = nextTheme;
      return nextTheme;
    });
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden py-6">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 h-px bg-foreground/50" />
        <div className="ai-grid-weave absolute right-6 top-20 hidden h-96 w-[32rem] opacity-25 xl:block" />
      </div>

      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 sm:px-6">
        <motion.header
          className="grid gap-4 rounded-xl border border-border bg-card/70 px-4 py-4 backdrop-blur md:grid-cols-[1fr_auto]"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
        >
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-background text-foreground shadow-sm">
              <Orbit />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{AI_APP_BRAND.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{AI_APP_BRAND.tagline}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:justify-end">
            {sessionData ? <Badge>{guildCount} guild{guildCount === 1 ? '' : 's'}</Badge> : null}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </div>
        </motion.header>

        {authError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {authError}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <motion.div
            className="relative overflow-hidden rounded-xl border border-border bg-card/70 p-4 backdrop-blur"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34 }}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(22rem,0.52fr)_minmax(0,1fr)]">
              <div className="flex flex-col justify-between gap-6 rounded-xl border border-border bg-background/62 p-5">
                <div>
                  <p className="ai-mono text-[0.72rem] font-semibold uppercase text-muted-foreground">
                    AI bot
                  </p>
                  <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
                    Control replies, sources, and access.
                  </h2>
                  <p className="mt-4 text-base leading-7 text-muted-foreground">
                    Configure Discord reply behavior, website grounding, role rules, and diagnostics.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  {sessionData ? (
                    <Button asChild size="lg">
                      <a href="#configure">
                        Configure
                        <ArrowRight data-icon="inline-end" />
                      </a>
                    </Button>
                  ) : (
                    <Button asChild size="lg">
                      <a href="/api/auth/discord/login">
                        {AI_APP_BRAND.loginLabel}
                        <ArrowRight data-icon="inline-end" />
                      </a>
                    </Button>
                  )}
                  <Button variant="outline" size="lg" asChild>
                    <a href="#access">Check access</a>
                  </Button>
                </div>
              </div>

              <CommandScene focusMode={focusMode} autopilot theme={theme} />
            </div>
          </motion.div>

          <Card>
            <CardHeader>
              <CardDescription className="ai-mono uppercase">Controls</CardDescription>
              <CardTitle>{focusModes[focusMode].label}</CardTitle>
              <CardDescription>{focusModes[focusMode].detail}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-2">
                {(Object.keys(focusModes) as FocusMode[]).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={mode === focusMode ? 'default' : 'secondary'}
                    onClick={() => setFocusMode(mode)}
                  >
                    {focusModes[mode].label}
                  </Button>
                ))}
              </div>

              <div id="access" className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  {sessionData ? <CheckCircle2 /> : <LockKeyhole />}
                  <p className="font-semibold">{sessionData ? 'Discord session active' : 'Discord login required'}</p>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {sessionData
                    ? `${guildCount} eligible server${guildCount === 1 ? '' : 's'} available.`
                    : 'Login loads only servers where you are owner or administrator.'}
                </p>
              </div>
            </CardContent>
            <CardFooter>
              {sessionData ? (
                <Button asChild variant="outline" className="w-full">
                  <a href="#configure">
                    <Bot data-icon="inline-start" />
                    Open live configuration
                  </a>
                </Button>
              ) : (
                <Button asChild className="w-full">
                  <a href="/api/auth/discord/login">
                    <ShieldCheck data-icon="inline-start" />
                    {AI_APP_BRAND.loginLabel}
                  </a>
                </Button>
              )}
            </CardFooter>
          </Card>
        </section>

        {sessionData ? (
          <Tabs id="configure" defaultValue="configure" className="gap-4">
            <TabsList className="w-full bg-muted/70 md:w-fit">
              <TabsTrigger value="configure">Configure</TabsTrigger>
              <TabsTrigger value="access">Guild access</TabsTrigger>
            </TabsList>
            <TabsContent value="configure">
              <AiControlPlane
                guilds={sessionData.discordGuilds}
                initialGuildId={initialGuildId}
              />
            </TabsContent>
            <TabsContent value="access">
              <Card>
                <CardHeader>
                  <CardDescription className="ai-mono uppercase">Eligible servers</CardDescription>
                  <CardTitle>{guildCount} server{guildCount === 1 ? '' : 's'}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {sessionData.discordGuilds.map((guild) => (
                    <div key={guild.id} className="rounded-xl border border-border bg-muted/40 p-3">
                      <p className="truncate font-semibold">{guild.name}</p>
                      <p className="ai-mono mt-1 text-[0.68rem] uppercase text-muted-foreground">
                        {guild.owner ? 'Owner' : 'Administrator'}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : null}
      </div>
    </main>
  );
}
