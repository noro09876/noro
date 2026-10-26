import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './design/tokens.css';
import './design/base.css';
import './design/components.css';
import './design/site.css';
import { App } from './App';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}
