import type { DriveStep } from 'driver.js';

export const DASHBOARD_TUTORIAL_COOKIE_KEY = 'vd_dashboard_tutorial_seen_v1';
export const DASHBOARD_TUTORIAL_STORAGE_KEY = 'vd_dashboard_tutorial_seen_v1';

const DASHBOARD_TUTORIAL_MARKER_VALUE = '1';
const DASHBOARD_TUTORIAL_MAX_AGE_SECONDS = 2147483647;

type TutorialRole = 'all' | 'super_admin';

export type DashboardTutorialStepDef = {
  id: string;
  selector: string;
  title: string;
  description: string;
  role: TutorialRole;
};

type DashboardTutorialSectionJumpDef = {
  id: string;
  label: string;
  stepId: string;
  role: TutorialRole;
};

export type DashboardTutorialSectionJump = {
  id: string;
  label: string;
  stepId: string;
  stepIndex: number;
};

export const DASHBOARD_TUTORIAL_STEP_DEFS: DashboardTutorialStepDef[] = [
  {
    id: 'welcome',
    selector: "[data-tutorial='dashboard-title']",
    title: 'Welcome',
    description:
      'This dashboard configures your full ticket-to-sale stack in order: workspace/server, sales settings, payment integrations, coupons, and products.',
    role: 'all',
  },
  {
    id: 'workspace-select',
    selector: '#workspace-select',
    title: 'Workspace Selection',
    description:
      'Choose the merchant workspace you are editing. Switch this when you manage multiple stores so changes are saved to the correct business.',
    role: 'all',
  },
  {
    id: 'discord-server-select',
    selector: '#discord-server-select',
    title: 'Server Selection',
    description:
      'Pick the Discord server tied to this workspace. A server is linked to one workspace at a time, so always confirm this before saving anything.',
    role: 'all',
  },
  {
    id: 'workspace-create-toggle',
    selector: "[data-tutorial='workspace-create-toggle']",
    title: 'Create Workspace',
    description:
      'Use this when onboarding a brand-new merchant. Reuse an existing workspace when you only need to adjust an already-live setup.',
    role: 'all',
  },
  {
    id: 'workspace-name',
    selector: '#workspace-name',
    title: 'Workspace Name Input',
    description:
      'Set a clear workspace name because support and operations use it to identify merchant scope quickly.',
    role: 'all',
  },
  {
    id: 'workspace-delete',
    selector: "[data-tutorial='workspace-delete']",
    title: 'Delete Workspace',
    description:
      'This permanently removes workspace-linked data. Use only for explicit cleanup when you are certain the merchant environment should be retired.',
    role: 'all',
  },
  {
    id: 'bot-install-status',
    selector: "[data-tutorial='bot-install-status']",
    title: 'Bot Install Status',
    description:
      'The bot must be in the selected server before configuration actions can run. Resolve this first to avoid blocked save calls.',
    role: 'all',
  },
  {
    id: 'context-preview',
    selector: "[data-tutorial='context-preview']",
    title: 'Current Context Panel',
    description:
      'This preview confirms workspace/server and key values. Check it before major edits so settings never land in the wrong context.',
    role: 'all',
  },
  {
    id: 'paid-log-channel',
    selector: '#paid-log-channel',
    title: 'Paid Log Channel',
    description:
      'Choose where paid-order events are posted. Use a staff-only channel so support can audit and react quickly to payment outcomes.',
    role: 'all',
  },
  {
    id: 'staff-roles',
    selector: "[data-tutorial='staff-roles']",
    title: 'Staff Roles',
    description:
      'These roles are allowed to run /sale flows. Keep this restricted to trusted operators to prevent misuse.',
    role: 'all',
  },
  {
    id: 'tip-enabled',
    selector: '#tip-enabled',
    title: 'Tip Toggle',
    description:
      'Enable this when you want an optional tip prompt before checkout link generation. Disable it for a shorter purchase flow.',
    role: 'all',
  },
  {
    id: 'point-value',
    selector: '#point-value',
    title: 'Point Value',
    description:
      'This controls redemption value per point. It does not change earn rate, which stays fixed at 1 point per 1.00 spent on eligible categories.',
    role: 'all',
  },
  {
    id: 'referral-reward',
    selector: '#referral-reward',
    title: 'Referral Fallback Reward',
    description:
      'Used only when eligible purchased variants do not define their own referral reward. Set to zero if you want variant-only rewards.',
    role: 'all',
  },
  {
    id: 'referral-categories',
    selector: "[data-tutorial='referral-categories']",
    title: 'Referral Eligibility Categories',
    description:
      'Scope referral rewards to selected categories. Leave empty to allow all categories to participate.',
    role: 'all',
  },
  {
    id: 'referral-log-channel',
    selector: '#referral-log-channel',
    title: 'Referral Log Channel',
    description:
      'Optional channel for referral payout events. Use this when you need operational visibility into referral reward grants.',
    role: 'all',
  },
  {
    id: 'referral-submission-template',
    selector: '#referral-submission-template',
    title: 'Referral Submission Template',
    description:
      'Customize the private success reply for /refer submissions. Supported placeholders here are {submitter_mention}, {referrer_email}, and {referred_email}.',
    role: 'all',
  },
  {
    id: 'referral-thank-you-template',
    selector: '#referral-thank-you-template',
    title: 'Referral Thank-You Template',
    description:
      'Customize the referrer DM sent after payout. Supported placeholders here are {referrer_mention}, {referrer_email}, {referred_email}, {points}, {amount_gbp}, and {order_session_id}.',
    role: 'all',
  },
  {
    id: 'points-earn-categories',
    selector: "[data-tutorial='points-earn-categories']",
    title: 'Earn Categories',
    description:
      'Only purchases in these categories generate points. Configure this to align rewards with your profitability strategy.',
    role: 'all',
  },
  {
    id: 'points-redeem-categories',
    selector: "[data-tutorial='points-redeem-categories']",
    title: 'Redeem Categories',
    description:
      'Points can only be spent on items in these categories. Use this to protect restricted products from point redemptions.',
    role: 'all',
  },
  {
    id: 'customer-points-search',
    selector: "[data-tutorial='customer-points-search']",
    title: 'Customer Points Search',
    description:
      'Look up point balances by customer email for support and account checks. Leave search empty to fetch recent accounts quickly.',
    role: 'all',
  },
  {
    id: 'points-adjust-email',
    selector: '#points-adjust-email',
    title: 'Points Adjust Email',
    description:
      'Enter the exact customer email to target the right account. Email is the identity key for points in this server scope.',
    role: 'all',
  },
  {
    id: 'points-adjust-value',
    selector: '#points-adjust-value',
    title: 'Points Adjust Value',
    description:
      'Use whole positive numbers for manual add/remove actions. Apply adjustments for support corrections and approved goodwill credits.',
    role: 'all',
  },
  {
    id: 'save-server-settings',
    selector: "[data-tutorial='save-server-settings']",
    title: 'Save Server Settings',
    description:
      'Commit all sales/reward settings for the selected context. Save after changes, then validate behavior in a live sale flow.',
    role: 'all',
  },
  {
    id: 'wallet-address',
    selector: '#wallet-address',
    title: 'Merchant Wallet Address',
    description:
      'This is the payout destination for payment processing. A wrong address can route funds incorrectly, so verify carefully.',
    role: 'all',
  },
  {
    id: 'checkout-domain',
    selector: '#checkout-domain',
    title: 'Checkout Domain',
    description:
      'Hosted checkout stays pinned to checkout.voodoo-pay.uk so new merchants can save immediately without configuring a separate host.',
    role: 'all',
  },
  {
    id: 'callback-secret',
    selector: '#callback-secret',
    title: 'Callback Secret',
    description:
      'Optional manual callback secret override. Leave empty to preserve or auto-generate a secure value when supported.',
    role: 'all',
  },
  {
    id: 'save-voodoo',
    selector: "[data-tutorial='save-voodoo']",
    title: 'Save Voodoo Integration',
    description:
      'Save integration settings to generate/refresh webhook details. Always copy resulting keys to your payment provider config.',
    role: 'all',
  },
  {
    id: 'voodoo-webhook',
    selector: "[data-tutorial='voodoo-webhook']",
    title: 'Webhook Output',
    description:
      'Use this URL and key in provider callbacks so paid events can finalize orders and trigger Discord confirmations.',
    role: 'all',
  },
  {
    id: 'coupons-refresh',
    selector: "[data-tutorial='coupons-refresh']",
    title: 'Coupons Refresh and List',
    description:
      'Refresh to sync current coupon records for this server. Review before edits so you do not overwrite recent changes.',
    role: 'all',
  },
  {
    id: 'coupon-code',
    selector: '#coupon-code',
    title: 'Coupon Code',
    description:
      'Define a unique customer-facing code. Keep naming clear and campaign-specific for easier support and reporting.',
    role: 'all',
  },
  {
    id: 'coupon-discount',
    selector: '#coupon-discount',
    title: 'Coupon Discount',
    description:
      'Fixed discount amount applied during basket calculation, capped so totals do not go below zero.',
    role: 'all',
  },
  {
    id: 'coupon-active',
    selector: '#coupon-active',
    title: 'Coupon Active Toggle',
    description:
      'Disable a coupon without deleting it when you need temporary pauses for campaign control.',
    role: 'all',
  },
  {
    id: 'coupon-product-scope',
    selector: "[data-tutorial='coupon-product-scope']",
    title: 'Coupon Product Scope',
    description:
      'Limit a coupon to selected products. Leave empty for broader eligibility across all products.',
    role: 'all',
  },
  {
    id: 'coupon-variant-scope',
    selector: "[data-tutorial='coupon-variant-scope']",
    title: 'Coupon Variation Scope',
    description:
      'Add fine-grained targeting at variation level. Use this for precise promotions on specific price options.',
    role: 'all',
  },
  {
    id: 'save-coupon',
    selector: "[data-tutorial='save-coupon']",
    title: 'Save Coupon',
    description:
      'Create or update coupon records for this server. Use this action after validating code, amount, and scope.',
    role: 'all',
  },
  {
    id: 'products-refresh',
    selector: "[data-tutorial='products-refresh']",
    title: 'Existing Products',
    description:
      'Refresh and review current products before edits. This is the main control surface for product lifecycle management.',
    role: 'all',
  },
  {
    id: 'category-builder-existing',
    selector: '#category-builder-existing',
    title: 'Category Question Reuse',
    description:
      'Load an existing category to reuse shared question templates. This keeps checkout data collection consistent across products.',
    role: 'all',
  },
  {
    id: 'category-builder-name',
    selector: '#category-builder-name',
    title: 'New Category Draft',
    description:
      'Type new category names here when creating product families. Keep naming consistent for clean rewards and coupon scoping.',
    role: 'all',
  },
  {
    id: 'category-rename-to',
    selector: '#category-rename-to',
    title: 'Rename or Delete Category',
    description:
      'Renames apply to all products in that category, and deletion removes all of them. Use carefully and confirm impact first.',
    role: 'all',
  },
  {
    id: 'question-list',
    selector: "[data-tutorial='question-list']",
    title: 'Question Rules',
    description:
      'Questions define checkout form data. The email system field stays locked because it powers points, referrals, and customer matching.',
    role: 'all',
  },
  {
    id: 'question-key',
    selector: '#question-key',
    title: 'Question Key',
    description:
      'Use stable, unique keys for each field to avoid collisions and keep downstream data mapping reliable.',
    role: 'all',
  },
  {
    id: 'question-label',
    selector: '#question-label',
    title: 'Question Label',
    description:
      'This is customer-facing text in the modal flow. Keep labels explicit so customers submit the right information.',
    role: 'all',
  },
  {
    id: 'question-type',
    selector: '#question-type',
    title: 'Question Type',
    description:
      'Choose input type based on data needs: short/long text, email, or number. Proper typing improves data quality.',
    role: 'all',
  },
  {
    id: 'question-required',
    selector: '#question-required',
    title: 'Required Toggle',
    description:
      'Required fields must be completed before checkout link generation. Use this only for information truly needed to deliver.',
    role: 'all',
  },
  {
    id: 'question-sensitive',
    selector: '#question-sensitive',
    title: 'Sensitive Toggle',
    description:
      'Mark sensitive fields when they should receive stricter handling and safer display behavior in logs and staff views.',
    role: 'all',
  },
  {
    id: 'save-category-questions',
    selector: "[data-tutorial='save-category-questions']",
    title: 'Save Category Questions',
    description:
      'Persist question templates for the selected category once at least one product exists there. New products then inherit this set.',
    role: 'all',
  },
  {
    id: 'product-category',
    selector: '#product-category',
    title: 'Product Category',
    description:
      'Assign each product to the correct category because rewards, coupons, and question reuse all depend on it.',
    role: 'all',
  },
  {
    id: 'product-name',
    selector: '#product-name',
    title: 'Product Name',
    description:
      'Use clear customer-facing names so buyers and staff can identify the intended item without confusion.',
    role: 'all',
  },
  {
    id: 'product-description',
    selector: '#product-description',
    title: 'Product Description',
    description:
      'Optional detail shown in flow context. Add concise specifics when buyers need extra clarity before payment.',
    role: 'all',
  },
  {
    id: 'product-active',
    selector: '#product-active',
    title: 'Product Active Toggle',
    description:
      'Deactivate products temporarily instead of deleting when you may re-enable them later.',
    role: 'all',
  },
  {
    id: 'variant-label',
    selector: '#variant-label',
    title: 'Price Option Label',
    description:
      'Differentiate variants clearly, such as duration or quantity, so customers choose the correct option.',
    role: 'all',
  },
  {
    id: 'variant-price',
    selector: '#variant-price',
    title: 'Price Amount',
    description:
      'Enter major currency values like 9.99. Validation prevents invalid or negative values.',
    role: 'all',
  },
  {
    id: 'variant-referral-reward',
    selector: '#variant-referral-reward',
    title: 'Variant Referral Reward',
    description:
      'Set per-variant referral rewards to override fallback amounts with precise incentives for specific items.',
    role: 'all',
  },
  {
    id: 'save-product',
    selector: "[data-tutorial='save-product']",
    title: 'Save Product',
    description:
      'Create or update product records after category, pricing, and question requirements are valid.',
    role: 'all',
  },
  {
    id: 'super-admin-card',
    selector: "[data-tutorial='super-admin-card']",
    title: 'Super Admin Overview',
    description:
      'This section contains global operations across tenants. Use only with strict operational controls and approval.',
    role: 'super_admin',
  },
  {
    id: 'global-bot-token',
    selector: '#global-bot-token',
    title: 'Rotate Bot Token',
    description:
      'Use this for controlled credential rotation. Coordinate rollout to avoid accidental bot downtime.',
    role: 'super_admin',
  },
  {
    id: 'super-admin-list-tenants',
    selector: "[data-tutorial='super-admin-list-tenants']",
    title: 'List All Tenants',
    description:
      'Operational support tool for global tenant visibility, audits, and incident triage.',
    role: 'super_admin',
  },
  {
    id: 'super-admin-list-users',
    selector: "[data-tutorial='super-admin-list-users']",
    title: 'List All Users',
    description:
      'Global user visibility for security checks, account investigations, and administrative support.',
    role: 'super_admin',
  },
  {
    id: 'latest-action',
    selector: "[data-tutorial='latest-action']",
    title: 'Latest Action Panel',
    description:
      'This panel shows immediate success or error output from dashboard actions and is the first place to troubleshoot.',
    role: 'all',
  },
  {
    id: 'run-tutorial-button',
    selector: "[data-tutorial='run-tutorial-button']",
    title: 'Replay Tutorial',
    description:
      'Use this button any time to rerun onboarding for refreshers or team handover sessions.',
    role: 'all',
  },
];

