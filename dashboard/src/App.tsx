import { Routes, Route } from 'react-router-dom';

import { Layout } from '@/components/Layout';
import { Logs } from '@/pages/Logs';
import { Market } from '@/pages/Market';
import { MarketDetail } from '@/pages/MarketDetail';
import { Overview } from '@/pages/Overview';
import { Positions } from '@/pages/Positions';
import { Signals } from '@/pages/Signals';

function App() {
	return (
		<Layout>
			<Routes>
				<Route path="/" element={<Overview />} />
				<Route path="/positions" element={<Positions />} />
				<Route path="/market" element={<Market />} />
				<Route path="/market/:symbol" element={<MarketDetail />} />
				<Route path="/signals" element={<Signals />} />
				<Route path="/logs" element={<Logs />} />
			</Routes>
		</Layout>
	);
}

export default App;
