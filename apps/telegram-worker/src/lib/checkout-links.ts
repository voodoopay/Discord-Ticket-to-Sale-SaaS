import type { SaleCheckoutOption } from '@voodoo/core';

export type TelegramCheckoutLinkFile = {
  label: string;
  text: string;
  fileName: string;
  caption: string;
};

export function buildTelegramCheckoutButtonLabel(input: {
  label: string;
  index: number;
  total: number;
}): string {
  if (input.total === 1 && input.index === 0) {
    return 'Open Checkout';
  }

  return input.label;
}

export function buildTelegramCheckoutLinkFiles(options: SaleCheckoutOption[]): TelegramCheckoutLinkFile[] {
  return options.map((option) => {
    return {
      label: option.label,
      text: `${option.url}\n`,
      fileName: `${slugifyTelegramCheckoutLabel(option.label)}-checkout-link.txt`,
      caption: `${option.label} exact checkout link. Open this file, copy the single URL inside it, and paste it into Chrome or Safari.`,
    };
  });
}

function slugifyTelegramCheckoutLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  return slug.length > 0 ? slug : 'checkout';
}