const DASHBOARD_TUTORIAL_SECTION_JUMP_DEFS: DashboardTutorialSectionJumpDef[] = [
  {
    id: 'overview',
    label: 'Overview',
    stepId: 'welcome',
    role: 'all',
  },
  {
    id: 'workspace-server',
    label: 'Workspace + Discord Server',
    stepId: 'workspace-select',
    role: 'all',
  },
  {
    id: 'sales-settings',
    label: 'Server Sales Settings',
    stepId: 'paid-log-channel',
    role: 'all',
  },
  {
    id: 'voodoo-pay',
    label: 'Voodoo Pay Integration',
    stepId: 'wallet-address',
    role: 'all',
  },
  {
    id: 'coupons',
    label: 'Coupons',
    stepId: 'coupons-refresh',
    role: 'all',
  },
  {
    id: 'products',
    label: 'Products and Questions',
    stepId: 'products-refresh',
    role: 'all',
  },
  {
    id: 'super-admin',
    label: 'Super Admin',
    stepId: 'super-admin-card',
    role: 'super_admin',
  },
  {
    id: 'latest-action',
    label: 'Latest Action',
    stepId: 'latest-action',
    role: 'all',
  },
];

function readCookieValue(cookieString: string, key: string): string | null {
  const segments = cookieString
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const cookieKey = segment.slice(0, separatorIndex).trim();
    if (cookieKey !== key) {
      continue;
    }

    return segment.slice(separatorIndex + 1).trim();
  }

  return null;
}

