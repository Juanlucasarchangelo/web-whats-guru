import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Aplicar o tema antes da montagem do React evita flash do tema errado.
let savedTheme: string | null = null;
try { savedTheme = localStorage.getItem('whats-guru-theme'); } catch { /* modo privado */ }
document.documentElement.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
