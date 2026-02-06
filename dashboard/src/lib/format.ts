export const formatCurrency = (value: number | null | undefined, decimals = 2): string => {
	if (value === undefined || value === null) return '-';
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	}).format(value);
};

export const formatNumber = (value: number | null | undefined, decimals = 2): string => {
	if (value === undefined || value === null) return '-';
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	}).format(value);
};

export const formatPercent = (value: number | null | undefined, decimals = 2): string => {
	if (value === undefined || value === null) return '-';
	return new Intl.NumberFormat('en-US', {
		style: 'percent',
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
		signDisplay: 'exceptZero'
	}).format(value / 100);
};

export const formatScore = (value: number | null | undefined, decimals = 2): string => {
	if (value === undefined || value === null) return '-';
	const sign = value >= 0 ? '+' : '';
	return `${sign}${formatNumber(value, decimals)}`;
};
