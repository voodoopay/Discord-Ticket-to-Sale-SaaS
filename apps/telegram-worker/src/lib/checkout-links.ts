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
