import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react({
            // Enable React 17+ JSX transform
            jsxRuntime: 'automatic'
        }),
        VitePWA({
            registerType: 'autoUpdate',
            injectRegister: false,
            manifest: false,
            workbox: {
                maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
                runtimeCaching: [
                    {
                        urlPattern: ({ request }) => request.destination === 'document',
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'pages-cache',
                            networkTimeoutSeconds: 5,
                        },
                    },
                    // ⚡ OPTIMIZED: Firebase auth iframe and other critical scripts
                    // Cache for 1 year (31 days * 365 = 11,315 days)
                    // Firebase versioning ensures updates without manual invalidation
                    {
                        urlPattern: /^https:\/\/.*\.firebaseapp\.com\/.*\/(auth\/)?(iframe|__)?.*\.js$/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'firebase-auth-cache',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    // ⚡ OPTIMIZED: Firebase Realtime Database + Cloud Messaging
                    {
                        urlPattern: /^https:\/\/(www\.)?firebase\.googleapis\.com\/.*/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'firebase-api-cache',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    // ⚡ OPTIMIZED: Google Fonts (versioned URLs never change)
                    {
                        urlPattern: /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\/.*/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'google-fonts-cache',
                            expiration: {
                                maxEntries: 100,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year - fonts URLs are versioned
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    // ⚡ OPTIMIZED: Cloudinary images (versioned URLs won't change)
                    {
                        urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'cloudinary-cache',
                            expiration: {
                                maxEntries: 200,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    // ⚡ OPTIMIZED: CDN images and assets (long cache)
                    {
                        urlPattern: /^https:\/\/(cdn\.|images\.).*/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'cdn-cache',
                            expiration: {
                                maxEntries: 100,
                                maxAgeSeconds: 60 * 60 * 24 * 180, // 6 months
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    {
                        urlPattern: ({ request }) => ['script', 'style', 'worker'].includes(request.destination),
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'assets-cache',
                            expiration: {
                                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days for local assets
                            },
                        },
                    },
                    {
                        urlPattern: ({ request }) => request.destination === 'image',
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'images-cache',
                            expiration: {
                                maxEntries: 100,
                                maxAgeSeconds: 60 * 60 * 24 * 30,
                            },
                        },
                    },
                ],
            },
            devOptions: {
                enabled: false,
            },
        }),
    ],
    define: {
        // Fix for: Uncaught ReferenceError: __HMR_CONFIG_NAME__ is not defined
        __HMR_CONFIG_NAME__: JSON.stringify('vite'),
    },
    build: {
        // CSS code splitting to prevent render-blocking CSS
        cssCodeSplit: true,
        // Reduce CSS output size with minification
        cssMinify: 'lightningcss',
        // Generate target compatibility for better CSS optimization
        target: 'esnext',
        // Rollup optimization for better module splitting
        rollupOptions: {
            output: {
                // Manual chunks configuration for optimal splitting
                manualChunks(id) {
                    // Keep React and React-DOM in main vendor bundle (don't separate!)
                    // React must be available to all components that depend on it
                    if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
                        return 'vendor';
                    }
                    // Keep react-leaflet and leaflet with React (they depend on React)
                    if (id.includes('react-leaflet') || id.includes('leaflet')) {
                        return 'vendor'; // Don't separate - needs React from vendor
                    }
                    // Keep all other node_modules in vendor too
                    if (id.includes('node_modules')) {
                        return 'vendor';
                    }
                    // Split large components into route-based chunks
                    if (id.includes('/pages/') || id.includes('/components/')) {
                        const match = id.match(/\/(pages|components)\/(\w+)/);
                        if (match)
                            return `${match[1]}-${match[2]}`;
                    }
                },
                // Async loading for dynamically imported modules
                assetFileNames: (assetInfo) => {
                    const name = assetInfo.name || 'asset';
                    const info = name.split('.');
                    const ext = info[info.length - 1];
                    if (ext === 'css') {
                        // CSS files stay in assets folder
                        return 'assets/styles/[name]-[hash][extname]';
                    }
                    else if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) {
                        // Images get versioned
                        return 'assets/images/[name]-[hash][extname]';
                    }
                    return 'assets/[name]-[hash][extname]';
                },
            },
        },
    },
    server: {
        host: true,
        port: 5173,
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        },
        hmr: {
            host: 'localhost',
            port: 5173,
            protocol: 'ws',
        },
        proxy: {
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
                secure: false,
            },
        },
    },
    preview: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        },
    },
});
