'use client';

import 'driver.js/dist/driver.css';

import { driver } from 'driver.js';
import {
  Activity,
  AlertCircle,
  ChevronDown,
  CheckCircle2,
  Globe,
  Info,
  Loader2,
  Layers3,
  Pencil,
  Plus,
  Settings2,
  Shield,
  Store,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import Image from 'next/image';
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import darkModeLogo from '../../../../assets/darkmode-logo.png';
import lightModeLogo from '../../../../assets/lightmode-logo.png';
import { TutorialLaunchModal } from '@/components/dashboard/tutorial-launch-modal';
import { ModeToggle } from '@/components/mode-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  DASHBOARD_TUTORIAL_STORAGE_KEY,
  buildDashboardTutorialCookie,
  buildDashboardTutorialSectionJumps,
  buildDashboardTutorialStepDefs,
  buildDashboardTutorialSteps,
  hasDashboardTutorialMarker,
} from '@/lib/dashboard-tutorial';
import { getDashboardFocusForTutorialStep } from '@/lib/dashboard-layout';
import {
  CATALOG_SECTION_IDS,
  DASHBOARD_SECTION_IDS,
  DEFAULT_OPEN_CATALOG_SECTIONS,
  DEFAULT_OPEN_DASHBOARD_SECTIONS,
  ensurePanelsOpen,
  focusPanel,
  type CatalogSectionId,
  type DashboardSectionId,
  toggleExclusivePanel,
} from '@/lib/dashboard-panels';
import { cn } from '@/lib/utils';

type FieldType = 'short_text' | 'long_text' | 'email' | 'number';

type RequestState = {
  loading: boolean;
  response: string;
  error: string;
};

type TenantSummary = {
  id: string;
  name: string;
  status: string;
};

type DiscordGuildSummary = {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  permissions: string;
};

type GuildResources = {
  botInGuild: boolean;
  inviteUrl: string;
  guild: {
    id: string;
    name: string;
  };
  channels: Array<{
    id: string;
    name: string;
    type: number;
  }>;
  categoryChannels: Array<{
    id: string;
    name: string;
    type: number;
  }>;
  roles: Array<{
    id: string;
    name: string;
    color: number;
    position: number;
  }>;
};

type GuildConfigRecord = {
  paidLogChannelId: string | null;
  staffRoleIds: string[];
  defaultCurrency: string;
  tipEnabled: boolean;
  pointsEarnCategoryKeys: string[];
  pointsRedeemCategoryKeys: string[];
  pointValueMinor: number;
  referralRewardMinor: number;
  referralRewardCategoryKeys: string[];
  referralLogChannelId: string | null;
  referralThankYouTemplate: string;
  referralSubmissionTemplate: string;
  ticketMetadataKey?: string;
  joinGateEnabled: boolean;
  joinGateFallbackChannelId: string | null;
  joinGateVerifiedRoleId: string | null;
  joinGateTicketCategoryId: string | null;
  joinGateCurrentLookupChannelId: string | null;
  joinGateNewLookupChannelId: string | null;
};

type ProductVariantRecord = {
  id: string;
  label: string;
  priceMinor: number;
  referralRewardMinor: number;
  currency: string;
};

type ProductFormFieldRecord = {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  sensitive: boolean;
  sortOrder: number;
};

type ProductRecord = {
  id: string;
  category: string;
  name: string;
  description: string;
  active: boolean;
  variants: ProductVariantRecord[];
  formFields: ProductFormFieldRecord[];
};

type CouponRecord = {
  id: string;
  code: string;
  discountMinor: number;
  active: boolean;
  allowedProductIds: string[];
  allowedVariantIds: string[];
};

type PointsCustomerRecord = {
  emailNormalized: string;
  emailDisplay: string;
  balancePoints: number;
  reservedPoints: number;
  availablePoints: number;
};

type MeResponse = {
  me: {
    userId: string;
    isSuperAdmin: boolean;
    tenantIds: string[];
  };
  tenants: TenantSummary[];
  discordGuilds: DiscordGuildSummary[];
  discordGuildsError: string;
};

type PriceOptionDraft = {
  label: string;
  priceMajor: string;
  referralRewardMajor: string;
  currency: string;
};

type QuestionDraft = {
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  sensitive: boolean;
  sortOrder: number;
};

type VoodooCryptoWallets = {
  evm: string;
  btc: string;
  bitcoincash: string;
  ltc: string;
  doge: string;
  trc20: string;
  solana: string;
};

const initialState: RequestState = {
  loading: false,
  response: '',
  error: '',
};

const DEFAULT_CURRENCY = 'GBP';
const DEFAULT_VOODOO_CHECKOUT_DOMAIN = 'checkout.voodoo-pay.uk';
const DASHBOARD_CONTEXT_STORAGE_KEY = 'voodoo_dashboard_context_v1';
const REQUIRED_EMAIL_QUESTION_KEY = 'email';
const REQUIRED_EMAIL_QUESTION_LABEL = 'What is your email?';
const DEFAULT_POINT_VALUE_MAJOR = '0.01';
const DEFAULT_REFERRAL_REWARD_MAJOR = '0.00';
const DEFAULT_REFERRAL_THANK_YOU_TEMPLATE =
  'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.';
const DEFAULT_REFERRAL_SUBMISSION_TEMPLATE =
  'Referral submitted successfully. We will reward points automatically after the first paid order.';
const EMPTY_VOODOO_CRYPTO_WALLETS: VoodooCryptoWallets = {
  evm: '',
  btc: '',
  bitcoincash: '',
  ltc: '',
  doge: '',
  trc20: '',
  solana: '',
};

const nativeSelectClass =
  'dark:bg-input/30 dark:border-input dark:hover:bg-input/40 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50';

function safeJsonParse(text: string): unknown {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function apiCall(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? safeJsonParse(responseText) : null;

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : responseText.startsWith('<!DOCTYPE') || responseText.startsWith('<html')
          ? `Request failed with ${response.status}. Server returned HTML instead of JSON. Check Workspace ID + Discord Server ID first.`
          : responseText || `Request failed with ${response.status}`;

    throw new Error(message);
  }

  if (isJson) {
    return payload;
  }

  return {
    status: response.status,
    body: responseText,
  };
}

function parsePriceToMinor(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Price must be a valid positive number like 9.99');
  }

  return Math.round(parsed * 100);
}

function parsePointValueMajorToMinor(value: string): number {
  if (!value.trim()) {
    return 1;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Point value must be greater than 0, for example 0.01');
  }

  const minor = Math.round(parsed * 100);
  if (minor < 1) {
    throw new Error('Point value is too small. Minimum is 0.01.');
  }

  return minor;
}

function formatPointValueMinorToMajor(pointValueMinor: number): string {
  if (!Number.isFinite(pointValueMinor) || pointValueMinor <= 0) {
    return DEFAULT_POINT_VALUE_MAJOR;
  }

  return (pointValueMinor / 100).toFixed(2);
}

function formatMinorToMajor(minor: number): string {
  if (!Number.isFinite(minor) || minor < 0) {
    return '0.00';
  }

  return (minor / 100).toFixed(2);
}

function parseWholePoints(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Points must be a positive whole number.');
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Points must be a positive whole number.');
  }

  return parsed;
}

function previewReferralRewardPoints(referralRewardMajor: string, pointValueMajor: string): number {
  try {
    const rewardMinor = parsePriceToMinor(referralRewardMajor);
    const pointValueMinor = parsePointValueMajorToMinor(pointValueMajor);
    return Math.max(0, Math.floor(rewardMinor / Math.max(1, pointValueMinor)));
  } catch {
    return 0;
  }
}

function normalizeDiscordId(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }

  return '';
}

function normalizeDiscordIdList(value: unknown): string[] {
  const normalizeArray = (items: unknown[]): string[] => [
    ...new Set(items.map((item) => normalizeDiscordId(item)).filter(Boolean)),
  ];

  if (Array.isArray(value)) {
    return normalizeArray(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    const parsed = safeJsonParse(trimmed);
    if (Array.isArray(parsed)) {
      return normalizeArray(parsed);
    }

    if (trimmed.includes(',')) {
      return normalizeArray(trimmed.split(','));
    }

    return normalizeArray([trimmed]);
  }

  return [];
}

function normalizeCategoryKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCheckoutDomainInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).host;
    } catch {
      candidate = candidate.replace(/^https?:\/\//i, '');
    }
  }

  candidate = candidate.replace(/^https?:\/\//i, '');
  const slashIndex = candidate.indexOf('/');
  if (slashIndex >= 0) {
    candidate = candidate.slice(0, slashIndex);
  }

  return candidate.replace(/\/+$/, '').trim().toLowerCase();
}

function normalizeCouponRecord(coupon: CouponRecord): CouponRecord {
  return {
    ...coupon,
    allowedProductIds: Array.isArray(coupon.allowedProductIds) ? coupon.allowedProductIds : [],
    allowedVariantIds: Array.isArray(coupon.allowedVariantIds) ? coupon.allowedVariantIds : [],
  };
}

function ensureRequiredEmailQuestion(questions: QuestionDraft[]): QuestionDraft[] {
  const nonEmailQuestions = questions.filter(
    (question) => question.key.trim().toLowerCase() !== REQUIRED_EMAIL_QUESTION_KEY,
  );

  const requiredEmailQuestion: QuestionDraft = {
    key: REQUIRED_EMAIL_QUESTION_KEY,
    label: REQUIRED_EMAIL_QUESTION_LABEL,
    fieldType: 'email',
    required: true,
    sensitive: false,
    sortOrder: 0,
  };

  const merged = [requiredEmailQuestion, ...nonEmailQuestions];
  return merged.map((question, sortOrder) => ({ ...question, sortOrder }));
}

function getDefaultQuestions(): QuestionDraft[] {
  return ensureRequiredEmailQuestion([]);
}

function compactSummary(...items: Array<string | false | null | undefined>): string[] {
  return items.filter((item): item is string => Boolean(item));
}

function buildSummaryPreview(summaryItems: string[], maxItems = 3): string {
  return summaryItems.slice(0, maxItems).join(' • ');
}

type DashboardSectionHeaderProps = {
  action?: ReactNode;
  description: string;
  icon: ComponentType<{ className?: string }>;
  isOpen: boolean;
  onToggle: (sectionId: DashboardSectionId) => void;
  sectionId: DashboardSectionId;
  stepLabel?: string;
  summaryItems: string[];
  title: string;
};

function DashboardSectionHeader({
  action,
  description,
  icon: Icon,
  isOpen,
  onToggle,
  sectionId,
  stepLabel,
  summaryItems,
  title,
}: DashboardSectionHeaderProps): ReactNode {
  const summaryPreview = buildSummaryPreview(summaryItems);

  return (
    <CardHeader className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <button
          type="button"
          className="group flex w-full flex-1 items-start gap-3 rounded-[1.5rem] border border-border/60 bg-secondary/15 p-4 text-left transition-colors hover:border-primary/30 hover:bg-secondary/25"
          onClick={() => onToggle(sectionId)}
          aria-expanded={isOpen}
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[1.25rem] border border-border/60 bg-background/85 shadow-sm">
            <Icon className="size-4 text-primary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              {stepLabel ? (
                <span className="inline-flex items-center rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Step {stepLabel}
                </span>
              ) : null}
              <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
            </span>
            <CardDescription className="mt-1.5 text-sm leading-6">{description}</CardDescription>
            {summaryPreview ? (
              <span className="mt-2 block text-xs font-medium text-muted-foreground">
                {summaryPreview}
              </span>
            ) : null}
          </span>
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/75 text-muted-foreground">
            <ChevronDown
              className={cn('size-4 transition-transform duration-200', isOpen ? 'rotate-180' : '')}
            />
          </span>
        </button>
        {action ? <div className="flex justify-end sm:self-start">{action}</div> : null}
      </div>
    </CardHeader>
  );
}

type CatalogStepPanelProps = {
  children: ReactNode;
  description: string;
  isOpen: boolean;
  onToggle: (sectionId: CatalogSectionId) => void;
  sectionId: CatalogSectionId;
  stepLabel: string;
  summaryItems: string[];
  title: string;
};

function CatalogStepPanel({
  children,
  description,
  isOpen,
  onToggle,
  sectionId,
  stepLabel,
  summaryItems,
  title,
}: CatalogStepPanelProps): ReactNode {
  const summaryPreview = buildSummaryPreview(summaryItems);

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-border/60 bg-secondary/15">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-secondary/25"
        onClick={() => onToggle(sectionId)}
        aria-expanded={isOpen}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[1.15rem] border border-border/60 bg-background/85 text-xs font-semibold text-primary shadow-sm">
          {stepLabel}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          {summaryPreview ? (
            <span className="mt-2 block text-xs font-medium text-muted-foreground">
              {summaryPreview}
            </span>
          ) : null}
        </span>
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/75 text-muted-foreground">
          <ChevronDown
            className={cn('size-4 transition-transform', isOpen ? 'rotate-180' : '')}
          />
        </span>
      </button>
      {isOpen ? <div className="border-t border-border/60 px-4 py-4">{children}</div> : null}
    </div>
  );
}

type DashboardQuickStepProps = {
  active: boolean;
  onClick: () => void;
  stateLabel: string;
  stateTone: 'neutral' | 'ready';
  stepLabel: string;
  summary: string;
  title: string;
};

function DashboardQuickStepButton({
  active,
  onClick,
  stateLabel,
  stateTone,
  stepLabel,
  summary,
  title,
}: DashboardQuickStepProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'w-full rounded-[1.5rem] border p-4 text-left transition duration-150',
        active
          ? 'border-primary/45 bg-background/95 shadow-lg shadow-primary/10'
          : 'border-border/60 bg-card/75 hover:border-primary/30 hover:bg-background/90',
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-full border border-border/60 bg-secondary/40 text-xs font-semibold text-primary">
          {stepLabel}
        </span>
        <span
          className={cn(
            'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold',
            stateTone === 'ready'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
              : 'border-border/60 bg-background/75 text-muted-foreground',
          )}
        >
          {stateLabel}
        </span>
      </span>
      <span className="mt-3 block text-sm font-semibold text-foreground">{title}</span>
      <span className="mt-2 block text-xs leading-5 text-muted-foreground">{summary}</span>
    </button>
  );
}

