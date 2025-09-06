import React, { useMemo } from 'react';

type Node = { id: string; label: string };
type Edge = { from: string; to: string };

type Props = {
	users: Array<{ userId: number; itemId: number; label: string }>;
	loop?: Array<{ userId: number; itemId: number }>;
};

export const TradeBuilderGraph: React.FC<Props> = ({ users, loop }) => {
	const { nodes, edges } = useMemo(() => {
		const ns: Node[] = users.map(u => ({ id: `${u.userId}-${u.itemId}`, label: u.label }));
		const es: Edge[] = [];
		if (loop && loop.length >= 3) {
			for (let i = 0; i < loop.length; i++) {
				const a = loop[i];
				const b = loop[(i + 1) % loop.length];
				es.push({ from: `${a.userId}-${a.itemId}`, to: `${b.userId}-${b.itemId}` });
			}
		}
		return { nodes: ns, edges: es };
	}, [users, loop]);

	return (
		<div className="w-full rounded-md border p-4">
			<div className="text-sm font-medium">Trade Loop Visualization</div>
			<div className="mt-2 grid grid-cols-3 gap-4">
				<div className="col-span-1">
					{nodes.map(n => (
						<div key={n.id} className="mb-2 rounded border bg-white p-2 shadow-sm">{n.label}</div>
					))}
				</div>
				<div className="col-span-2">
					<svg className="h-64 w-full bg-gray-50" viewBox="0 0 600 260">
						{edges.map((e, i) => {
							const idxFrom = nodes.findIndex(n => n.id === e.from);
							const idxTo = nodes.findIndex(n => n.id === e.to);
							const x1 = 80 + (idxFrom % 3) * 160;
							const y1 = 60 + Math.floor(idxFrom / 3) * 120;
							const x2 = 80 + (idxTo % 3) * 160;
							const y2 = 60 + Math.floor(idxTo / 3) * 120;
							return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0ea5e9" strokeWidth={2} markerEnd="url(#arrow)" />;
						})}
						<defs>
							<marker id="arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
								<path d="M0,0 L0,6 L6,3 z" fill="#0ea5e9" />
							</marker>
						</defs>
					</svg>
				</div>
			</div>
		</div>
	);
};

export default TradeBuilderGraph;


