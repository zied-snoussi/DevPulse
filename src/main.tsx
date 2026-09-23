import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './store';
import { FeedbackProvider } from './components/feedback';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </StoreProvider>
  </StrictMode>
);
