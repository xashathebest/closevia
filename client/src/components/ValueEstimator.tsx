import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type Signals = { views?: number; saves?: number; messages?: number; trade_offers?: number };

type Props = {
	apiBase?: string;
	marketPriceCents?: number;
	categoryId: number;
	condition: 'NEW' | 'LIKE_NEW' | 'USED' | 'HEAVILY_USED' | 'DEFECTIVE';
	signals?: Signals;
};

export const ValueEstimator: React.FC<Props> = ({ apiBase = '/api', marketPriceCents, categoryId, condition, signals }) => {
	const [loading, setLoading] = useState(false);
	const [data, setData] = useState<{ approx_points: number; approx_cash_usd: number; confidence: number; breakdown: Record<string, number> } | null>(null);

	const payload = useMemo(() => ({ market_price_cents: marketPriceCents || 0, category_id: categoryId, condition, signals }), [marketPriceCents, categoryId, condition, signals]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		axios.post(`${apiBase}/valuation/preview`, payload)
			.then(r => { if (!cancelled) setData(r.data); })
			.catch(() => { if (!cancelled) setData(null); })
			.finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, [apiBase, payload]);

	return (
		<div className="w-full rounded-md border p-4">
			<div className="text-sm text-gray-500">Approx. Value</div>
			{loading && <div className="animate-pulse text-gray-400">Calculating…</div>}
			{!loading && data && (
				<div className="mt-1">
					<div className="text-xl font-semibold">{data.approx_points.toLocaleString()} pts <span className="text-gray-500 text-base">(~₱{data.approx_cash_usd.toFixed(2)})</span></div>
					<div className="mt-2 text-xs text-gray-500">Confidence: {(data.confidence * 100).toFixed(0)}%</div>
					<div className="mt-2 grid grid-cols-3 gap-2 text-xs">
						<div className="rounded bg-gray-50 p-2">Cond × {data.breakdown['condition_multiplier']?.toFixed(2)}</div>
						<div className="rounded bg-gray-50 p-2">Cat × {data.breakdown['category_multiplier']?.toFixed(2)}</div>
						<div className="rounded bg-gray-50 p-2">Demand × {data.breakdown['demand_multiplier']?.toFixed(2)}</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default ValueEstimator;


