import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App.js';
import { AppearanceProvider } from './appearance/Appearance.js';
import { applyAppearance } from './appearance/model.js';
import { readSettings } from './appearance/storage.js';
import './styles.css';

const router = createBrowserRouter([{ path: '*', element: <App /> }]);
applyAppearance(readSettings().preferences);
createRoot(document.getElementById('root')!).render(<StrictMode><AppearanceProvider><RouterProvider router={router} /></AppearanceProvider></StrictMode>);
