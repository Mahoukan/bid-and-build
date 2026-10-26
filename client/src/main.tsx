import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App.js';
import { AppearanceProvider } from './appearance/Appearance.js';
import { applyAppearance } from './appearance/model.js';
import { readSettings } from './appearance/storage.js';
import './styles.css';
import { startPwa } from './pwa.js';
import { startServerMonitor } from './serverConnection.js';

const router = createBrowserRouter([{ path: '*', element: <App /> }]);
applyAppearance(readSettings().preferences);
startServerMonitor();
startPwa();
createRoot(document.getElementById('root')!).render(<StrictMode><AppearanceProvider><RouterProvider router={router} /></AppearanceProvider></StrictMode>);