export function hasDashboardTutorialMarker(cookieString: string, localStorageValue: string | null): boolean {
  const cookieMarker = readCookieValue(cookieString, DASHBOARD_TUTORIAL_COOKIE_KEY);
  if (cookieMarker === DASHBOARD_TUTORIAL_MARKER_VALUE) {
    return true;
  }

  return localStorageValue?.trim() === DASHBOARD_TUTORIAL_MARKER_VALUE;
}

export function buildDashboardTutorialCookie(params: { secure: boolean }): string {
  const segments = [
    `${DASHBOARD_TUTORIAL_COOKIE_KEY}=${DASHBOARD_TUTORIAL_MARKER_VALUE}`,
    `Max-Age=${DASHBOARD_TUTORIAL_MAX_AGE_SECONDS}`,
    'Path=/',
    'SameSite=Lax',
  ];

  if (params.secure) {
    segments.push('Secure');
  }

  return segments.join('; ');
}

export function buildDashboardTutorialStepDefs(params: { isSuperAdmin: boolean }): DashboardTutorialStepDef[] {
  return DASHBOARD_TUTORIAL_STEP_DEFS.filter((step) => (step.role === 'all' ? true : params.isSuperAdmin));
}

export function buildDashboardTutorialSectionJumps(params: {
  isSuperAdmin: boolean;
}): DashboardTutorialSectionJump[] {
  const stepDefs = buildDashboardTutorialStepDefs(params);
  const stepIndexes = new Map(stepDefs.map((step, index) => [step.id, index]));

  return DASHBOARD_TUTORIAL_SECTION_JUMP_DEFS.filter((section) =>
    section.role === 'all' ? true : params.isSuperAdmin,
  )
    .map((section) => {
      const stepIndex = stepIndexes.get(section.stepId);
      if (stepIndex === undefined) {
        return null;
      }

      return {
        id: section.id,
        label: section.label,
        stepId: section.stepId,
        stepIndex,
      };
    })
    .filter((section): section is DashboardTutorialSectionJump => section !== null);
}

export function buildDashboardTutorialSteps(params: { isSuperAdmin: boolean }): DriveStep[] {
  return buildDashboardTutorialStepDefs(params).map((step) => ({
    element: step.selector,
    popover: {
      title: step.title,
      description: step.description,
      side: 'bottom',
      align: 'start',
    },
  }));
}
