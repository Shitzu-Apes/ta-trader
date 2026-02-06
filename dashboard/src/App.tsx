import { Routes, Route } from 'react-router-dom';

import { Layout } from '@/components/Layout';
import { Logs } from '@/pages/Logs';
import { MarketDetail } from '@/pages/MarketDetail';
import { Markets } from '@/pages/Markets';
import { Orders } from '@/pages/Orders';
import { Overview } from '@/pages/Overview';
import { Positions } from '@/pages/Positions';
function App() {
	return (
		<Layout>
			<Routes>
				<Route path="/" element={<Overview />} />
				<Route path="/positions" element={<Positions />} />
				<Route path="/orders" element={<Orders />} />
				<Route path="/markets" element={<Markets />} />
				<Route path="/markets/:symbol" element={<MarketDetail />} />
				<Route path="/logs" element={<Logs />} />
			</Routes>
		</Layout>
	);
}

export default App;
