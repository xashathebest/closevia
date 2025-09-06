import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Props = { show: boolean; onClose?: () => void };

export const LoopNotification: React.FC<Props> = ({ show, onClose }) => {
	return (
		<AnimatePresence>
			{show && (
				<motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="fixed left-1/2 top-6 z-50 -translate-x-1/2">
					<div className="relative rounded-md bg-white px-5 py-3 shadow-lg ring-1 ring-emerald-200">
						<div className="text-emerald-600 font-semibold">Loop Trade Found!</div>
						<div className="text-xs text-gray-500">We found a 3-way trade loop you can join.</div>
						<button onClick={onClose} className="absolute right-2 top-2 text-gray-400 hover:text-gray-600">✕</button>
						<div className="pointer-events-none absolute -inset-2">
							<motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1.2, opacity: 0.3 }} transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut', repeatType: 'mirror' }} className="h-full w-full rounded-md bg-emerald-200" />
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
};

export default LoopNotification;


