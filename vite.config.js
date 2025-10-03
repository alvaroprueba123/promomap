import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'Promomap',
        short_name: 'Promomap',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b1220',
        theme_color: '#0b1220',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2,json}'],
        runtimeCaching: [
          // tiles OSM: cache con límite (zonas visitadas quedan offline)
          {
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 14 } // ~2 semanas
            }
          },
          // fotos remotas (Kobo): guarda las que abras
          {
            urlPattern: /^https:\/\/kc\.kobotoolbox\.org\/media\/original\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'house-photos',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      }
    })
  ]
})
