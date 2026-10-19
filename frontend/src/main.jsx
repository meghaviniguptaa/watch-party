import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import '@fontsource/jost/600.css';
import './styles.css';

// No <StrictMode>: its dev double-mount would open and drop a WebSocket, leaving a ghost participant for the grace period.
createRoot(document.getElementById('root')).render(<App />);