function toQuestionDrafts(fields: ProductFormFieldRecord[]): QuestionDraft[] {
  const mapped = fields
    .map((field, index) => ({
      key: field.fieldKey,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      sensitive: field.sensitive,
      sortOrder: field.sortOrder ?? index,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (mapped.length === 0) {
    return getDefaultQuestions();
  }

  return ensureRequiredEmailQuestion(
    mapped.map((question, sortOrder) => ({ ...question, sortOrder })),
  );
}

export default function DashboardPage() {
  const [tenantId, setTenantId] = useState('');
  const [guildId, setGuildId] = useState('');
  const [myTenants, setMyTenants] = useState<TenantSummary[]>([]);
  const [discordGuilds, setDiscordGuilds] = useState<DiscordGuildSummary[]>([]);
  const [discordGuildsError, setDiscordGuildsError] = useState('');
  const [guildResources, setGuildResources] = useState<GuildResources | null>(null);
  const [guildResourcesLoading, setGuildResourcesLoading] = useState(false);
  const [guildResourcesError, setGuildResourcesError] = useState('');
  const [guildLinking, setGuildLinking] = useState(false);
  const [linkedContextKeys, setLinkedContextKeys] = useState<Record<string, boolean>>({});
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [isTutorialPromptOpen, setIsTutorialPromptOpen] = useState(false);
  const tutorialDriverRef = useRef<ReturnType<typeof driver> | null>(null);
  const tutorialExpansionStateRef = useRef<{
    dashboardSections: DashboardSectionId[];
    catalogSections: CatalogSectionId[];
  } | null>(null);
  const [openDashboardSections, setOpenDashboardSections] = useState<DashboardSectionId[]>(
    DEFAULT_OPEN_DASHBOARD_SECTIONS,
  );
  const [openCatalogSections, setOpenCatalogSections] = useState<CatalogSectionId[]>(
    DEFAULT_OPEN_CATALOG_SECTIONS,
  );

  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [createTenantName, setCreateTenantName] = useState('');
  const [telegramLinkCommand, setTelegramLinkCommand] = useState('');
  const [telegramLinkExpiresAt, setTelegramLinkExpiresAt] = useState('');
  const [telegramBotUsername, setTelegramBotUsername] = useState('');

  const [paidLogChannelId, setPaidLogChannelId] = useState('');
  const [selectedStaffRoleIds, setSelectedStaffRoleIds] = useState<string[]>([]);
  const [defaultCurrency, setDefaultCurrency] = useState(DEFAULT_CURRENCY);
  const [tipEnabled, setTipEnabled] = useState(false);
  const [joinGateEnabled, setJoinGateEnabled] = useState(false);
  const [joinGateFallbackChannelId, setJoinGateFallbackChannelId] = useState('');
  const [joinGateVerifiedRoleId, setJoinGateVerifiedRoleId] = useState('');
  const [joinGateTicketCategoryId, setJoinGateTicketCategoryId] = useState('');
  const [joinGateCurrentLookupChannelId, setJoinGateCurrentLookupChannelId] = useState('');
  const [joinGateNewLookupChannelId, setJoinGateNewLookupChannelId] = useState('');
  const [pointValueMajor, setPointValueMajor] = useState(DEFAULT_POINT_VALUE_MAJOR);
  const [referralRewardMajor, setReferralRewardMajor] = useState(DEFAULT_REFERRAL_REWARD_MAJOR);
  const [referralLogChannelId, setReferralLogChannelId] = useState('');
  const [referralThankYouTemplate, setReferralThankYouTemplate] = useState(
    DEFAULT_REFERRAL_THANK_YOU_TEMPLATE,
  );
  const [referralSubmissionTemplate, setReferralSubmissionTemplate] = useState(
    DEFAULT_REFERRAL_SUBMISSION_TEMPLATE,
  );
  const [referralRewardCategoryKeys, setReferralRewardCategoryKeys] = useState<string[]>([]);
  const [pointsEarnCategoryKeys, setPointsEarnCategoryKeys] = useState<string[]>([]);
  const [pointsRedeemCategoryKeys, setPointsRedeemCategoryKeys] = useState<string[]>([]);
  const [pointsCustomers, setPointsCustomers] = useState<PointsCustomerRecord[]>([]);
  const [pointsCustomersLoading, setPointsCustomersLoading] = useState(false);
  const [pointsSearchInput, setPointsSearchInput] = useState('');
  const [pointsAdjustEmail, setPointsAdjustEmail] = useState('');
  const [pointsAdjustValueInput, setPointsAdjustValueInput] = useState('1');

  const [botToken, setBotToken] = useState('');

  const [voodooMerchantWalletAddress, setVoodooMerchantWalletAddress] = useState('');
  const [voodooCheckoutDomain, setVoodooCheckoutDomain] = useState(DEFAULT_VOODOO_CHECKOUT_DOMAIN);
  const [voodooCallbackSecret, setVoodooCallbackSecret] = useState('');
  const [voodooCryptoGatewayEnabled, setVoodooCryptoGatewayEnabled] = useState(false);
  const [voodooCryptoAddFees, setVoodooCryptoAddFees] = useState(false);
  const [voodooCryptoWallets, setVoodooCryptoWallets] = useState<VoodooCryptoWallets>(
    EMPTY_VOODOO_CRYPTO_WALLETS,
  );
  const [voodooWebhookKey, setVoodooWebhookKey] = useState('');
  const [voodooWebhookUrl, setVoodooWebhookUrl] = useState('');
  const [autoGeneratedCallbackSecret, setAutoGeneratedCallbackSecret] = useState('');

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [couponDiscountInput, setCouponDiscountInput] = useState('1.00');
  const [couponActiveInput, setCouponActiveInput] = useState(true);
  const [couponAllowedProductIdsInput, setCouponAllowedProductIdsInput] = useState<string[]>([]);
  const [couponAllowedVariantIdsInput, setCouponAllowedVariantIdsInput] = useState<string[]>([]);

  const [categoryBuilderName, setCategoryBuilderName] = useState('Accounts');
  const [categoryRenameTo, setCategoryRenameTo] = useState('');
  const [productCategory, setProductCategory] = useState('Accounts');
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [productActive, setProductActive] = useState(true);

  const [variantLabelInput, setVariantLabelInput] = useState('');
  const [variantPriceInput, setVariantPriceInput] = useState('');
  const [variantReferralRewardInput, setVariantReferralRewardInput] = useState('');
  const [editingVariantIndex, setEditingVariantIndex] = useState<number | null>(null);
  const [variants, setVariants] = useState<PriceOptionDraft[]>([]);

  const [questionKeyInput, setQuestionKeyInput] = useState('');
  const [questionLabelInput, setQuestionLabelInput] = useState('');
  const [questionTypeInput, setQuestionTypeInput] = useState<FieldType>('short_text');
  const [questionRequiredInput, setQuestionRequiredInput] = useState(true);
  const [questionSensitiveInput, setQuestionSensitiveInput] = useState(false);
  const [questions, setQuestions] = useState<QuestionDraft[]>(getDefaultQuestions());

  const [state, setState] = useState<RequestState>(initialState);

  const selectedDiscordGuild = useMemo(
    () => discordGuilds.find((guild) => guild.id === guildId) ?? null,
    [discordGuilds, guildId],
  );
  const serverReady = Boolean(guildResources?.botInGuild);

  const contextPreview = useMemo(
    () => ({
      workspaceId: tenantId,
      workspaceName: myTenants.find((tenant) => tenant.id === tenantId)?.name ?? '',
      discordServerId: guildId,
      discordServerName: selectedDiscordGuild?.name ?? '',
      botInstalled: Boolean(guildResources?.botInGuild),
      defaultCurrency,
      tipEnabled,
      joinGateEnabled,
      joinGateFallbackChannelId,
      joinGateVerifiedRoleId,
      joinGateTicketCategoryId,
      pointValueMajor,
      referralRewardMajor,
      referralRewardCategoryKeys,
      referralLogChannelId,
      pointsEarnCategoryKeys,
      pointsRedeemCategoryKeys,
    }),
    [
      defaultCurrency,
      guildId,
      guildResources?.botInGuild,
      joinGateCurrentLookupChannelId,
      joinGateEnabled,
      joinGateFallbackChannelId,
      joinGateNewLookupChannelId,
      joinGateTicketCategoryId,
      joinGateVerifiedRoleId,
      myTenants,
      pointValueMajor,
      referralRewardMajor,
      referralRewardCategoryKeys,
      referralLogChannelId,
      pointsEarnCategoryKeys,
      pointsRedeemCategoryKeys,
      selectedDiscordGuild?.name,
      tenantId,
      tipEnabled,
    ],
  );
  const existingCategories = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((product) => product.category.trim())
            .filter((category) => Boolean(category)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [products],
  );
  const categoryTemplateByKey = useMemo(() => {
    const templates = new Map<
      string,
      {
        category: string;
        productId: string;
        questions: QuestionDraft[];
      }
    >();

    for (const product of products) {
      const key = normalizeCategoryKey(product.category);
      if (!key || templates.has(key)) {
        continue;
      }

      templates.set(key, {
        category: product.category.trim(),
        productId: product.id,
        questions: toQuestionDrafts(product.formFields),
      });
    }

    return templates;
  }, [products]);
  const categorySelectOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [...existingCategories, categoryBuilderName.trim()].filter((category) =>
            Boolean(category),
          ),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [categoryBuilderName, existingCategories],
  );
  const selectedExistingCategoryForBuilder = useMemo(() => {
    const normalizedBuilder = normalizeCategoryKey(categoryBuilderName);
    return (
      categorySelectOptions.find(
        (category) => normalizeCategoryKey(category) === normalizedBuilder,
      ) ?? ''
    );
  }, [categoryBuilderName, categorySelectOptions]);
  const pointsCategoryOptions = useMemo(
    () =>
      existingCategories
        .map((category) => ({
          label: category,
          key: normalizeCategoryKey(category),
        }))
        .filter((category) => Boolean(category.key))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [existingCategories],
  );
  const couponProductOptions = useMemo(
    () =>
      products
        .map((product) => ({
          productId: product.id,
          label: `${product.category} / ${product.name}`,
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [products],
  );
  const couponVariantOptions = useMemo(
    () =>
      products
        .flatMap((product) =>
          product.variants.map((variant) => ({
            variantId: variant.id,
            label: `${product.category} / ${product.name} / ${variant.label}`,
          })),
        )
        .sort((left, right) => left.label.localeCompare(right.label)),
    [products],
  );
  const selectedTenantName = myTenants.find((tenant) => tenant.id === tenantId)?.name ?? '';
  const normalizedCheckoutDomain = normalizeCheckoutDomainInput(voodooCheckoutDomain);
  const workspaceSummaryItems = compactSummary(
    tenantId ? `Workspace: ${selectedTenantName || tenantId}` : 'Select workspace',
    guildId ? `Server: ${selectedDiscordGuild?.name ?? guildId}` : 'Select Discord server',
    guildResourcesLoading
      ? 'Checking bot access'
      : serverReady
        ? 'Bot installed'
        : guildId
          ? 'Invite bot to continue'
          : 'Bot status pending',
  );
  const salesSummaryItems = compactSummary(
    paidLogChannelId ? 'Paid log ready' : 'Paid log pending',
    `${selectedStaffRoleIds.length} staff role${selectedStaffRoleIds.length === 1 ? '' : 's'}`,
    tipEnabled ? 'Tips enabled' : 'Tips off',
    referralRewardCategoryKeys.length ||
      pointsEarnCategoryKeys.length ||
      pointsRedeemCategoryKeys.length
      ? 'Rewards configured'
      : 'Rewards optional',
  );
  const paymentSummaryItems = compactSummary(
    normalizedCheckoutDomain ? `Domain: ${normalizedCheckoutDomain}` : 'Checkout domain missing',
    voodooMerchantWalletAddress.trim() ? 'Wallet set' : 'Wallet pending',
    voodooWebhookUrl ? 'Webhook ready' : 'Webhook not generated',
    voodooCryptoGatewayEnabled ? 'Crypto on' : 'Crypto off',
  );
  const couponSummaryItems = compactSummary(
    `${coupons.length} coupon${coupons.length === 1 ? '' : 's'}`,
    editingCouponId ? 'Editing coupon draft' : 'No coupon draft open',
    couponAllowedProductIdsInput.length || couponAllowedVariantIdsInput.length
      ? 'Scoped discount'
      : 'Store-wide discount',
  );
  const catalogSummaryItems = compactSummary(
    `${products.length} product${products.length === 1 ? '' : 's'}`,
    `${existingCategories.length} categor${existingCategories.length === 1 ? 'y' : 'ies'}`,
    editingProductId
      ? 'Editing product draft'
      : productName.trim() || variants.length > 0
        ? 'New product draft in progress'
        : 'No product draft open',
    `${questions.length} checkout question${questions.length === 1 ? '' : 's'}`,
  );
  const superAdminSummaryItems = compactSummary(
    'Global tenant tools',
    botToken.trim() ? 'Token draft present' : 'Token input empty',
  );
  const latestActionSummaryItems = compactSummary(
    state.loading
      ? 'Request running'
      : state.error
        ? 'Last request failed'
        : state.response
          ? 'Last request succeeded'
          : 'No recent actions',
    state.error ? 'Review output for details' : '',
  );
  const catalogOverviewSummaryItems = compactSummary(
    `${products.length} live product${products.length === 1 ? '' : 's'}`,
    `${existingCategories.length} categor${existingCategories.length === 1 ? 'y' : 'ies'}`,
    editingProductId ? 'Edit mode ready' : 'Choose a product to edit',
  );
  const categoryStepSummaryItems = compactSummary(
    categoryBuilderName.trim()
      ? `Category: ${categoryBuilderName.trim()}`
      : 'Choose or type a category',
    `${questions.length} question${questions.length === 1 ? '' : 's'} in draft`,
    selectedExistingCategoryForBuilder ? 'Using existing template' : 'New template flow',
  );
  const productStepSummaryItems = compactSummary(
    productCategory.trim() ? `Category: ${productCategory.trim()}` : 'Product category missing',
    productName.trim() ? `Name: ${productName.trim()}` : 'Product name pending',
    productActive ? 'Marked active' : 'Marked inactive',
  );
  const pricingStepSummaryItems = compactSummary(
    `${variants.length} price option${variants.length === 1 ? '' : 's'}`,
    editingVariantIndex !== null ? 'Editing one price option' : 'Ready for a new price option',
    editingProductId ? 'Save updates when pricing is ready' : 'Finish here to create the product',
  );
  const primaryDashboardSteps = [
    {
      sectionId: 'workspace' as const,
      stepLabel: '01',
      title: 'Workspace',
      summary: buildSummaryPreview(workspaceSummaryItems, 2),
      stateLabel: serverReady ? 'Ready' : tenantId && guildId ? 'Invite bot' : 'Start here',
      stateTone: serverReady ? ('ready' as const) : ('neutral' as const),
    },
    {
      sectionId: 'sales' as const,
      stepLabel: '02',
      title: 'Sales',
      summary: buildSummaryPreview(salesSummaryItems, 2),
      stateLabel:
        paidLogChannelId || selectedStaffRoleIds.length > 0 ? 'Configured' : 'Add settings',
      stateTone:
        paidLogChannelId || selectedStaffRoleIds.length > 0
          ? ('ready' as const)
          : ('neutral' as const),
    },
    {
      sectionId: 'payments' as const,
      stepLabel: '03',
      title: 'Payments',
      summary: buildSummaryPreview(paymentSummaryItems, 2),
      stateLabel:
        normalizedCheckoutDomain && voodooMerchantWalletAddress.trim()
          ? 'Configured'
          : 'Add payment data',
      stateTone:
        normalizedCheckoutDomain && voodooMerchantWalletAddress.trim()
          ? ('ready' as const)
          : ('neutral' as const),
    },
    {
      sectionId: 'coupons' as const,
      stepLabel: '04',
      title: 'Coupons',
      summary: buildSummaryPreview(couponSummaryItems, 2),
      stateLabel:
        coupons.length > 0 ? 'Configured' : couponCodeInput.trim() ? 'Draft open' : 'Optional',
      stateTone: coupons.length > 0 ? ('ready' as const) : ('neutral' as const),
    },
    {
      sectionId: 'catalog' as const,
      stepLabel: '05',
      title: 'Catalog',
      summary: buildSummaryPreview(catalogSummaryItems, 2),
      stateLabel:
        products.length > 0
          ? 'Live'
          : productName.trim() || variants.length > 0
            ? 'Draft open'
            : 'Build now',
      stateTone: products.length > 0 ? ('ready' as const) : ('neutral' as const),
    },
  ];
  const contextStatusTitle = state.loading
    ? 'Saving changes'
    : state.error
      ? 'Action needs attention'
      : state.response
        ? 'Last action succeeded'
        : serverReady
          ? 'Server is ready'
          : tenantId && guildId
            ? 'Install the bot to continue'
            : 'Pick a workspace and server';
  const contextStatusDetail = state.loading
    ? 'Waiting for the latest API response.'
    : state.error
      ? state.error
      : state.response
        ? 'Open Latest Action if you want to review the full response again.'
        : buildSummaryPreview(workspaceSummaryItems);

  const toggleDashboardSection = useCallback((sectionId: DashboardSectionId) => {
    setOpenDashboardSections((current) => toggleExclusivePanel(current, sectionId));
  }, []);

  const focusDashboardSection = useCallback((sectionId: DashboardSectionId) => {
    setOpenDashboardSections(focusPanel(sectionId));
  }, []);

  const toggleCatalogSection = useCallback((sectionId: CatalogSectionId) => {
    setOpenCatalogSections((current) => toggleExclusivePanel(current, sectionId));
  }, []);

  const focusCatalogSection = useCallback(
    (sectionId: CatalogSectionId) => {
      focusDashboardSection('catalog');
      setOpenCatalogSections(focusPanel(sectionId));
    },
    [focusDashboardSection],
  );

  const focusTutorialStep = useCallback(
    (stepId: string) => {
      const target = getDashboardFocusForTutorialStep(stepId);
      focusDashboardSection(target.dashboard);
      if (target.catalog) {
        focusCatalogSection(target.catalog);
      }
    },
    [focusCatalogSection, focusDashboardSection],
  );

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setState({ loading: true, response: '', error: '' });

    try {
      const payload = await action();
      setState({ loading: false, response: JSON.stringify(payload, null, 2), error: '' });
    } catch (error) {
      setState({
        loading: false,
        response: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []);

  const markTutorialSeen = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(DASHBOARD_TUTORIAL_STORAGE_KEY, '1');
    document.cookie = buildDashboardTutorialCookie({
      secure: window.location.protocol === 'https:',
    });
  }, []);

  const runDashboardTutorial = useCallback(
    (options?: { markSeen?: boolean; startAtStepId?: string }) => {
      if (typeof window === 'undefined') {
        return;
      }

      if (options?.markSeen !== false) {
        markTutorialSeen();
      }

      setIsTutorialPromptOpen(false);
      tutorialDriverRef.current?.destroy();
      tutorialExpansionStateRef.current = {
        dashboardSections: [...openDashboardSections],
        catalogSections: [...openCatalogSections],
      };
      setOpenDashboardSections((current) => ensurePanelsOpen(current, DASHBOARD_SECTION_IDS));
      setOpenCatalogSections((current) => ensurePanelsOpen(current, CATALOG_SECTION_IDS));

      const stepDefs = buildDashboardTutorialStepDefs({ isSuperAdmin });
      const steps = buildDashboardTutorialSteps({ isSuperAdmin }).map((step, index) => {
        const stepDef = stepDefs[index];
        const stepWithFocus = stepDef
          ? {
              ...step,
              onHighlightStarted: () => focusTutorialStep(stepDef.id),
            }
          : step;

        if (typeof step.element === 'string' && !document.querySelector(step.element)) {
          const { element: _missingElement, ...stepWithoutElement } = stepWithFocus;
          return stepWithoutElement;
        }

        return stepWithFocus;
      });
      const stepIdToIndex = new Map(stepDefs.map((step, index) => [step.id, index]));
      const sectionJumps = buildDashboardTutorialSectionJumps({ isSuperAdmin });

      const tutorialDriver = driver({
        animate: true,
        smoothScroll: true,
        allowClose: false,
        overlayColor: '#020617',
        overlayOpacity: 0.72,
        stagePadding: 14,
        stageRadius: 14,
        popoverOffset: 16,
        popoverClass: 'dashboard-tour-popover',
        showProgress: true,
        progressText: 'Step {{current}} of {{total}}',
        showButtons: ['previous', 'next'],
        prevBtnText: 'Back',
        nextBtnText: 'Next',
        doneBtnText: 'Finish Tutorial',
        steps,
        onPopoverRender: (popover, options) => {
          if (!popover.wrapper.querySelector('.dashboard-tour-jump')) {
            const jumpContainer = document.createElement('div');
            jumpContainer.className = 'dashboard-tour-jump';

            const jumpLabel = document.createElement('label');
            jumpLabel.className = 'dashboard-tour-jump-label';
            jumpLabel.textContent = 'Jump to section';

            const jumpSelect = document.createElement('select');
            jumpSelect.className = 'dashboard-tour-jump-select';
            jumpSelect.ariaLabel = 'Jump to section';

            for (const section of sectionJumps) {
              const option = document.createElement('option');
              option.value = String(section.stepIndex);
              option.textContent = section.label;
              jumpSelect.appendChild(option);
            }

            const activeIndex =
              typeof options.state.activeIndex === 'number' ? options.state.activeIndex : 0;
            const activeSection = [...sectionJumps]
              .reverse()
              .find((section) => activeIndex >= section.stepIndex);
            if (activeSection) {
              jumpSelect.value = String(activeSection.stepIndex);
            }

            jumpSelect.addEventListener('change', () => {
              const nextStepIndex = Number.parseInt(jumpSelect.value, 10);
              if (Number.isFinite(nextStepIndex)) {
                options.driver.moveTo(nextStepIndex);
              }
            });

            jumpContainer.appendChild(jumpLabel);
            jumpContainer.appendChild(jumpSelect);
            popover.wrapper.insertBefore(jumpContainer, popover.footer);
          }

          if (!popover.footerButtons.querySelector('.dashboard-tour-skip-btn')) {
            const skipButton = document.createElement('button');
            skipButton.type = 'button';
            skipButton.className = 'dashboard-tour-skip-btn';
            skipButton.textContent = 'Skip Tutorial';
            skipButton.addEventListener('click', () => {
              markTutorialSeen();
              options.driver.destroy();
            });
            popover.footerButtons.prepend(skipButton);
          }
        },
        onDestroyed: () => {
          const previousExpansionState = tutorialExpansionStateRef.current;
          if (previousExpansionState) {
            setOpenDashboardSections(previousExpansionState.dashboardSections);
            setOpenCatalogSections(previousExpansionState.catalogSections);
            tutorialExpansionStateRef.current = null;
          }
          tutorialDriverRef.current = null;
        },
      });

      tutorialDriverRef.current = tutorialDriver;
      const startAtStepIndex =
        options?.startAtStepId && stepIdToIndex.has(options.startAtStepId)
          ? (stepIdToIndex.get(options.startAtStepId) ?? 0)
          : 0;
      if (options?.startAtStepId) {
        focusTutorialStep(options.startAtStepId);
      }
      tutorialDriver.drive(startAtStepIndex);
    },
    [focusTutorialStep, isSuperAdmin, markTutorialSeen, openCatalogSections, openDashboardSections],
  );

  const loadSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError('');

    try {
      const response = await fetch('/api/me');
      const responseText = await response.text();
      const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
      const payload = isJson ? safeJsonParse(responseText) : null;

      if (!response.ok) {
        const message =
          payload &&
          typeof payload === 'object' &&
          'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : responseText.startsWith('<!DOCTYPE') || responseText.startsWith('<html')
              ? 'Authentication endpoint returned HTML. Verify nginx is proxying /api to Next.js.'
              : 'Please log in with Discord to continue.';

        setSessionError(message);
        return;
      }

      const mePayload = payload as MeResponse;
      const tenants = Array.isArray(mePayload.tenants) ? mePayload.tenants : [];
      const guilds = Array.isArray(mePayload.discordGuilds) ? mePayload.discordGuilds : [];
      let storedTenantId = '';
      let storedGuildId = '';

      if (typeof window !== 'undefined') {
        const storedRaw = window.localStorage.getItem(DASHBOARD_CONTEXT_STORAGE_KEY);
        if (storedRaw) {
          const parsed = safeJsonParse(storedRaw);
          if (parsed && typeof parsed === 'object') {
            storedTenantId =
              'tenantId' in parsed && typeof parsed.tenantId === 'string' ? parsed.tenantId : '';
            storedGuildId =
              'guildId' in parsed && typeof parsed.guildId === 'string' ? parsed.guildId : '';
          }
        }
      }

      setIsSuperAdmin(Boolean(mePayload.me.isSuperAdmin));
      setMyTenants(tenants);
      setDiscordGuilds(guilds);
      setDiscordGuildsError(mePayload.discordGuildsError || '');
      setTenantId((current) => {
        if (current && tenants.some((tenant) => tenant.id === current)) {
          return current;
        }

        if (storedTenantId && tenants.some((tenant) => tenant.id === storedTenantId)) {
          return storedTenantId;
        }

        if (mePayload.me.tenantIds.length === 1) {
          return mePayload.me.tenantIds[0] ?? '';
        }

        return tenants[0]?.id ?? '';
      });
      setGuildId((current) => {
        if (current && guilds.some((guild) => guild.id === current)) {
          return current;
        }

        if (storedGuildId && guilds.some((guild) => guild.id === storedGuildId)) {
          return storedGuildId;
        }

        return guilds[0]?.id ?? '';
      });
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Unable to load session');
    } finally {
      setSessionLoading(false);
    }
  }, []);

  const loadGuildResources = useCallback(async (targetGuildId: string) => {
    if (!targetGuildId) {
      setGuildResources(null);
      setGuildResourcesError('');
      return;
    }

    setGuildResourcesLoading(true);
    setGuildResourcesError('');
    try {
      const payload = (await apiCall(
        `/api/discord/guilds/${encodeURIComponent(targetGuildId)}/resources`,
      )) as GuildResources;
      setGuildResources(payload);
    } catch (error) {
      setGuildResources(null);
      setGuildResourcesError(
        error instanceof Error ? error.message : 'Unable to load server metadata',
      );
    } finally {
      setGuildResourcesLoading(false);
    }
  }, []);

  const ensureGuildLinked = useCallback(
    async (workspaceId: string, discordServerId: string): Promise<void> => {
      if (!workspaceId || !discordServerId || guildLinking) {
        return;
      }

      const key = `${workspaceId}:${discordServerId}`;
      if (linkedContextKeys[key]) {
        return;
      }

      const selectedGuildName = discordGuilds.find((guild) => guild.id === discordServerId)?.name;
      if (!selectedGuildName) {
        return;
      }

      setGuildLinking(true);
      try {
        await apiCall(`/api/guilds/${encodeURIComponent(discordServerId)}/connect`, 'POST', {
          tenantId: workspaceId,
          guildName: selectedGuildName,
        });
        setLinkedContextKeys((current) => ({ ...current, [key]: true }));
      } finally {
        setGuildLinking(false);
      }
    },
    [discordGuilds, guildLinking, linkedContextKeys],
  );

  const hydrateContextData = useCallback(async () => {
    const selectedTenantId = tenantId.trim();
    const selectedGuildId = guildId.trim();
    if (!selectedTenantId || !selectedGuildId) {
      return;
    }

    try {
      const configPayload = (await apiCall(
        `/api/guilds/${encodeURIComponent(selectedGuildId)}/config?tenantId=${encodeURIComponent(selectedTenantId)}`,
      )) as {
        config?: GuildConfigRecord;
      };

      if (configPayload.config) {
        setPaidLogChannelId(normalizeDiscordId(configPayload.config.paidLogChannelId));
        setSelectedStaffRoleIds(normalizeDiscordIdList(configPayload.config.staffRoleIds));
        setDefaultCurrency(configPayload.config.defaultCurrency || DEFAULT_CURRENCY);
        setTipEnabled(Boolean(configPayload.config.tipEnabled));
        setJoinGateEnabled(Boolean(configPayload.config.joinGateEnabled));
        setJoinGateFallbackChannelId(
          normalizeDiscordId(configPayload.config.joinGateFallbackChannelId),
        );
        setJoinGateVerifiedRoleId(normalizeDiscordId(configPayload.config.joinGateVerifiedRoleId));
        setJoinGateTicketCategoryId(
          normalizeDiscordId(configPayload.config.joinGateTicketCategoryId),
        );
        setJoinGateCurrentLookupChannelId(
          normalizeDiscordId(configPayload.config.joinGateCurrentLookupChannelId),
        );
        setJoinGateNewLookupChannelId(
          normalizeDiscordId(configPayload.config.joinGateNewLookupChannelId),
        );
        setPointsEarnCategoryKeys(
          Array.isArray(configPayload.config.pointsEarnCategoryKeys)
            ? configPayload.config.pointsEarnCategoryKeys
                .map((value) => normalizeCategoryKey(value))
                .filter(Boolean)
            : [],
        );
        setPointsRedeemCategoryKeys(
          Array.isArray(configPayload.config.pointsRedeemCategoryKeys)
            ? configPayload.config.pointsRedeemCategoryKeys
                .map((value) => normalizeCategoryKey(value))
                .filter(Boolean)
            : [],
        );
        setPointValueMajor(formatPointValueMinorToMajor(configPayload.config.pointValueMinor));
        const nextReferralRewardMajor = formatMinorToMajor(
          configPayload.config.referralRewardMinor,
        );
        setReferralRewardMajor(nextReferralRewardMajor);
        setVariantReferralRewardInput(nextReferralRewardMajor);
        setReferralRewardCategoryKeys(
          Array.isArray(configPayload.config.referralRewardCategoryKeys)
            ? configPayload.config.referralRewardCategoryKeys
                .map((value) => normalizeCategoryKey(value))
                .filter(Boolean)
            : [],
        );
        setReferralLogChannelId(normalizeDiscordId(configPayload.config.referralLogChannelId));
        setReferralThankYouTemplate(
          configPayload.config.referralThankYouTemplate || DEFAULT_REFERRAL_THANK_YOU_TEMPLATE,
        );
        setReferralSubmissionTemplate(
          configPayload.config.referralSubmissionTemplate || DEFAULT_REFERRAL_SUBMISSION_TEMPLATE,
        );
      }
    } catch {
      // Keep current values on transient fetch failures to avoid clearing the form after save.
    }

    try {
      const integrationPayload = (await apiCall(
        `/api/guilds/${encodeURIComponent(selectedGuildId)}/integrations/voodoopay?tenantId=${encodeURIComponent(selectedTenantId)}`,
      )) as {
        integration: null | {
          merchantWalletAddress: string;
          cryptoGatewayEnabled: boolean;
          cryptoAddFees: boolean;
          cryptoWallets?: {
            evm: string | null;
            btc: string | null;
            bitcoincash: string | null;
            ltc: string | null;
            doge: string | null;
            trc20: string | null;
            solana: string | null;
          } | null;
          checkoutDomain: string;
          tenantWebhookKey: string;
          webhookUrl: string;
        };
      };

      if (integrationPayload.integration) {
        const cryptoWallets = integrationPayload.integration.cryptoWallets ?? null;
        setVoodooMerchantWalletAddress(integrationPayload.integration.merchantWalletAddress);
        setVoodooCryptoGatewayEnabled(Boolean(integrationPayload.integration.cryptoGatewayEnabled));
        setVoodooCryptoAddFees(Boolean(integrationPayload.integration.cryptoAddFees));
        setVoodooCryptoWallets({
          evm: cryptoWallets?.evm ?? '',
          btc: cryptoWallets?.btc ?? '',
          bitcoincash: cryptoWallets?.bitcoincash ?? '',
          ltc: cryptoWallets?.ltc ?? '',
          doge: cryptoWallets?.doge ?? '',
          trc20: cryptoWallets?.trc20 ?? '',
          solana: cryptoWallets?.solana ?? '',
        });
        setVoodooCheckoutDomain(integrationPayload.integration.checkoutDomain);
        setVoodooWebhookKey(integrationPayload.integration.tenantWebhookKey);
        setVoodooWebhookUrl(integrationPayload.integration.webhookUrl);
      } else {
        setVoodooMerchantWalletAddress('');
        setVoodooCryptoGatewayEnabled(false);
        setVoodooCryptoAddFees(false);
        setVoodooCryptoWallets(EMPTY_VOODOO_CRYPTO_WALLETS);
        setVoodooCheckoutDomain(DEFAULT_VOODOO_CHECKOUT_DOMAIN);
        setVoodooWebhookKey('');
        setVoodooWebhookUrl('');
      }
    } catch {
      setVoodooMerchantWalletAddress('');
      setVoodooCryptoGatewayEnabled(false);
      setVoodooCryptoAddFees(false);
      setVoodooCryptoWallets(EMPTY_VOODOO_CRYPTO_WALLETS);
      setVoodooCheckoutDomain(DEFAULT_VOODOO_CHECKOUT_DOMAIN);
      setVoodooWebhookKey('');
      setVoodooWebhookUrl('');
    }

    setProductsLoading(true);
    try {
      const productsPayload = (await apiCall(
        `/api/guilds/${encodeURIComponent(selectedGuildId)}/products?tenantId=${encodeURIComponent(selectedTenantId)}`,
      )) as { products?: ProductRecord[] };
      setProducts(Array.isArray(productsPayload.products) ? productsPayload.products : []);
    } catch {
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }

    try {
      const couponsPayload = (await apiCall(
        `/api/guilds/${encodeURIComponent(selectedGuildId)}/coupons?tenantId=${encodeURIComponent(selectedTenantId)}`,
      )) as {
        coupons?: CouponRecord[];
      };
      setCoupons(
        Array.isArray(couponsPayload.coupons)
          ? couponsPayload.coupons.map((coupon) => normalizeCouponRecord(coupon))
          : [],
      );
    } catch {
      setCoupons([]);
    }

    setPointsCustomersLoading(true);
    try {
      const pointsPayload = (await apiCall(
        `/api/guilds/${encodeURIComponent(selectedGuildId)}/points/customers?tenantId=${encodeURIComponent(selectedTenantId)}`,
      )) as { customers?: PointsCustomerRecord[] };
      setPointsCustomers(Array.isArray(pointsPayload.customers) ? pointsPayload.customers : []);
    } catch {
      setPointsCustomers([]);
    } finally {
      setPointsCustomersLoading(false);
    }
  }, [guildId, myTenants, tenantId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (sessionLoading || sessionError) {
      setIsTutorialPromptOpen(false);
      return;
    }

    const localMarker = window.localStorage.getItem(DASHBOARD_TUTORIAL_STORAGE_KEY);
    const hasSeenTutorial = hasDashboardTutorialMarker(document.cookie, localMarker);
    setIsTutorialPromptOpen(!hasSeenTutorial);
  }, [sessionError, sessionLoading]);

  useEffect(
    () => () => {
      tutorialDriverRef.current?.destroy();
      tutorialDriverRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      DASHBOARD_CONTEXT_STORAGE_KEY,
      JSON.stringify({
        tenantId,
        guildId,
      }),
    );
  }, [guildId, tenantId]);

  useEffect(() => {
    void loadGuildResources(guildId);
  }, [guildId, loadGuildResources]);

  useEffect(() => {
    setPaidLogChannelId('');
    setSelectedStaffRoleIds([]);
    setDefaultCurrency(DEFAULT_CURRENCY);
    setTipEnabled(false);
    setJoinGateEnabled(false);
    setJoinGateFallbackChannelId('');
    setJoinGateVerifiedRoleId('');
    setJoinGateTicketCategoryId('');
    setJoinGateCurrentLookupChannelId('');
    setJoinGateNewLookupChannelId('');
    setPointValueMajor(DEFAULT_POINT_VALUE_MAJOR);
    setReferralRewardMajor(DEFAULT_REFERRAL_REWARD_MAJOR);
    setReferralRewardCategoryKeys([]);
    setReferralLogChannelId('');
    setReferralThankYouTemplate(DEFAULT_REFERRAL_THANK_YOU_TEMPLATE);
    setReferralSubmissionTemplate(DEFAULT_REFERRAL_SUBMISSION_TEMPLATE);
    setPointsEarnCategoryKeys([]);
    setPointsRedeemCategoryKeys([]);
    setPointsCustomers([]);
    setPointsCustomersLoading(false);
    setPointsSearchInput('');
    setPointsAdjustEmail('');
    setPointsAdjustValueInput('1');
    setProducts([]);
    setEditingProductId(null);
    setCoupons([]);
    setEditingCouponId(null);
    setCouponCodeInput('');
    setCouponDiscountInput('1.00');
    setCouponActiveInput(true);
    setCouponAllowedProductIdsInput([]);
    setCouponAllowedVariantIdsInput([]);
    setCategoryBuilderName('Accounts');
    setCategoryRenameTo('');
    setProductCategory('Accounts');
    setProductName('');
    setProductDescription('');
    setProductActive(true);
    setVariantLabelInput('');
    setVariantPriceInput('');
    setVariantReferralRewardInput('');
    setEditingVariantIndex(null);
    setQuestionKeyInput('');
    setQuestionLabelInput('');
    setQuestionTypeInput('short_text');
    setQuestionRequiredInput(true);
    setQuestionSensitiveInput(false);
    setQuestions(getDefaultQuestions());
    setVoodooMerchantWalletAddress('');
    setVoodooCryptoGatewayEnabled(false);
    setVoodooCryptoAddFees(false);
    setVoodooCryptoWallets(EMPTY_VOODOO_CRYPTO_WALLETS);
    setVoodooCheckoutDomain(DEFAULT_VOODOO_CHECKOUT_DOMAIN);
    setVoodooWebhookKey('');
    setVoodooWebhookUrl('');
    setAutoGeneratedCallbackSecret('');
  }, [tenantId, guildId]);

  useEffect(() => {
    if (!tenantId || !guildId) {
      return;
    }

    void hydrateContextData();
  }, [guildId, hydrateContextData, tenantId]);

  function requireWorkspaceAndServer(options?: { requireBot?: boolean }): {
    workspaceId: string;
    discordServerId: string;
  } {
    const workspaceId = tenantId.trim();
    const discordServerId = guildId.trim();

    if (!workspaceId) {
      throw new Error('Select a workspace first.');
    }

    if (!discordServerId) {
      throw new Error('Select a Discord server first.');
    }

    if (options?.requireBot && !guildResources?.botInGuild) {
      throw new Error('Add the bot to this server first, then try again.');
    }

    return {
      workspaceId,
      discordServerId,
    };
  }

  function addPriceOption() {
    focusCatalogSection('pricing');

    if (!variantLabelInput.trim()) {
      setState({ loading: false, response: '', error: 'Price option label is required.' });
      return;
    }

    const normalizedReferralRewardInput = variantReferralRewardInput.trim() || referralRewardMajor;

    try {
      parsePriceToMinor(variantPriceInput);
      parsePriceToMinor(normalizedReferralRewardInput);
    } catch (error) {
      setState({
        loading: false,
        response: '',
        error: error instanceof Error ? error.message : 'Invalid price',
      });
      return;
    }

    const draft: PriceOptionDraft = {
      label: variantLabelInput.trim(),
      priceMajor: variantPriceInput.trim(),
      referralRewardMajor: normalizedReferralRewardInput,
      currency: DEFAULT_CURRENCY,
    };

    if (editingVariantIndex !== null) {
      setVariants((current) =>
        current.map((entry, index) => (index === editingVariantIndex ? draft : entry)),
      );
    } else {
      setVariants((current) => [...current, draft]);
    }

    setEditingVariantIndex(null);
    setVariantLabelInput('');
    setVariantPriceInput('');
    setVariantReferralRewardInput('');
  }

  function removePriceOption(index: number) {
    focusCatalogSection('pricing');
    setVariants((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setEditingVariantIndex((current) => {
      if (current === null) {
        return null;
      }
      if (current === index) {
        return null;
      }
      if (current > index) {
        return current - 1;
      }
      return current;
    });
  }

  function editPriceOption(index: number): void {
    focusCatalogSection('pricing');
    const variant = variants[index];
    if (!variant) {
      return;
    }

    setEditingVariantIndex(index);
    setVariantLabelInput(variant.label);
    setVariantPriceInput(variant.priceMajor);
    setVariantReferralRewardInput(variant.referralRewardMajor);
  }

  function cancelPriceOptionEdit(): void {
    setEditingVariantIndex(null);
    setVariantLabelInput('');
    setVariantPriceInput('');
    setVariantReferralRewardInput('');
  }

  function addQuestion() {
    focusCatalogSection('category');

    if (!questionKeyInput.trim() || !questionLabelInput.trim()) {
      setState({
        loading: false,
        response: '',
        error: 'Question key and question label are required.',
      });
      return;
    }

    const normalizedKey = questionKeyInput.trim().toLowerCase();
    if (questions.some((question) => question.key.trim().toLowerCase() === normalizedKey)) {
      setState({
        loading: false,
        response: '',
        error: 'Question key must be unique per category.',
      });
      return;
    }

    setQuestions((current) => [
      ...current,
      {
        key: questionKeyInput.trim(),
        label: questionLabelInput.trim(),
        fieldType: questionTypeInput,
        required: questionRequiredInput,
        sensitive: questionSensitiveInput,
        sortOrder: current.length,
      },
    ]);
    setQuestionKeyInput('');
    setQuestionLabelInput('');
    setQuestionTypeInput('short_text');
    setQuestionRequiredInput(true);
    setQuestionSensitiveInput(false);
  }

  function removeQuestion(index: number) {
    const targetQuestion = questions[index];
    if (targetQuestion && targetQuestion.key.trim().toLowerCase() === REQUIRED_EMAIL_QUESTION_KEY) {
      setState({
        loading: false,
        response: '',
        error: 'Email is a required system question and cannot be removed.',
      });
      return;
    }

    setQuestions((current) =>
      ensureRequiredEmailQuestion(
        current
          .filter((_, currentIndex) => currentIndex !== index)
          .map((question, sortOrder) => ({ ...question, sortOrder })),
      ),
    );
  }

  function prepareQuestionsForApi(): QuestionDraft[] {
    const seenQuestionKeys = new Set<string>();
    const normalizedQuestions = ensureRequiredEmailQuestion(questions);
    return normalizedQuestions.map((question, sortOrder) => {
      const key = question.key.trim();
      const label = question.label.trim();
      const normalizedKey = key.toLowerCase();

      if (!key) {
        throw new Error('Question key is required.');
      }

      if (!label) {
        throw new Error(`Question label is required for key "${key}".`);
      }

      if (seenQuestionKeys.has(normalizedKey)) {
        throw new Error(`Question key "${key}" is duplicated. Use unique keys.`);
      }
      seenQuestionKeys.add(normalizedKey);

      const isRequiredEmailField = normalizedKey === REQUIRED_EMAIL_QUESTION_KEY;

      return {
        ...question,
        key: isRequiredEmailField ? REQUIRED_EMAIL_QUESTION_KEY : key,
        label: isRequiredEmailField ? REQUIRED_EMAIL_QUESTION_LABEL : label,
        fieldType: isRequiredEmailField ? 'email' : question.fieldType,
        required: isRequiredEmailField ? true : question.required,
        sensitive: isRequiredEmailField ? false : question.sensitive,
        sortOrder,
      };
    });
  }

  function loadQuestionsForCategory(category: string): void {
    focusCatalogSection('category');
    const normalizedCategory = category.trim();
    setCategoryBuilderName(normalizedCategory);
    if (normalizedCategory) {
      setProductCategory(normalizedCategory);
    }
    setQuestionKeyInput('');
    setQuestionLabelInput('');
    setQuestionTypeInput('short_text');
    setQuestionRequiredInput(true);
    setQuestionSensitiveInput(false);

    const template = categoryTemplateByKey.get(normalizeCategoryKey(normalizedCategory));
    if (!template) {
      setQuestions(getDefaultQuestions());
      return;
    }

    setQuestions(
      ensureRequiredEmailQuestion(
        template.questions.map((question, sortOrder) => ({ ...question, sortOrder })),
      ),
    );
  }

  async function refreshProducts(): Promise<ProductRecord[]> {
    const context = requireWorkspaceAndServer({ requireBot: true });
    const payload = (await apiCall(
      `/api/guilds/${encodeURIComponent(context.discordServerId)}/products?tenantId=${encodeURIComponent(context.workspaceId)}`,
    )) as { products?: ProductRecord[] };
    const nextProducts = Array.isArray(payload.products) ? payload.products : [];
    setProducts(nextProducts);
    return nextProducts;
  }

  async function refreshCoupons(): Promise<CouponRecord[]> {
    const context = requireWorkspaceAndServer({ requireBot: true });
    const payload = (await apiCall(
      `/api/guilds/${encodeURIComponent(context.discordServerId)}/coupons?tenantId=${encodeURIComponent(context.workspaceId)}`,
    )) as { coupons?: CouponRecord[] };
    const nextCoupons = Array.isArray(payload.coupons)
      ? payload.coupons.map((coupon) => normalizeCouponRecord(coupon))
      : [];
    setCoupons(nextCoupons);
    return nextCoupons;
  }

  async function refreshPointsCustomers(
    search = pointsSearchInput,
  ): Promise<PointsCustomerRecord[]> {
    const context = requireWorkspaceAndServer({ requireBot: true });

    setPointsCustomersLoading(true);
    try {
      const query = new URLSearchParams({
        tenantId: context.workspaceId,
      });

      if (search.trim()) {
        query.set('search', search.trim());
      }

      const payload = (await apiCall(
        `/api/guilds/${encodeURIComponent(context.discordServerId)}/points/customers?${query.toString()}`,
      )) as {
        customers?: PointsCustomerRecord[];
      };
      const customers = Array.isArray(payload.customers) ? payload.customers : [];
      setPointsCustomers(customers);
      return customers;
    } finally {
      setPointsCustomersLoading(false);
    }
  }

  function togglePointsCategory(
    category: string,
    setter: (updater: (current: string[]) => string[]) => void,
  ): void {
    const key = normalizeCategoryKey(category);
    if (!key) {
      return;
    }

    setter((current) => {
      if (current.includes(key)) {
        return current.filter((entry) => entry !== key);
      }

      return [...current, key];
    });
  }

  function toggleIdList(
    id: string,
    setter: (updater: (current: string[]) => string[]) => void,
  ): void {
    const normalized = id.trim();
    if (!normalized) {
      return;
    }

    setter((current) => {
      if (current.includes(normalized)) {
        return current.filter((entry) => entry !== normalized);
      }

      return [...current, normalized];
    });
  }

  function setVoodooCryptoWallet(key: keyof VoodooCryptoWallets, value: string): void {
    setVoodooCryptoWallets((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function resetCouponBuilder(): void {
    setEditingCouponId(null);
    setCouponCodeInput('');
    setCouponDiscountInput('1.00');
    setCouponActiveInput(true);
    setCouponAllowedProductIdsInput([]);
    setCouponAllowedVariantIdsInput([]);
  }

  function loadCouponIntoBuilder(coupon: CouponRecord): void {
    focusDashboardSection('coupons');
    setEditingCouponId(coupon.id);
    setCouponCodeInput(coupon.code);
    setCouponDiscountInput((coupon.discountMinor / 100).toFixed(2));
    setCouponActiveInput(coupon.active);
    setCouponAllowedProductIdsInput(
      Array.isArray(coupon.allowedProductIds) ? coupon.allowedProductIds : [],
    );
    setCouponAllowedVariantIdsInput(
      Array.isArray(coupon.allowedVariantIds) ? coupon.allowedVariantIds : [],
    );
  }

  function resetProductBuilder(options?: { keepCategory?: string }): void {
    focusCatalogSection('product');
    setEditingProductId(null);
    setProductCategory(options?.keepCategory?.trim() || categoryBuilderName.trim() || 'Accounts');
    setProductName('');
    setProductDescription('');
    setProductActive(true);
    setVariants([]);
    setVariantLabelInput('');
    setVariantPriceInput('');
    setVariantReferralRewardInput('');
    setEditingVariantIndex(null);
  }

  function loadProductIntoBuilder(product: ProductRecord): void {
    focusCatalogSection('product');
    focusCatalogSection('pricing');
    setEditingProductId(product.id);
    setCategoryBuilderName(product.category);
    setProductCategory(product.category);
    setProductName(product.name);
    setProductDescription(product.description);
    setProductActive(product.active);
    setVariants(
      product.variants.map((variant) => ({
        label: variant.label,
        priceMajor: (variant.priceMinor / 100).toFixed(2),
        referralRewardMajor: (variant.referralRewardMinor / 100).toFixed(2),
        currency: variant.currency,
      })),
    );
    setVariantLabelInput('');
    setVariantPriceInput('');
    setVariantReferralRewardInput('');
    setEditingVariantIndex(null);
    setQuestionKeyInput('');
    setQuestionLabelInput('');
    setQuestionTypeInput('short_text');
    setQuestionRequiredInput(true);
    setQuestionSensitiveInput(false);
    setQuestions(toQuestionDrafts(product.formFields));
  }

  if (sessionLoading) {
    return (
      <main className="relative flex min-h-screen items-center justify-center px-4">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45rem_30rem_at_10%_-10%,rgba(56,189,248,0.25),transparent),radial-gradient(40rem_30rem_at_90%_0%,rgba(20,184,166,0.2),transparent),radial-gradient(35rem_30rem_at_50%_120%,rgba(249,115,22,0.16),transparent)]" />
        <Card className="w-full max-w-lg border-border/70 bg-card/80 shadow-2xl shadow-black/20 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Loader2 className="size-4 animate-spin" />
              Loading Dashboard
            </CardTitle>
            <CardDescription>Checking your Discord login session...</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (sessionError) {
    return (
      <main className="relative flex min-h-screen items-center justify-center px-4">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45rem_30rem_at_10%_-10%,rgba(56,189,248,0.25),transparent),radial-gradient(40rem_30rem_at_90%_0%,rgba(20,184,166,0.2),transparent),radial-gradient(35rem_30rem_at_50%_120%,rgba(249,115,22,0.16),transparent)]" />
        <Card className="w-full max-w-lg border-border/70 bg-card/80 shadow-2xl shadow-black/20 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-xl">Login Required</CardTitle>
            <CardDescription>{sessionError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/api/auth/discord/login">Login with Discord</a>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden pb-10">
      {isTutorialPromptOpen ? (
        <TutorialLaunchModal
          onRunTutorial={() => runDashboardTutorial({ markSeen: true })}
          onSkipTutorial={() => {
            markTutorialSeen();
            setIsTutorialPromptOpen(false);
          }}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45rem_30rem_at_10%_-10%,rgba(56,189,248,0.25),transparent),radial-gradient(40rem_30rem_at_90%_0%,rgba(20,184,166,0.2),transparent),radial-gradient(35rem_30rem_at_50%_120%,rgba(249,115,22,0.16),transparent)]" />

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-3 rounded-full border border-border/60 bg-card/85 px-4 py-2 shadow-sm backdrop-blur">
              <Image
                src={lightModeLogo}
                alt="Dashboard logo"
                priority
                className="h-8 w-auto dark:hidden"
              />
              <Image
                src={darkModeLogo}
                alt="Dashboard logo"
                priority
                className="hidden h-8 w-auto dark:block"
              />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Voodoo Pay
                </p>
                <p className="truncate text-sm font-semibold text-foreground">Merchant Dashboard</p>
              </div>
            </div>
            <ModeToggle />
          </div>

          <Card className="border-border/70 bg-card/80 shadow-lg shadow-black/10 backdrop-blur">
            <CardContent className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3" data-tutorial="dashboard-title">
                <Badge
                  variant="secondary"
                  className="w-fit border border-border/60 bg-background/75 px-3 py-1 text-[11px] uppercase"
                >
                  Merchant Dashboard
                </Badge>
                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
                    Simple setup, one section at a time.
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Pick the workspace and Discord server first, then work through the cards below.
                    The dashboard is mobile-first and keeps one main section open at a time so the
                    flow stays easy to follow.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:max-w-sm lg:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full sm:w-auto"
                  data-tutorial="run-tutorial-button"
                  onClick={() => runDashboardTutorial({ markSeen: true })}
                >
                  Run Tutorial
                </Button>
                <Button asChild type="button" variant="outline" className="min-h-11 w-full sm:w-auto">
                  <a href="https://voodoopay.online/" target="_blank" rel="noreferrer">
                    <Globe className="size-4" />
                    Visit Website
                  </a>
                </Button>
                <Badge
                  variant={isSuperAdmin ? 'default' : 'outline'}
                  className="min-h-11 justify-center px-3 py-1.5"
                >
                  {isSuperAdmin ? 'Super Admin Session' : 'Tenant Session'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </header>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.85fr)]">
          <Card className="border-border/70 bg-card/75 shadow-lg shadow-black/10 backdrop-blur">
            <CardHeader className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardTitle className="text-lg">Setup Flow</CardTitle>
              <CardDescription>
                Use this as a simple checklist. On mobile the steps stack vertically, so you can
                tap the next section directly without swiping.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-4 sm:p-5 sm:pt-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {primaryDashboardSteps.map((step) => (
                  <DashboardQuickStepButton
                    key={step.sectionId}
                    active={openDashboardSections.includes(step.sectionId)}
                    onClick={() => focusDashboardSection(step.sectionId)}
                    stateLabel={step.stateLabel}
                    stateTone={step.stateTone}
                    stepLabel={step.stepLabel}
                    summary={step.summary}
                    title={step.title}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/75 shadow-lg shadow-black/10 backdrop-blur">
            <CardHeader className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardTitle className="text-lg">Current Context</CardTitle>
              <CardDescription>
                A compact status card for mobile so you always know what this dashboard is working
                against.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-4 sm:p-5 sm:pt-4">
              <div className="space-y-2 rounded-[1.5rem] border border-border/60 bg-background/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Workspace
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {selectedTenantName || 'No workspace selected yet'}
                </p>
              </div>

              <div className="space-y-2 rounded-[1.5rem] border border-border/60 bg-background/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Discord Server
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {selectedDiscordGuild?.name ?? 'No Discord server selected yet'}
                </p>
              </div>

              <div className="space-y-2 rounded-[1.5rem] border border-border/60 bg-background/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Status
                </p>
                <p className="text-sm font-semibold text-foreground">{contextStatusTitle}</p>
                <p className="text-xs leading-5 text-muted-foreground">{contextStatusDetail}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={openDashboardSections.includes('latest-action') ? 'default' : 'outline'}
                  onClick={() => focusDashboardSection('latest-action')}
                >
                  Latest Action
                </Button>
                {isSuperAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={openDashboardSections.includes('super-admin') ? 'default' : 'outline'}
                    onClick={() => focusDashboardSection('super-admin')}
                  >
                    Super Admin
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4">
          <Card className="border-border/70 bg-card/75 shadow-lg shadow-black/10 backdrop-blur">
            <DashboardSectionHeader
              sectionId="workspace"
              isOpen={openDashboardSections.includes('workspace')}
              onToggle={toggleDashboardSection}
              icon={Store}
              stepLabel="01"
              title="Workspace & Server"
              description="Start here. Choose the merchant workspace and Discord server before editing any setup below."
              summaryItems={workspaceSummaryItems}
              action={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Show tutorial info for Workspace and Server"
                  onClick={() =>
                    runDashboardTutorial({ markSeen: true, startAtStepId: 'workspace-select' })
                  }
                >
                  <Info className="size-4" />
                </Button>
              }
            />
            {openDashboardSections.includes('workspace') ? (
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="workspace-select">Workspace</Label>
                    <select
                      id="workspace-select"
                      className={nativeSelectClass}
                      value={tenantId}
                      onChange={(event) => {
                        setTenantId(event.target.value);
                        setLinkedContextKeys({});
                        setTelegramLinkCommand('');
                        setTelegramLinkExpiresAt('');
                        setTelegramBotUsername('');
                      }}
                      disabled={myTenants.length === 0}
                    >
                      <option value="">
                        {myTenants.length === 0
                          ? 'No workspaces available yet'
                          : 'Select workspace'}
                      </option>
                      {myTenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name} ({tenant.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="discord-server-select">Discord Server</Label>
                    <select
                      id="discord-server-select"
                      className={nativeSelectClass}
                      value={guildId}
                      onChange={(event) => {
                        setGuildId(event.target.value);
                        setLinkedContextKeys({});
                        setTelegramLinkCommand('');
                        setTelegramLinkExpiresAt('');
                        setTelegramBotUsername('');
                      }}
                      disabled={discordGuilds.length === 0}
                    >
                      <option value="">
                        {discordGuilds.length === 0
                          ? 'No manageable Discord servers found'
                          : 'Select Discord server'}
                      </option>
                      {discordGuilds.map((guild) => (
                        <option key={guild.id} value={guild.id}>
                          {guild.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    data-tutorial="workspace-create-toggle"
                    onClick={() => setShowCreateWorkspace((current) => !current)}
                  >
                    {showCreateWorkspace ? 'Cancel New Workspace' : 'Create New Workspace'}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    data-tutorial="workspace-delete"
                    disabled={state.loading || !tenantId}
                    onClick={() =>
                      runAction(async () => {
                        const selectedTenant = myTenants.find((tenant) => tenant.id === tenantId);
                        if (!selectedTenant) {
                          throw new Error('Select a workspace to delete.');
                        }

                        const confirmed = window.confirm(
                          `Delete workspace "${selectedTenant.name}" and all associated data? This cannot be undone.`,
                        );
                        if (!confirmed) {
                          return { cancelled: true };
                        }

                        await apiCall(
                          `/api/tenants/${encodeURIComponent(selectedTenant.id)}`,
                          'DELETE',
                        );
                        await loadSession();
                        setLinkedContextKeys({});
                        return { deletedWorkspaceId: selectedTenant.id };
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                    Delete Workspace
                  </Button>
                </div>

                <div className="rounded-lg border border-border/60 bg-secondary/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Telegram Group Link</p>
                      <p className="text-sm text-muted-foreground">
                        Link one Telegram group to the selected Discord-configured store without
                        duplicating catalog or checkout settings.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={state.loading || !tenantId || !guildId}
                      onClick={() =>
                        runAction(async () => {
                          const { workspaceId, discordServerId } = requireWorkspaceAndServer();
                          const payload = (await apiCall(
                            `/api/guilds/${encodeURIComponent(discordServerId)}/telegram-link-token`,
                            'POST',
                            { tenantId: workspaceId },
                          )) as {
                            botUsername?: string | null;
                            command?: string;
                            expiresAt?: string;
                          };

                          setTelegramLinkCommand(payload.command ?? '');
                          setTelegramLinkExpiresAt(payload.expiresAt ?? '');
                          setTelegramBotUsername((payload.botUsername ?? '').trim());
                          return payload;
                        })
                      }
                    >
                      Generate Telegram Command
                    </Button>
                    {telegramBotUsername.trim() ? (
                      <Button asChild type="button" variant="outline">
                        <a
                          href={`https://t.me/${telegramBotUsername.replace(/^@+/u, '')}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open @{telegramBotUsername.replace(/^@+/u, '')}
                        </a>
                      </Button>
                    ) : null}
                  </div>

                  {telegramLinkCommand ? (
                    <div className="mt-3 space-y-2">
                      <Label htmlFor="telegram-link-command">Telegram Admin Command</Label>
                      <Input id="telegram-link-command" readOnly value={telegramLinkCommand} />
                      <p className="text-xs text-muted-foreground">
                        1. Add{' '}
                        {telegramBotUsername ? `@${telegramBotUsername}` : 'your Telegram bot'} to
                        the target group.
                        <br />
                        2. Send the command above as a Telegram group admin.
                        <br />
                        3. This token expires{' '}
                        {telegramLinkExpiresAt
                          ? `at ${new Date(telegramLinkExpiresAt).toLocaleString()}.`
                          : 'soon.'}
                      </p>
                    </div>
                  ) : null}
                </div>

                {showCreateWorkspace ? (
                  <div className="rounded-lg border border-border/60 bg-secondary/35 p-3">
                    <div className="space-y-2">
                      <Label htmlFor="workspace-name">New Workspace Name</Label>
                      <Input
                        id="workspace-name"
                        value={createTenantName}
                        onChange={(event) => setCreateTenantName(event.target.value)}
                      />
                    </div>
                    <div className="mt-3">
                      <Button
                        type="button"
                        disabled={state.loading}
                        onClick={() =>
                          runAction(async () => {
                            if (!createTenantName.trim()) {
                              throw new Error('Workspace name is required.');
                            }

                            const payload = (await apiCall('/api/tenants', 'POST', {
                              name: createTenantName.trim(),
                            })) as { tenant?: { id: string } };

                            setCreateTenantName('');
                            await loadSession();
                            if (payload.tenant?.id) {
                              setTenantId(payload.tenant.id);
                            }
                            return payload;
                          })
                        }
                      >
                        Create Workspace
                      </Button>
                    </div>
                  </div>
                ) : null}

                {discordGuildsError ? (
                  <p className="text-xs text-destructive">
                    {discordGuildsError}{' '}
                    <a href="/api/auth/discord/login" className="underline">
                      Reconnect Discord
                    </a>
                  </p>
                ) : null}

                {guildResourcesLoading ? (
                  <div
                    data-tutorial="bot-install-status"
                    className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
                  >
                    <Loader2 className="size-4 animate-spin" />
                    Checking bot status and loading channels/roles...
                  </div>
                ) : null}

                {guildResourcesError ? (
                  <p className="text-xs text-destructive">{guildResourcesError}</p>
                ) : null}

                {guildResources && !guildResources.botInGuild ? (
                  <div
                    data-tutorial="bot-install-status"
                    className="rounded-lg border border-destructive/40 bg-destructive/10 p-3"
                  >
                    <p className="text-sm text-destructive">
                      Bot is not in <strong>{guildResources.guild.name}</strong>. Add the bot first,
                      then continue.
                    </p>
                    <div className="mt-2">
                      <Button asChild variant="destructive">
                        <a href={guildResources.inviteUrl} target="_blank" rel="noreferrer">
                          Add Bot to Server
                        </a>
                      </Button>
                    </div>
                  </div>
                ) : null}

                {guildResources?.botInGuild ? (
                  <div
                    data-tutorial="bot-install-status"
                    className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"
                  >
                    Bot is installed in this server.
                    {guildLinking
                      ? ' Linking workspace...'
                      : ' Workspace link is managed automatically.'}
                  </div>
                ) : null}

                <div
                  data-tutorial="context-preview"
                  className="rounded-lg border border-border/60 bg-secondary/35 p-3"
                >
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Current Context</p>
                  <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground">
                    {JSON.stringify(contextPreview, null, 2)}
                  </pre>
                </div>
              </CardContent>
            ) : null}
          </Card>
        </section>

        <section className="grid gap-4">
          <Card className="border-border/70 bg-card/75 shadow-lg shadow-black/10 backdrop-blur">
            <DashboardSectionHeader
              sectionId="sales"
              isOpen={openDashboardSections.includes('sales')}
              onToggle={toggleDashboardSection}
              icon={Settings2}
              stepLabel="02"
              title="Sales Settings"
              description="Channels, staff access, tips, rewards, and customer points for the selected server."
              summaryItems={salesSummaryItems}
              action={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Show tutorial info for Sales Settings"
                  onClick={() =>
                    runDashboardTutorial({ markSeen: true, startAtStepId: 'paid-log-channel' })
                  }
                >
                  <Info className="size-4" />
                </Button>
              }
            />
            {openDashboardSections.includes('sales') ? (
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="paid-log-channel">Paid Order Log Channel</Label>
                  <select
                    id="paid-log-channel"
                    className={nativeSelectClass}
                    value={paidLogChannelId}
                    onChange={(event) => setPaidLogChannelId(event.target.value)}
                    disabled={
                      !serverReady || !guildResources || guildResources.channels.length === 0
                    }
                  >
                    <option value="">
                      {!serverReady
                        ? 'Add bot to server first'
                        : guildResources?.channels.length
                          ? 'Select paid-log channel'
                          : 'No text channels available'}
                    </option>
                    {guildResources?.channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        #{channel.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2" data-tutorial="staff-roles">
                  <Label>Staff Roles (can run /sale)</Label>
                  {!serverReady ? (
                    <p className="text-xs text-muted-foreground">Add bot to server first.</p>
                  ) : guildResources?.roles.length ? (
                    <div className="max-h-52 space-y-2 overflow-auto rounded-lg border border-border/60 bg-secondary/30 p-3">
                      {guildResources.roles.map((role) => {
                        const checked = selectedStaffRoleIds.includes(role.id);
                        return (
                          <label
                            key={role.id}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(next) =>
                                setSelectedStaffRoleIds((current) =>
                                  next === true
                                    ? [...new Set([...current, role.id])]
                                    : current.filter((id) => id !== role.id),
                                )
                              }
                            />
                            <span>{role.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No selectable roles available.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">Default Currency</Label>
                  <Input id="currency" value={defaultCurrency} readOnly />
                </div>

                <div className="inline-flex items-center gap-2">
                  <Checkbox
                    id="tip-enabled"
                    checked={tipEnabled}
                    onCheckedChange={(checked) => setTipEnabled(checked === true)}
                  />
                  <Label
                    htmlFor="tip-enabled"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Ask customer for optional tip before checkout link
                  </Label>
                </div>

                <Separator />

                <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/25 p-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Rewards Settings
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Rewards are optional. Leave this section blank (no reward categories selected)
                    to disable rewards.
                  </p>

                  <div className="space-y-2">
                    <Label htmlFor="point-value">Value of 1 point ({defaultCurrency})</Label>
                    <Input
                      id="point-value"
                      value={pointValueMajor}
                      onChange={(event) => setPointValueMajor(event.target.value)}
                      placeholder="0.01"
                    />
                    <p className="text-xs text-muted-foreground">
                      Example: 0.01 means 1 point = 0.01 {defaultCurrency}. Earn rate is fixed at 1
                      point per 1.00 {defaultCurrency} spent on earn-eligible items.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="referral-reward">Referral Reward ({defaultCurrency})</Label>
                    <Input
                      id="referral-reward"
                      value={referralRewardMajor}
                      onChange={(event) => setReferralRewardMajor(event.target.value)}
                      placeholder="10.00"
                    />
                    <p className="text-xs text-muted-foreground">
                      Fallback reward used only when eligible purchased variants do not define their
                      own referral reward. Set to 0.00 to disable fallback. Fallback points:{' '}
                      {previewReferralRewardPoints(referralRewardMajor, pointValueMajor)}.
                    </p>
                  </div>

                  <div className="space-y-2" data-tutorial="referral-categories">
                    <Label>Categories eligible for referral rewards</Label>
                    {pointsCategoryOptions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Create product categories first, then select referral-eligible categories.
                      </p>
                    ) : (
                      <div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-border/60 bg-secondary/30 p-3">
                        {pointsCategoryOptions.map((category) => (
                          <label
                            key={`referral-${category.key}`}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                          >
                            <Checkbox
                              checked={referralRewardCategoryKeys.includes(category.key)}
                              onCheckedChange={() =>
                                togglePointsCategory(category.label, setReferralRewardCategoryKeys)
                              }
                            />
                            <span>{category.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      If no category is selected, all categories are eligible.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="referral-log-channel">Referral Log Channel</Label>
                    <select
                      id="referral-log-channel"
                      className={nativeSelectClass}
                      value={referralLogChannelId}
                      onChange={(event) => setReferralLogChannelId(event.target.value)}
                      disabled={
                        !serverReady || !guildResources || guildResources.channels.length === 0
                      }
                    >
                      <option value="">
                        {!serverReady
                          ? 'Add bot to server first'
                          : guildResources?.channels.length
                            ? 'Select referral log channel'
                            : 'No text channels available'}
                      </option>
                      {guildResources?.channels.map((channel) => (
                        <option key={`referral-${channel.id}`} value={channel.id}>
                          #{channel.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="referral-submission-template">
                      Referral Submission Reply Template
                    </Label>
                    <Textarea
                      id="referral-submission-template"
                      value={referralSubmissionTemplate}
                      onChange={(event) => setReferralSubmissionTemplate(event.target.value)}
                      placeholder={DEFAULT_REFERRAL_SUBMISSION_TEMPLATE}
                      className="min-h-20"
                    />
                    <p className="text-xs text-muted-foreground">
                      Sent as an ephemeral reply after a successful `/refer` submission (private to
                      submitter). Placeholders: {'{referrer_email}'}, {'{referred_email}'},{' '}
                      {'{submitter_mention}'}.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="referral-thank-you-template">Referral Thank-You Template</Label>
                    <Textarea
                      id="referral-thank-you-template"
                      value={referralThankYouTemplate}
                      onChange={(event) => setReferralThankYouTemplate(event.target.value)}
                      placeholder={DEFAULT_REFERRAL_THANK_YOU_TEMPLATE}
                      className="min-h-24"
                    />
                    <p className="text-xs text-muted-foreground">
                      Sent as DM to referrer after payout. Placeholders: {'{points}'},{' '}
                      {'{amount_gbp}'}, {'{referred_email}'}, {'{referrer_email}'},{' '}
                      {'{referrer_mention}'}, {'{order_session_id}'}. Referrer mention is
                      automatically prefixed if you do not include {'{referrer_mention}'}.
                    </p>
                  </div>

                  <div className="space-y-2" data-tutorial="points-earn-categories">
                    <Label>Categories that earn points</Label>
                    {pointsCategoryOptions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Create product categories first, then select reward categories.
                      </p>
                    ) : (
                      <div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-border/60 bg-secondary/30 p-3">
                        {pointsCategoryOptions.map((category) => (
                          <label
                            key={`earn-${category.key}`}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                          >
                            <Checkbox
                              checked={pointsEarnCategoryKeys.includes(category.key)}
                              onCheckedChange={() =>
                                togglePointsCategory(category.label, setPointsEarnCategoryKeys)
                              }
                            />
                            <span>{category.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2" data-tutorial="points-redeem-categories">
                    <Label>Categories where points can be redeemed</Label>
                    {pointsCategoryOptions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Create product categories first, then select redeem categories.
                      </p>
                    ) : (
                      <div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-border/60 bg-secondary/30 p-3">
                        {pointsCategoryOptions.map((category) => (
                          <label
                            key={`redeem-${category.key}`}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                          >
                            <Checkbox
                              checked={pointsRedeemCategoryKeys.includes(category.key)}
                              onCheckedChange={() =>
                                togglePointsCategory(category.label, setPointsRedeemCategoryKeys)
                              }
                            />
                            <span>{category.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/25 p-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Customer Points
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Leave search empty to show the 3 most recently updated customers.
                  </p>

                  <div
                    className="flex flex-col gap-2 sm:flex-row"
                    data-tutorial="customer-points-search"
                  >
                    <Input
                      value={pointsSearchInput}
                      onChange={(event) => setPointsSearchInput(event.target.value)}
                      placeholder="Search customer email..."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={state.loading || !serverReady || pointsCustomersLoading}
                      onClick={() =>
                        runAction(async () => {
                          const customers = await refreshPointsCustomers(pointsSearchInput);
                          return {
                            customers: customers.length,
                            search: pointsSearchInput.trim() || null,
                          };
                        })
                      }
                    >
                      {pointsCustomersLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                      Refresh Customers
                    </Button>
                  </div>

                  <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-border/60 bg-secondary/30 p-3">
                    {pointsCustomers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No customer points accounts found for this server.
                      </p>
                    ) : (
                      pointsCustomers.map((customer) => (
                        <div
                          key={customer.emailNormalized}
                          className="rounded-md border border-border/50 bg-card/70 px-3 py-2 text-xs"
                        >
                          <p className="font-medium">{customer.emailDisplay}</p>
                          <p className="text-muted-foreground">
                            Balance: {customer.balancePoints} | Reserved: {customer.reservedPoints}{' '}
                            | Available: {customer.availablePoints}
                          </p>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="points-adjust-email">Customer Email</Label>
                      <Input
                        id="points-adjust-email"
                        value={pointsAdjustEmail}
                        onChange={(event) => setPointsAdjustEmail(event.target.value)}
                        placeholder="customer@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="points-adjust-value">Points</Label>
                      <Input
                        id="points-adjust-value"
                        value={pointsAdjustValueInput}
                        onChange={(event) => setPointsAdjustValueInput(event.target.value)}
                        placeholder="10"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={state.loading || !serverReady}
                      onClick={() =>
                        runAction(async () => {
                          const context = requireWorkspaceAndServer({ requireBot: true });
                          await ensureGuildLinked(context.workspaceId, context.discordServerId);

                          const points = parseWholePoints(pointsAdjustValueInput);

                          if (!pointsAdjustEmail.trim()) {
                            throw new Error('Customer email is required.');
                          }

                          const result = await apiCall(
                            `/api/guilds/${context.discordServerId}/points/adjust`,
                            'POST',
                            {
                              tenantId: context.workspaceId,
                              email: pointsAdjustEmail.trim(),
                              action: 'add',
                              points,
                            },
                          );
                          await refreshPointsCustomers(pointsSearchInput);
                          return result;
                        })
                      }
                    >
                      Add Points
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={state.loading || !serverReady}
                      onClick={() =>
                        runAction(async () => {
                          const context = requireWorkspaceAndServer({ requireBot: true });
                          await ensureGuildLinked(context.workspaceId, context.discordServerId);

                          const points = parseWholePoints(pointsAdjustValueInput);

                          if (!pointsAdjustEmail.trim()) {
                            throw new Error('Customer email is required.');
                          }

                          const result = await apiCall(
                            `/api/guilds/${context.discordServerId}/points/adjust`,
                            'POST',
                            {
                              tenantId: context.workspaceId,
                              email: pointsAdjustEmail.trim(),
                              action: 'remove',
                              points,
                            },
                          );
                          await refreshPointsCustomers(pointsSearchInput);
                          return result;
                        })
                      }
                    >
                      Remove Points
                    </Button>
                  </div>
                </div>

                <Button
                  type="button"
                  data-tutorial="save-server-settings"
                  disabled={state.loading || !serverReady}
                  onClick={() =>
                    runAction(async () => {
                      const context = requireWorkspaceAndServer({ requireBot: true });
                      await ensureGuildLinked(context.workspaceId, context.discordServerId);
                      const pointValueMinor = parsePointValueMajorToMinor(pointValueMajor);
                      const referralRewardMinor = parsePriceToMinor(referralRewardMajor);
                      const normalizedEarnCategoryKeys = [
                        ...new Set(
                          pointsEarnCategoryKeys.map(normalizeCategoryKey).filter(Boolean),
                        ),
                      ];
                      const normalizedRedeemCategoryKeys = [
                        ...new Set(
                          pointsRedeemCategoryKeys.map(normalizeCategoryKey).filter(Boolean),
                        ),
                      ];
                      const normalizedReferralCategoryKeys = [
                        ...new Set(
                          referralRewardCategoryKeys.map(normalizeCategoryKey).filter(Boolean),
                        ),
                      ];
                      const normalizedStaffRoleIds = normalizeDiscordIdList(selectedStaffRoleIds);

                      const result = (await apiCall(
                        `/api/guilds/${context.discordServerId}/config`,
                        'PATCH',
                        {
                          tenantId: context.workspaceId,
                          paidLogChannelId: normalizeDiscordId(paidLogChannelId) || null,
                          staffRoleIds: normalizedStaffRoleIds,
                          defaultCurrency: DEFAULT_CURRENCY,
                          tipEnabled,
                          joinGateEnabled,
                          joinGateFallbackChannelId:
                            normalizeDiscordId(joinGateFallbackChannelId) || null,
                          joinGateVerifiedRoleId: normalizeDiscordId(joinGateVerifiedRoleId) || null,
                          joinGateTicketCategoryId:
                            normalizeDiscordId(joinGateTicketCategoryId) || null,
                          joinGateCurrentLookupChannelId:
                            normalizeDiscordId(joinGateCurrentLookupChannelId) || null,
                          joinGateNewLookupChannelId:
                            normalizeDiscordId(joinGateNewLookupChannelId) || null,
                          pointsEarnCategoryKeys: normalizedEarnCategoryKeys,
                          pointsRedeemCategoryKeys: normalizedRedeemCategoryKeys,
                          pointValueMinor,
                          referralRewardMinor,
                          referralRewardCategoryKeys: normalizedReferralCategoryKeys,
                          referralLogChannelId: normalizeDiscordId(referralLogChannelId) || null,
                          referralThankYouTemplate:
                            referralThankYouTemplate.trim() || DEFAULT_REFERRAL_THANK_YOU_TEMPLATE,
                          referralSubmissionTemplate:
                            referralSubmissionTemplate.trim() ||
                            DEFAULT_REFERRAL_SUBMISSION_TEMPLATE,
                          ticketMetadataKey: 'isTicket',
                        },
                      )) as {
                        config?: GuildConfigRecord;
                      };
                      if (result.config) {
                        setPaidLogChannelId(normalizeDiscordId(result.config.paidLogChannelId));
                        setSelectedStaffRoleIds(normalizeDiscordIdList(result.config.staffRoleIds));
                        setDefaultCurrency(result.config.defaultCurrency || DEFAULT_CURRENCY);
                        setTipEnabled(Boolean(result.config.tipEnabled));
                        setJoinGateEnabled(Boolean(result.config.joinGateEnabled));
                        setJoinGateFallbackChannelId(
                          normalizeDiscordId(result.config.joinGateFallbackChannelId),
                        );
                        setJoinGateVerifiedRoleId(
                          normalizeDiscordId(result.config.joinGateVerifiedRoleId),
                        );
                        setJoinGateTicketCategoryId(
                          normalizeDiscordId(result.config.joinGateTicketCategoryId),
                        );
                        setJoinGateCurrentLookupChannelId(
                          normalizeDiscordId(result.config.joinGateCurrentLookupChannelId),
                        );
                        setJoinGateNewLookupChannelId(
                          normalizeDiscordId(result.config.joinGateNewLookupChannelId),
                        );
                        setPointsEarnCategoryKeys(
                          Array.isArray(result.config.pointsEarnCategoryKeys)
                            ? result.config.pointsEarnCategoryKeys
                                .map((value) => normalizeCategoryKey(value))
                                .filter(Boolean)
                            : [],
                        );
                        setPointsRedeemCategoryKeys(
                          Array.isArray(result.config.pointsRedeemCategoryKeys)
                            ? result.config.pointsRedeemCategoryKeys
                                .map((value) => normalizeCategoryKey(value))
                                .filter(Boolean)
                            : [],
                        );
                        setPointValueMajor(
                          formatPointValueMinorToMajor(result.config.pointValueMinor),
                        );
                        const nextReferralRewardMajor = formatMinorToMajor(
                          result.config.referralRewardMinor,
                        );
                        setReferralRewardMajor(nextReferralRewardMajor);
                        setReferralRewardCategoryKeys(
                          Array.isArray(result.config.referralRewardCategoryKeys)
                            ? result.config.referralRewardCategoryKeys
                                .map((value) => normalizeCategoryKey(value))
                                .filter(Boolean)
                            : [],
                        );
                        setReferralLogChannelId(
                          normalizeDiscordId(result.config.referralLogChannelId),
                        );
                        setReferralThankYouTemplate(
                          result.config.referralThankYouTemplate ||
                            DEFAULT_REFERRAL_THANK_YOU_TEMPLATE,
                        );
                        setReferralSubmissionTemplate(
                          result.config.referralSubmissionTemplate ||
                            DEFAULT_REFERRAL_SUBMISSION_TEMPLATE,
                        );
                      }
                      return result;
                    })
                  }
                >
                  Save Server Settings
                </Button>
              </CardContent>
            ) : null}
          </Card>

          <Card className="border-border/70 bg-card/75 shadow-lg shadow-black/10 backdrop-blur">
            <DashboardSectionHeader
              sectionId="payments"
              isOpen={openDashboardSections.includes('payments')}
              onToggle={toggleDashboardSection}
              icon={Wallet}
              stepLabel="03"
              title="Payment Setup"
              description="Merchant wallet, checkout domain, callback secret, and optional crypto gateway settings."
              summaryItems={paymentSummaryItems}
              action={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Show tutorial info for Payment Setup"
                  onClick={() =>
                    runDashboardTutorial({ markSeen: true, startAtStepId: 'wallet-address' })
                  }
                >
                  <Info className="size-4" />
                </Button>
              }
            />
            {openDashboardSections.includes('payments') ? (
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wallet-address">Merchant Wallet Address (Polygon)</Label>
                  <Input
                    id="wallet-address"
                    value={voodooMerchantWalletAddress}
                    onChange={(event) => setVoodooMerchantWalletAddress(event.target.value)}
                    placeholder="0x..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="checkout-domain">Checkout Domain</Label>
                  <Input
                    id="checkout-domain"
                    value={voodooCheckoutDomain}
                    onChange={(event) => setVoodooCheckoutDomain(event.target.value)}
                    placeholder="checkout.voodoo-pay.uk"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="callback-secret">Callback Secret (optional override)</Label>
                  <Input
                    id="callback-secret"
                    type="password"
                    value={voodooCallbackSecret}
                    onChange={(event) => setVoodooCallbackSecret(event.target.value)}
                    placeholder="Leave blank to auto-generate or keep existing"
                  />
                </div>

                <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/35 p-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="voodoo-crypto-enabled"
                      checked={voodooCryptoGatewayEnabled}
                      onCheckedChange={(checked) => setVoodooCryptoGatewayEnabled(checked === true)}
                    />
                    <div>
                      <Label htmlFor="voodoo-crypto-enabled">
                        Enable Hosted Multi-Coin Crypto Checkout
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        When enabled, checkout message shows both `Pay` and `Pay with Crypto`
                        buttons.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="voodoo-crypto-add-fees"
                      checked={voodooCryptoAddFees}
                      onCheckedChange={(checked) => setVoodooCryptoAddFees(checked === true)}
                    />
                    <div>
                      <Label htmlFor="voodoo-crypto-add-fees">Customer Pays Blockchain Fees</Label>
                      <p className="text-xs text-muted-foreground">
                        Adds estimated network fee flag to hosted checkout (`add_fees=1`).
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="crypto-wallet-btc">BTC Wallet</Label>
                      <Input
                        id="crypto-wallet-btc"
                        value={voodooCryptoWallets.btc}
                        onChange={(event) => setVoodooCryptoWallet('btc', event.target.value)}
                        placeholder="Bitcoin wallet address"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="crypto-wallet-ltc">LTC Wallet</Label>
                      <Input
                        id="crypto-wallet-ltc"
                        value={voodooCryptoWallets.ltc}
                        onChange={(event) => setVoodooCryptoWallet('ltc', event.target.value)}
                        placeholder="Litecoin wallet address"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="crypto-wallet-evm">ETH / EVM Wallet</Label>
                      <Input
                        id="crypto-wallet-evm"
                        value={voodooCryptoWallets.evm}
                        onChange={(event) => setVoodooCryptoWallet('evm', event.target.value)}
                        placeholder="EVM wallet (ETH, Polygon, Arbitrum, BSC...)"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="crypto-wallet-bch">BCH Wallet</Label>
                      <Input
                        id="crypto-wallet-bch"
                        value={voodooCryptoWallets.bitcoincash}
                        onChange={(event) =>
                          setVoodooCryptoWallet('bitcoincash', event.target.value)
                        }
                        placeholder="Bitcoin Cash wallet address"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="crypto-wallet-doge">DOGE Wallet</Label>
                      <Input
                        id="crypto-wallet-doge"
                        value={voodooCryptoWallets.doge}
                        onChange={(event) => setVoodooCryptoWallet('doge', event.target.value)}
                        placeholder="Dogecoin wallet address"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="crypto-wallet-trx">TRX / TRC20 Wallet</Label>
                      <Input
                        id="crypto-wallet-trx"
                        value={voodooCryptoWallets.trc20}
                        onChange={(event) => setVoodooCryptoWallet('trc20', event.target.value)}
                        placeholder="TRC20 wallet address"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label htmlFor="crypto-wallet-sol">SOL Wallet</Label>
                      <Input
                        id="crypto-wallet-sol"
                        value={voodooCryptoWallets.solana}
                        onChange={(event) => setVoodooCryptoWallet('solana', event.target.value)}
                        placeholder="Solana wallet address"
                      />
                    </div>
                  </div>

                  <div
                    className={cn(
                      'rounded-md border px-3 py-2 text-xs',
                      voodooCryptoGatewayEnabled
                        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-amber-400/40 bg-amber-500/10 text-amber-200',
                    )}
                  >
                    {voodooCryptoGatewayEnabled
                      ? 'Crypto gateway is enabled. At least one wallet must be configured before save.'
                      : 'Crypto gateway is currently disabled for this server.'}
                  </div>
                </div>

                <Button
                  type="button"
                  data-tutorial="save-voodoo"
                  disabled={state.loading || !serverReady}
                  onClick={() =>
                    runAction(async () => {
                      const context = requireWorkspaceAndServer({ requireBot: true });
                      await ensureGuildLinked(context.workspaceId, context.discordServerId);
                      const normalizedCheckoutDomain =
                        normalizeCheckoutDomainInput(voodooCheckoutDomain);
                      if (!normalizedCheckoutDomain) {
                        throw new Error('Checkout domain is required.');
                      }

                      const payload: {
                        tenantId: string;
                        merchantWalletAddress: string;
                        checkoutDomain: string;
                        callbackSecret?: string;
                        cryptoGatewayEnabled: boolean;
                        cryptoAddFees: boolean;
                        cryptoWallets: VoodooCryptoWallets;
                      } = {
                        tenantId: context.workspaceId,
                        merchantWalletAddress: voodooMerchantWalletAddress,
                        checkoutDomain: normalizedCheckoutDomain,
                        cryptoGatewayEnabled: voodooCryptoGatewayEnabled,
                        cryptoAddFees: voodooCryptoAddFees,
                        cryptoWallets: {
                          evm: voodooCryptoWallets.evm.trim(),
                          btc: voodooCryptoWallets.btc.trim(),
                          bitcoincash: voodooCryptoWallets.bitcoincash.trim(),
                          ltc: voodooCryptoWallets.ltc.trim(),
                          doge: voodooCryptoWallets.doge.trim(),
                          trc20: voodooCryptoWallets.trc20.trim(),
                          solana: voodooCryptoWallets.solana.trim(),
                        },
                      };

                      if (voodooCallbackSecret.trim()) {
                        payload.callbackSecret = voodooCallbackSecret.trim();
                      }

                      const result = (await apiCall(
                        `/api/guilds/${context.discordServerId}/integrations/voodoopay`,
                        'PUT',
                        payload,
                      )) as {
                        webhookUrl: string;
                        tenantWebhookKey: string;
                        callbackSecretGenerated?: string | null;
                      };

                      setVoodooWebhookUrl(result.webhookUrl);
                      setVoodooWebhookKey(result.tenantWebhookKey);
                      setAutoGeneratedCallbackSecret(result.callbackSecretGenerated ?? '');
                      setVoodooCallbackSecret('');
                      await hydrateContextData();
                      return result;
                    })
                  }
                >
                  Save Voodoo Pay Integration
                </Button>

                {voodooWebhookUrl ? (
                  <div
                    data-tutorial="voodoo-webhook"
                    className="rounded-lg border border-border/60 bg-secondary/35 p-3 text-sm"
                  >
                    <p className="font-medium">Webhook URL</p>
                    <p className="mt-1 break-all text-muted-foreground">{voodooWebhookUrl}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Webhook Key: {voodooWebhookKey}
                    </p>
                  </div>
                ) : null}

                {autoGeneratedCallbackSecret ? (
                  <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                    <p className="font-medium">Auto-generated Callback Secret</p>
                    <p className="mt-1 break-all font-mono text-xs">
                      {autoGeneratedCallbackSecret}
                    </p>
                    <p className="mt-2 text-xs text-amber-100/80">
                      Save this value in your Voodoo Pay callback settings if your gateway account
                      requires a callback secret.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        </section>
        <section className="grid gap-4">
          <Card className="border-border/70 bg-card/75 shadow-lg shadow-black/10 backdrop-blur">
            <DashboardSectionHeader
              sectionId="coupons"
              isOpen={openDashboardSections.includes('coupons')}
              onToggle={toggleDashboardSection}
              icon={Wallet}
              stepLabel="04"
              title="Coupons"
              description="Create fixed discounts and optionally scope them to products or price variations."
              summaryItems={couponSummaryItems}
              action={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Show tutorial info for Coupons"
                  onClick={() =>
                    runDashboardTutorial({ markSeen: true, startAtStepId: 'coupons-refresh' })
                  }
                >
                  <Info className="size-4" />
                </Button>
              }
            />
            {openDashboardSections.includes('coupons') ? (
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {coupons.length} coupon(s) configured for this server.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    data-tutorial="coupons-refresh"
                    disabled={state.loading || !serverReady}
                    onClick={() =>
                      runAction(async () => {
                        const refreshed = await refreshCoupons();
                        return { couponCount: refreshed.length };
                      })
                    }
                  >
                    Refresh Coupons
                  </Button>
                </div>

                <div className="space-y-2">
                  {coupons.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No coupons yet for this server.</p>
                  ) : (
                    coupons.map((coupon) => (
                      <div
                        key={coupon.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/35 px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="font-medium">{coupon.code}</p>
                          <p className="text-xs text-muted-foreground">
                            Discount: {(coupon.discountMinor / 100).toFixed(2)} {DEFAULT_CURRENCY} -{' '}
                            {coupon.active ? 'Active' : 'Inactive'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Scope:{' '}
                            {coupon.allowedProductIds.length === 0 &&
                            coupon.allowedVariantIds.length === 0
                              ? 'All products and variations'
                              : `${coupon.allowedProductIds.length} product(s), ${coupon.allowedVariantIds.length} variation(s)`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => loadCouponIntoBuilder(coupon)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              runAction(async () => {
                                const context = requireWorkspaceAndServer({ requireBot: true });
                                const confirmed = window.confirm(`Delete coupon "${coupon.code}"?`);
                                if (!confirmed) {
                                  return { cancelled: true };
                                }

                                await apiCall(
                                  `/api/guilds/${encodeURIComponent(context.discordServerId)}/coupons/${encodeURIComponent(coupon.id)}?tenantId=${encodeURIComponent(context.workspaceId)}`,
                                  'DELETE',
                                );
                                await refreshCoupons();
                                if (editingCouponId === coupon.id) {
                                  resetCouponBuilder();
                                }

                                return { deletedCouponId: coupon.id };
                              })
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <Separator />

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="coupon-code">Coupon Code</Label>
                    <Input
                      id="coupon-code"
                      value={couponCodeInput}
                      onChange={(event) => setCouponCodeInput(event.target.value.toUpperCase())}
                      placeholder="SAVE10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coupon-discount">Discount Amount (GBP)</Label>
                    <Input
                      id="coupon-discount"
                      value={couponDiscountInput}
                      onChange={(event) => setCouponDiscountInput(event.target.value)}
                      placeholder="5.00"
                    />
                  </div>
                </div>

                <div className="inline-flex items-center gap-2">
                  <Checkbox
                    id="coupon-active"
                    checked={couponActiveInput}
                    onCheckedChange={(checked) => setCouponActiveInput(checked === true)}
                  />
                  <Label
                    htmlFor="coupon-active"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Coupon active
                  </Label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div
                    className="space-y-2 rounded-md border border-border/60 bg-secondary/25 p-3"
                    data-tutorial="coupon-product-scope"
                  >
                    <Label className="text-sm">Product Scope (optional)</Label>
                    {couponProductOptions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No products available yet.</p>
                    ) : (
                      <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                        {couponProductOptions.map((product) => (
                          <label
                            key={product.productId}
                            className="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            <Checkbox
                              checked={couponAllowedProductIdsInput.includes(product.productId)}
                              onCheckedChange={() =>
                                toggleIdList(product.productId, setCouponAllowedProductIdsInput)
                              }
                            />
                            <span>{product.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div
                    className="space-y-2 rounded-md border border-border/60 bg-secondary/25 p-3"
                    data-tutorial="coupon-variant-scope"
                  >
                    <Label className="text-sm">Variation Scope (optional)</Label>
                    {couponVariantOptions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No variations available yet.</p>
                    ) : (
                      <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                        {couponVariantOptions.map((variant) => (
                          <label
                            key={variant.variantId}
                            className="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            <Checkbox
                              checked={couponAllowedVariantIdsInput.includes(variant.variantId)}
                              onCheckedChange={() =>
                                toggleIdList(variant.variantId, setCouponAllowedVariantIdsInput)
                              }
                            />
                            <span>{variant.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave both scope lists empty to let this coupon work on all products and
                  variations.
                </p>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    data-tutorial="save-coupon"
                    disabled={state.loading || !serverReady}
                    className="sm:flex-1"
                    onClick={() =>
                      runAction(async () => {
                        const context = requireWorkspaceAndServer({ requireBot: true });
                        await ensureGuildLinked(context.workspaceId, context.discordServerId);

                        const normalizedCode = couponCodeInput.trim().toUpperCase();
                        if (!normalizedCode) {
                          throw new Error('Coupon code is required.');
                        }

                        const discountMinor = parsePriceToMinor(couponDiscountInput);
                        const validCouponProductIds = new Set(
                          couponProductOptions.map((product) => product.productId),
                        );
                        const validCouponVariantIds = new Set(
                          couponVariantOptions.map((variant) => variant.variantId),
                        );
                        const payload = {
                          tenantId: context.workspaceId,
                          coupon: {
                            code: normalizedCode,
                            discountMinor,
                            active: couponActiveInput,
                            allowedProductIds: couponAllowedProductIdsInput.filter((id) =>
                              validCouponProductIds.has(id),
                            ),
                            allowedVariantIds: couponAllowedVariantIdsInput.filter((id) =>
                              validCouponVariantIds.has(id),
                            ),
                          },
                        };

                        if (editingCouponId) {
                          await apiCall(
                            `/api/guilds/${encodeURIComponent(context.discordServerId)}/coupons/${encodeURIComponent(editingCouponId)}`,
                            'PATCH',
                            payload,
                          );
                        } else {
                          await apiCall(
                            `/api/guilds/${encodeURIComponent(context.discordServerId)}/coupons`,
                            'POST',
                            payload,
                          );
                        }

                        await refreshCoupons();
                        resetCouponBuilder();

                        return {
                          mode: editingCouponId ? 'updated' : 'created',
                          code: normalizedCode,
                        };
                      })
                    }
                  >
                    {editingCouponId ? 'Update Coupon' : 'Create Coupon'}
                  </Button>
                  {editingCouponId ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="sm:flex-1"
                      onClick={() => resetCouponBuilder()}
                    >
                      Cancel Edit
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            ) : null}
          </Card>
        </section>
        <section className="grid gap-4">
          <Card className="border-border/70 bg-card/75 shadow-lg shadow-black/10 backdrop-blur">
            <DashboardSectionHeader
              sectionId="catalog"
              isOpen={openDashboardSections.includes('catalog')}
              onToggle={toggleDashboardSection}
              icon={Globe}
              stepLabel="05"
              title="Catalog Builder"
              description="Create categories, shared checkout questions, products, and price options in one guided flow."
              summaryItems={catalogSummaryItems}
              action={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Show tutorial info for Catalog Builder"
                  onClick={() =>
                    runDashboardTutorial({ markSeen: true, startAtStepId: 'products-refresh' })
                  }
                >
                  <Info className="size-4" />
                </Button>
              }
            />
            {openDashboardSections.includes('catalog') ? (
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-4 text-sm text-muted-foreground">
                  <Layers3 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p>
                    Merchants can now work one block at a time. Review the catalog, set category
                    questions once, then finish product details and price options without the whole
                    builder staying open.
                  </p>
                </div>
                <CatalogStepPanel
                  sectionId="overview"
                  isOpen={openCatalogSections.includes('overview')}
                  onToggle={toggleCatalogSection}
                  stepLabel="01"
                  title="Review catalog"
                  description="Refresh the live catalog and jump into edits without opening the full builder."
                  summaryItems={catalogOverviewSummaryItems}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Existing Products
                      </h3>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-tutorial="products-refresh"
                        disabled={productsLoading || !serverReady}
                        onClick={() =>
                          runAction(async () => {
                            const refreshed = await refreshProducts();
                            return { productCount: refreshed.length };
                          })
                        }
                      >
                        {productsLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                        Refresh
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {products.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No products yet for this server.
                        </p>
                      ) : (
                        products.map((product) => (
                          <div
                            key={product.id}
                            className="rounded-lg border border-border/60 bg-secondary/35 px-3 py-3 text-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-medium">{product.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {product.category} • {product.active ? 'Active' : 'Inactive'} •{' '}
                                  {product.variants.length} price option(s)
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => loadProductIntoBuilder(product)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() =>
                                    runAction(async () => {
                                      const context = requireWorkspaceAndServer({
                                        requireBot: true,
                                      });
                                      const confirmed = window.confirm(
                                        `Delete product "${product.name}"?`,
                                      );
                                      if (!confirmed) {
                                        return { cancelled: true };
                                      }

                                      await apiCall(
                                        `/api/guilds/${encodeURIComponent(context.discordServerId)}/products/${encodeURIComponent(product.id)}?tenantId=${encodeURIComponent(context.workspaceId)}`,
                                        'DELETE',
                                      );

                                      await refreshProducts();
                                      if (editingProductId === product.id) {
                                        resetProductBuilder();
                                      }
                                      return { deletedProductId: product.id };
                                    })
                                  }
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CatalogStepPanel>

                <CatalogStepPanel
                  sectionId="category"
                  isOpen={openCatalogSections.includes('category')}
                  onToggle={toggleCatalogSection}
                  stepLabel="02"
                  title="Category & questions"
                  description="Set the category once, then keep the shared checkout questions consistent for every product inside it."
                  summaryItems={categoryStepSummaryItems}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Create Category + Questions
                      </h3>
                      <Badge variant="outline">{questions.length} question(s)</Badge>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="category-builder-existing">Pick Existing Category</Label>
                        <select
                          id="category-builder-existing"
                          className={nativeSelectClass}
                          value={selectedExistingCategoryForBuilder}
                          onChange={(event) => {
                            const nextCategory = event.target.value;
                            setCategoryBuilderName(nextCategory);
                            if (nextCategory) {
                              setProductCategory(nextCategory);
                            }
                          }}
                        >
                          <option value="">Select category</option>
                          {categorySelectOptions.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                        <Label htmlFor="category-builder-name">Or Type New Category</Label>
                        <Input
                          id="category-builder-name"
                          value={categoryBuilderName}
                          onChange={(event) => setCategoryBuilderName(event.target.value)}
                          placeholder="Renew Subscription"
                        />
                        <p className="text-xs text-muted-foreground">
                          Questions are shared by category. Add them once here, then reuse for all
                          products in that category.
                        </p>
                      </div>

                      <div className="flex flex-col justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => loadQuestionsForCategory(categoryBuilderName)}
                        >
                          Load Existing Category Questions
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setQuestions(getDefaultQuestions());
                            setQuestionKeyInput('');
                            setQuestionLabelInput('');
                            setQuestionTypeInput('short_text');
                            setQuestionRequiredInput(true);
                            setQuestionSensitiveInput(false);
                          }}
                        >
                          Reset Question Draft
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="category-rename-to">Rename Category To</Label>
                          <Input
                            id="category-rename-to"
                            value={categoryRenameTo}
                            onChange={(event) => setCategoryRenameTo(event.target.value)}
                            placeholder="New category name"
                          />
                        </div>
                        <div className="flex flex-col justify-end gap-2 sm:flex-row">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={
                              state.loading ||
                              !serverReady ||
                              !categoryBuilderName.trim() ||
                              !categoryRenameTo.trim()
                            }
                            onClick={() =>
                              runAction(async () => {
                                const context = requireWorkspaceAndServer({ requireBot: true });
                                await ensureGuildLinked(
                                  context.workspaceId,
                                  context.discordServerId,
                                );

                                const sourceCategory = categoryBuilderName.trim();
                                const targetCategory = categoryRenameTo.trim();
                                if (!sourceCategory) {
                                  throw new Error('Select a category to rename first.');
                                }
                                if (!targetCategory) {
                                  throw new Error('Enter a new category name.');
                                }

                                const payload = (await apiCall(
                                  `/api/guilds/${encodeURIComponent(context.discordServerId)}/categories`,
                                  'PATCH',
                                  {
                                    tenantId: context.workspaceId,
                                    category: sourceCategory,
                                    newCategory: targetCategory,
                                  },
                                )) as { updatedProducts?: number };

                                const nextProducts = await refreshProducts();
                                setCategoryBuilderName(targetCategory);
                                setCategoryRenameTo('');

                                if (
                                  normalizeCategoryKey(productCategory) ===
                                  normalizeCategoryKey(sourceCategory)
                                ) {
                                  setProductCategory(targetCategory);
                                }

                                if (
                                  editingProductId &&
                                  !nextProducts.some((product) => product.id === editingProductId)
                                ) {
                                  resetProductBuilder({ keepCategory: targetCategory });
                                }

                                return {
                                  renamedCategory: sourceCategory,
                                  newCategory: targetCategory,
                                  updatedProducts: payload.updatedProducts ?? 0,
                                };
                              })
                            }
                          >
                            Rename Category
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={state.loading || !serverReady || !categoryBuilderName.trim()}
                            onClick={() =>
                              runAction(async () => {
                                const context = requireWorkspaceAndServer({ requireBot: true });
                                await ensureGuildLinked(
                                  context.workspaceId,
                                  context.discordServerId,
                                );

                                const categoryToDelete = categoryBuilderName.trim();
                                if (!categoryToDelete) {
                                  throw new Error('Select a category to delete first.');
                                }

                                const confirmed = window.confirm(
                                  `Delete category \"${categoryToDelete}\" and ALL products in it? This cannot be undone.`,
                                );
                                if (!confirmed) {
                                  return { cancelled: true };
                                }

                                const payload = (await apiCall(
                                  `/api/guilds/${encodeURIComponent(context.discordServerId)}/categories`,
                                  'DELETE',
                                  {
                                    tenantId: context.workspaceId,
                                    category: categoryToDelete,
                                  },
                                )) as { deletedProducts?: number };

                                const nextProducts = await refreshProducts();
                                const nextCategories = Array.from(
                                  new Set(
                                    nextProducts
                                      .map((product) => product.category.trim())
                                      .filter((category) => Boolean(category)),
                                  ),
                                ).sort((a, b) => a.localeCompare(b));

                                const nextCategory = nextCategories[0] ?? '';
                                setCategoryBuilderName(nextCategory || 'Accounts');
                                setCategoryRenameTo('');
                                if (
                                  normalizeCategoryKey(productCategory) ===
                                  normalizeCategoryKey(categoryToDelete)
                                ) {
                                  setProductCategory(nextCategory || 'Accounts');
                                }

                                if (
                                  editingProductId &&
                                  !nextProducts.some((product) => product.id === editingProductId)
                                ) {
                                  setQuestions(getDefaultQuestions());
                                  resetProductBuilder({ keepCategory: nextCategory || 'Accounts' });
                                }

                                return {
                                  deletedCategory: categoryToDelete,
                                  deletedProducts: payload.deletedProducts ?? 0,
                                };
                              })
                            }
                          >
                            Delete Category
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Renaming updates all products in the category. Deleting removes all products
                        in that category.
                      </p>
                    </div>

                    <div className="space-y-2" data-tutorial="question-list">
                      {questions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No questions yet.</p>
                      ) : (
                        questions.map((question, index) => {
                          const isLockedEmailQuestion =
                            question.key.trim().toLowerCase() === REQUIRED_EMAIL_QUESTION_KEY;
                          return (
                            <div
                              key={`${question.key}-${index}`}
                              className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/35 px-3 py-2"
                            >
                              <div>
                                <p className="text-sm font-medium">{question.label}</p>
                                <p className="text-xs text-muted-foreground">
                                  {question.fieldType} -{' '}
                                  {question.required ? 'Required' : 'Optional'} -{' '}
                                  {question.sensitive ? 'Sensitive' : 'Not sensitive'}
                                  {isLockedEmailQuestion ? ' - System field (locked)' : ''}
                                </p>
                              </div>
                              {isLockedEmailQuestion ? (
                                <Badge variant="outline">Locked</Badge>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => removeQuestion(index)}
                                >
                                  <X className="size-4" />
                                </Button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="question-key">Question Key</Label>
                        <Input
                          id="question-key"
                          value={questionKeyInput}
                          onChange={(event) => setQuestionKeyInput(event.target.value)}
                          placeholder="username"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="question-label">Question Label</Label>
                        <Input
                          id="question-label"
                          value={questionLabelInput}
                          onChange={(event) => setQuestionLabelInput(event.target.value)}
                          placeholder="What is your email?"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="question-type">Input Type</Label>
                        <select
                          id="question-type"
                          className={nativeSelectClass}
                          value={questionTypeInput}
                          onChange={(event) =>
                            setQuestionTypeInput(event.target.value as FieldType)
                          }
                        >
                          <option value="short_text">Short text</option>
                          <option value="long_text">Long text</option>
                          <option value="email">Email</option>
                          <option value="number">Number</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2 self-end">
                        <Checkbox
                          id="question-required"
                          checked={questionRequiredInput}
                          onCheckedChange={(checked) => setQuestionRequiredInput(checked === true)}
                        />
                        <Label
                          htmlFor="question-required"
                          className="text-sm font-normal text-muted-foreground"
                        >
                          Required
                        </Label>
                      </div>
                      <div className="flex items-center gap-2 self-end">
                        <Checkbox
                          id="question-sensitive"
                          checked={questionSensitiveInput}
                          onCheckedChange={(checked) => setQuestionSensitiveInput(checked === true)}
                        />
                        <Label
                          htmlFor="question-sensitive"
                          className="text-sm font-normal text-muted-foreground"
                        >
                          Sensitive
                        </Label>
                      </div>
                    </div>

                    <Button type="button" variant="outline" onClick={addQuestion}>
                      <Plus className="size-4" />
                      Add Question
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      data-tutorial="save-category-questions"
                      disabled={state.loading || !serverReady}
                      onClick={() =>
                        runAction(async () => {
                          const context = requireWorkspaceAndServer({ requireBot: true });
                          await ensureGuildLinked(context.workspaceId, context.discordServerId);

                          const normalizedCategory = categoryBuilderName.trim();
                          if (!normalizedCategory) {
                            throw new Error('Category name is required before saving questions.');
                          }

                          const template = categoryTemplateByKey.get(
                            normalizeCategoryKey(normalizedCategory),
                          );
                          if (!template) {
                            throw new Error(
                              'Create at least one product in this category first. New products in that category will then reuse these questions automatically.',
                            );
                          }

                          const preparedQuestions = prepareQuestionsForApi();
                          await apiCall(
                            `/api/guilds/${encodeURIComponent(context.discordServerId)}/forms/${encodeURIComponent(template.productId)}`,
                            'PUT',
                            {
                              tenantId: context.workspaceId,
                              formFields: preparedQuestions,
                            },
                          );

                          await refreshProducts();
                          setCategoryBuilderName(normalizedCategory);
                          setProductCategory(normalizedCategory);
                          return { savedCategoryQuestionsFor: normalizedCategory };
                        })
                      }
                    >
                      Save Category Questions
                    </Button>
                  </div>
                </CatalogStepPanel>

                <CatalogStepPanel
                  sectionId="product"
                  isOpen={openCatalogSections.includes('product')}
                  onToggle={toggleCatalogSection}
                  stepLabel="03"
                  title="Product basics"
                  description="Choose the category, set the product name, and decide if this listing should be active right away."
                  summaryItems={productStepSummaryItems}
                >
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Product basics
                    </h3>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="product-category">Product Category</Label>
                        <select
                          id="product-category"
                          className={nativeSelectClass}
                          value={productCategory}
                          onChange={(event) => setProductCategory(event.target.value)}
                        >
                          <option value="">Select category</option>
                          {categorySelectOptions.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setProductCategory(categoryBuilderName.trim())}
                            disabled={!categoryBuilderName.trim()}
                          >
                            Use Category Builder Name
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Pick an existing category from the list, or build the category template in
                          Step 02 first.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="product-name">Product Name</Label>
                        <Input
                          id="product-name"
                          value={productName}
                          onChange={(event) => setProductName(event.target.value)}
                          placeholder="Starter Account"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="product-description">Description (optional)</Label>
                      <Textarea
                        id="product-description"
                        value={productDescription}
                        onChange={(event) => setProductDescription(event.target.value)}
                        placeholder="Optional product details"
                        className="min-h-24"
                      />
                    </div>

                    <div className="inline-flex items-center gap-2">
                      <Checkbox
                        id="product-active"
                        checked={productActive}
                        onCheckedChange={(checked) => setProductActive(checked === true)}
                      />
                      <Label
                        htmlFor="product-active"
                        className="text-sm font-normal text-muted-foreground"
                      >
                        Product active
                      </Label>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Final save happens in Step 04 after at least one price option is added.
                    </p>
                  </div>
                </CatalogStepPanel>

                <CatalogStepPanel
                  sectionId="pricing"
                  isOpen={openCatalogSections.includes('pricing')}
                  onToggle={toggleCatalogSection}
                  stepLabel="04"
                  title="Price options"
                  description="Add the variations customers choose at checkout, then save the full product from here."
                  summaryItems={pricingStepSummaryItems}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Price Options (GBP)
                      </h3>
                      <Badge variant="outline">{variants.length} option(s)</Badge>
                    </div>

                    <div className="space-y-2">
                      {variants.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No price options yet.</p>
                      ) : (
                        variants.map((variant, index) => (
                          <div
                            key={`${variant.label}-${index}`}
                            className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/35 px-3 py-2"
                          >
                            <p className="text-sm">
                              {variant.label}: {variant.priceMajor} {variant.currency} (Referral:{' '}
                              {variant.referralRewardMajor} {variant.currency})
                            </p>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => editPriceOption(index)}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => removePriceOption(index)}
                              >
                                <X className="size-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="variant-label">Price Label</Label>
                        <Input
                          id="variant-label"
                          value={variantLabelInput}
                          onChange={(event) => setVariantLabelInput(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="variant-price">Price (major unit)</Label>
                        <Input
                          id="variant-price"
                          value={variantPriceInput}
                          onChange={(event) => setVariantPriceInput(event.target.value)}
                          placeholder="9.99"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="variant-referral-reward">
                          Referral Reward (major unit)
                        </Label>
                        <Input
                          id="variant-referral-reward"
                          value={variantReferralRewardInput}
                          onChange={(event) => setVariantReferralRewardInput(event.target.value)}
                          placeholder={referralRewardMajor || DEFAULT_REFERRAL_REWARD_MAJOR}
                        />
                      </div>
                    </div>

                    <Button type="button" variant="outline" onClick={addPriceOption}>
                      <Plus className="size-4" />
                      {editingVariantIndex === null ? 'Add Price Option' : 'Save Price Option'}
                    </Button>
                    {editingVariantIndex !== null ? (
                      <Button type="button" variant="outline" onClick={cancelPriceOptionEdit}>
                        Cancel Variant Edit
                      </Button>
                    ) : null}

                    <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                      <Button
                        type="button"
                        data-tutorial="save-product"
                        disabled={state.loading || !serverReady}
                        className="sm:flex-1"
                        onClick={() =>
                          runAction(async () => {
                            const context = requireWorkspaceAndServer({ requireBot: true });
                            await ensureGuildLinked(context.workspaceId, context.discordServerId);

                            if (variants.length === 0) {
                              throw new Error('Add at least one price option.');
                            }

                            const normalizedCategory = productCategory.trim();
                            const normalizedName = productName.trim();
                            const normalizedDescription = productDescription.trim();

                            if (!normalizedCategory) {
                              throw new Error('Product category is required.');
                            }

                            if (!normalizedName) {
                              throw new Error('Product name is required.');
                            }

                            const normalizedCategoryKey = normalizeCategoryKey(normalizedCategory);
                            const categoryAlreadyExists = existingCategories.some(
                              (category) =>
                                normalizeCategoryKey(category) === normalizedCategoryKey,
                            );

                            const editingProduct = editingProductId
                              ? (products.find((product) => product.id === editingProductId) ??
                                null)
                              : null;
                            if (
                              editingProduct &&
                              normalizeCategoryKey(editingProduct.category) !==
                                normalizedCategoryKey
                            ) {
                              throw new Error(
                                'Changing category on an existing product is blocked to keep category questions consistent. Create a new product in the target category instead.',
                              );
                            }

                            const preparedVariants = variants.map((variant) => ({
                              label: variant.label.trim(),
                              priceMinor: parsePriceToMinor(variant.priceMajor),
                              referralRewardMinor: parsePriceToMinor(variant.referralRewardMajor),
                              currency: DEFAULT_CURRENCY,
                            }));

                            let preparedQuestions: QuestionDraft[] = [];
                            if (!categoryAlreadyExists) {
                              if (
                                normalizeCategoryKey(categoryBuilderName) !== normalizedCategoryKey
                              ) {
                                throw new Error(
                                  'For a new category, set the same category name in "Create Category + Questions" first.',
                                );
                              }

                              preparedQuestions = prepareQuestionsForApi();
                            }

                            const productPayload = {
                              category: normalizedCategory,
                              name: normalizedName,
                              description: normalizedDescription,
                              active: productActive,
                              variants: preparedVariants,
                            };

                            if (editingProductId) {
                              await apiCall(
                                `/api/guilds/${encodeURIComponent(context.discordServerId)}/products/${encodeURIComponent(editingProductId)}`,
                                'PATCH',
                                {
                                  tenantId: context.workspaceId,
                                  product: productPayload,
                                },
                              );
                            } else {
                              await apiCall(
                                `/api/guilds/${context.discordServerId}/products`,
                                'POST',
                                {
                                  tenantId: context.workspaceId,
                                  product: productPayload,
                                  formFields: preparedQuestions,
                                },
                              );
                            }

                            await refreshProducts();
                            setCategoryBuilderName(normalizedCategory);
                            resetProductBuilder({ keepCategory: normalizedCategory });
                            return { mode: editingProductId ? 'updated' : 'created' };
                          })
                        }
                      >
                        {editingProductId ? 'Update Product' : 'Create Product'}
                      </Button>

                      {editingProductId ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="sm:flex-1"
                          onClick={() => resetProductBuilder()}
                        >
                          Cancel Edit
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CatalogStepPanel>
              </CardContent>
            ) : null}
          </Card>
          {isSuperAdmin ? (
            <Card
              className="border-border/70 bg-card/75 shadow-lg shadow-black/10 backdrop-blur"
              data-tutorial="super-admin-card"
            >
              <DashboardSectionHeader
                sectionId="super-admin"
                isOpen={openDashboardSections.includes('super-admin')}
                onToggle={toggleDashboardSection}
                icon={Shield}
                title="Super Admin"
                description="Global operations only visible to super-admin sessions."
                summaryItems={superAdminSummaryItems}
                action={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Show tutorial info for Super Admin"
                    onClick={() =>
                      runDashboardTutorial({ markSeen: true, startAtStepId: 'super-admin-card' })
                    }
                  >
                    <Info className="size-4" />
                  </Button>
                }
              />
              {openDashboardSections.includes('super-admin') ? (
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="global-bot-token">Global Bot Token</Label>
                    <Input
                      id="global-bot-token"
                      value={botToken}
                      onChange={(event) => setBotToken(event.target.value)}
                      type="password"
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={state.loading}
                    onClick={() =>
                      runAction(() => {
                        if (!botToken.trim()) {
                          throw new Error('Bot token is required.');
                        }

                        return apiCall('/api/admin/bot-token', 'POST', { token: botToken.trim() });
                      })
                    }
                  >
                    Rotate Bot Token
                  </Button>

                  <Separator />

                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      data-tutorial="super-admin-list-tenants"
                      disabled={state.loading}
                      onClick={() => runAction(() => apiCall('/api/admin/tenants'))}
                    >
                      List All Tenants
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      data-tutorial="super-admin-list-users"
                      disabled={state.loading}
                      onClick={() => runAction(() => apiCall('/api/admin/users'))}
                    >
                      List All Users
                    </Button>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          ) : null}
        </section>

        <Card
          className="border-border/70 bg-card/75 shadow-lg shadow-black/10 backdrop-blur"
          data-tutorial="latest-action"
        >
          <DashboardSectionHeader
            sectionId="latest-action"
            isOpen={openDashboardSections.includes('latest-action')}
            onToggle={toggleDashboardSection}
            icon={Activity}
            title="Latest Action"
            description="Real-time result from your last dashboard API call."
            summaryItems={latestActionSummaryItems}
            action={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Show tutorial info for Latest Action"
                onClick={() =>
                  runDashboardTutorial({ markSeen: true, startAtStepId: 'latest-action' })
                }
              >
                <Info className="size-4" />
              </Button>
            }
          />
          {openDashboardSections.includes('latest-action') ? (
            <CardContent className="space-y-3">
              {state.loading ? (
                <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Processing request...
                </div>
              ) : null}

              {state.error ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4" />
                  <span>{state.error}</span>
                </div>
              ) : null}

              {state.response ? (
                <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                  <p className="mb-2 inline-flex items-center gap-2 text-emerald-200">
                    <CheckCircle2 className="size-4" />
                    Request succeeded
                  </p>
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-emerald-100/90">
                    {state.response}
                  </pre>
                </div>
              ) : null}

              {!state.loading && !state.error && !state.response ? (
                <p className="text-sm text-muted-foreground">No actions yet in this session.</p>
              ) : null}
            </CardContent>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
