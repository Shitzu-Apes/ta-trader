import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Overview } from '@/pages/Overview';
import { Positions } from '@/pages/Positions';
import { Market } from '@/pages/Market';
import { Signals } from '@/pages/Signals';
import { Logs } from '@/pages/Logs';

function App() {
	return (
		<Layout>
			<Routes>
				<Route path="/" element={<Overview />} />
				<Route path="/positions" element={<Positions />} />
				<Route path="/market" element={<Market />} />
				<Route path="/signals" element={<Signals />} />
				<Route path="/logs" element={<Logs />} />
			</Routes>
		</Layout>
	);
}

export default App;
