const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'decimal',
  maximumFractionDigits: 4,
  minimumFractionDigits: 2
});

export const sanitizeCurrencyInput = (value: number | string | null | undefined): number => {
  if (typeof value === 'number') {
    const sanitized = Number.isFinite(value) ? parseFloat(value.toFixed(4)) : 0;
    return sanitized;
  }

  if (typeof value === 'string') {
    const cleaned = value
      .replace(/[^0-9,.-]/g, '')
      .replace(',', '.');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parseFloat(parsed.toFixed(4)) : 0;
  }

  return 0;
};

export const formatCurrencyValue = (value: number | string | null | undefined): string => {
  const numeric = sanitizeCurrencyInput(value);
  return `${currencyFormatter.format(numeric)} FCFA`;
};

export const formatSignedCurrencyValue = (value: number | string | null | undefined): string => {
  const numeric = sanitizeCurrencyInput(value);
  const formatted = formatCurrencyValue(Math.abs(numeric));

  if (numeric > 0) return `+${formatted}`;
  if (numeric < 0) return `-${formatted}`;
  return formatted;
};
