import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { queryClient } from './lib/queries';
import { installErrorReporting } from './lib/report';
// Served from this site: a font from another domain would add two slow connections before the first paint.
import '@fontsource-variable/onest';
import './styles.css';

installErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary variant="app">
        <App/>
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>
);
