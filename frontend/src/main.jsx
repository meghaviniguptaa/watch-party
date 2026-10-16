import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// No <StrictMode>: its dev double-mount would open and drop a WebSocket, leaving a ghost participant for the grace period.
createRoot(document.getElementById('root')).render(<App />);
