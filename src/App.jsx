import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Circle, CircleMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import Fuse from 'fuse.js'
import data from './data/households.json'

import 'leaflet/dist/leaflet.css'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import icon2xUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import 'leaflet.markercluster' // cluster import estático

/* ========== Icono por defecto Leaflet (no se usa para nuestros puntos, pero evita warnings) ========== */
const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl: icon2xUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})
L.Marker.prototype.options.icon = DefaultIcon

/* ========== Punto neón único para TODOS los marcadores ========== */
const PRIMARY_MARKER_COLOR = '#FF6A3D' // cambia aquí el color global de los puntos

function neonDotIcon(color = PRIMARY_MARKER_COLOR) {
  return L.divIcon({
    className: 'mini-dot2',
    html: `<div style="background:${color}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -10],
  })
}

/* ========== Normalización de datos ========== */
function useNormalizedData(raw) {
  return useMemo(() => {
    return (raw || [])
      .map(r => ({
        ...r,
        id: String(r.id ?? '').trim(),
        promoter: (r.promoter && String(r.promoter).trim()) || 'Sin asignar',
        headName: r.headName ? String(r.headName).trim() : '',
        phone: r.phone !== undefined && r.phone !== null ? String(r.phone).trim() : '',
        dni: r.dni !== undefined && r.dni !== null ? String(r.dni).trim() : '',
        lat: Number(r.lat),
        lng: Number(r.lng),
        photo: r.photo || '',
        notes: r.notes || ''
      }))
      .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
  }, [raw])
}

/* ========== Geolocalización ========== */
function useUserLocation() {
  const [pos, setPos] = useState(null)
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      p => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 40 }),
      err => console.warn('Geolocation error:', err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  return pos
}

/* ========== Picker de promotor ========== */
function PromoterPicker({ list, onPick }) {
  const [q, setQ] = useState('')
  const names = useMemo(() => {
    const uniques = Array.from(new Set(list.map(r => r.promoter))).sort()
    const counts = uniques.map(name => ({ name, count: list.filter(r => r.promoter === name).length }))
    if (!q.trim()) return counts
    const fuse = new Fuse(counts, { keys: ['name'], threshold: 0.3 })
    return fuse.search(q).map(r => r.item)
  }, [list, q])

  return (
    <section className="promos">
      <h2 style={{ marginTop: 0 }}>Busca tu nombre</h2>
      <div className="search">
        <input
          autoFocus
          className="input"
          placeholder="Escribe tu nombre..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      <div className="grid">
        {names.map(p => (
          <button key={p.name} className="promoItem" onClick={() => onPick(p.name)}>
            <div className="promoName">{p.name}</div>
            <div className="promoCount">{p.count} puntos asignados</div>
          </button>
        ))}
        {names.length === 0 && <div style={{ opacity: 0.7 }}>No hay resultados.</div>}
      </div>
    </section>
  )
}

/* ========== Capa de clúster (con fallback) ========== */
function ClusterLayer({ points }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (!map) return

    if (layerRef.current) {
      layerRef.current.clearLayers?.()
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    const makeHtml = f => `
      <div class="popupCard">
        ${f.photo ? `<img class="popupPhoto" src="${f.photo}" alt="${f.headName || ''}" />` : ''}
        <h3 class="popupTitle">${(f.headName || 'Sin nombre')}</h3>
        ${f.address ? `<div class="popupRow">📍 ${f.address}</div>` : ''}
        ${f.phone ? `<div class="popupRow">📞 <a href="tel:${String(f.phone)}">${String(f.phone)}</a></div>` : ''}
        ${f.dni ? `<div class="popupRow">🪪 DNI: ${String(f.dni)}</div>` : ''}
        ${f.notes ? `<div class="popupRow">📝 ${f.notes}</div>` : ''}
      </div>
    `

    const supportsCluster = typeof L.markerClusterGroup === 'function'
    if (!supportsCluster) {
      const layer = L.layerGroup()
      points.forEach(f => {
        const m = L.marker([f.lat, f.lng], { icon: neonDotIcon() })
        m.bindPopup(makeHtml(f), { maxWidth: 320, className: 'cleanPopup' })
        layer.addLayer(m)
      })
      layer.addTo(map)
      layerRef.current = layer
      return () => map.removeLayer(layer)
    }

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      showCoverageOnHover: false,
      spiderfyOnEveryZoom: true,
      iconCreateFunction: (c) => {
        const count = c.getChildCount()
        let size = 'small'
        if (count >= 30) size = 'large'
        else if (count >= 10) size = 'medium'
        return L.divIcon({
          html: `<div>${count}</div>`,
          className: `marker-cluster marker-cluster-${size}`,
          iconSize: L.point(40, 40, true),
        })
      },
    })

    points.forEach(f => {
      const m = L.marker([f.lat, f.lng], { icon: neonDotIcon() })
      m.bindPopup(makeHtml(f), { maxWidth: 320, className: 'cleanPopup' })
      cluster.addLayer(m)
    })

    cluster.addTo(map)
    layerRef.current = cluster
    return () => map.removeLayer(cluster)
  }, [map, points])

  return null
}

/* ========== Lista (tarjetas simples + modal) ========== */
function ListView({ features }) {
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState(null)

  const list = useMemo(() => {
    const sorted = [...features].sort((a, b) => (a.headName || '').localeCompare(b.headName || ''))
    if (!q.trim()) return sorted
    const fuse = new Fuse(sorted, { keys: ['headName', 'address', 'dni', 'phone'], threshold: 0.35 })
    return fuse.search(q).map(r => r.item)
  }, [features, q])

  return (
    <>
      <div className="card" style={{ padding: 12 }}>
        <div className="search">
          <input
            className="input"
            placeholder="Buscar por jefe de hogar, dirección, DNI o teléfono..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <span className="badge">{list.length} resultado(s)</span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
          {list.map(f => (
            <button
              key={f.id}
              className="promoItem"
              onClick={() => setDetail(f)}
              style={{ textAlign: 'left' }}
              title="Ver detalles"
            >
              <div className="promoName">{f.headName || 'Sin nombre'}</div>
              {f.phone && <div className="row phone">📞 {f.phone}</div>}
              {f.address && <div className="row address">📍 {f.address}</div>}
            </button>
          ))}
        </div>
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>{detail.headName || 'Sin nombre'}</h3>
              <button className="btn" onClick={() => setDetail(null)}>Cerrar ✕</button>
            </header>

            <div className="meta">ID: {detail.id}{detail.dni ? ` · DNI: ${detail.dni}` : ''}</div>

            {detail.photo && <img className="photo" src={detail.photo} alt={detail.headName} />}

            {detail.address && <div className="row">📍 {detail.address}</div>}
            {detail.sector && <div className="row">🏷️ {detail.sector}</div>}
            {detail.phone && (
              <div className="row">
                📞 <a href={`tel:${detail.phone}`} onClick={e => e.stopPropagation()}>{detail.phone}</a>
              </div>
            )}
            {detail.notes && <div className="row">📝 {detail.notes}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <a
                className="btn primary"
                href={`https://www.google.com/maps?q=${detail.lat},${detail.lng}`}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
              >
                Abrir en Google Maps
              </a>
              <button className="btn" onClick={() => setDetail(null)}>Entendido</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ========== Mapa (pantalla completa real + centrar + buscador en FS) ========== */
function MapView({ features }) {
  const userPos = useUserLocation()
  const [full, setFull] = useState(false)
  const [fsQuery, setFsQuery] = useState('')
  const mapRef = useRef(null)
  const shellRef = useRef(null)

  const points = useMemo(() => {
    const base = features
      .map(f => ({ ...f, lat: Number(f.lat), lng: Number(f.lng) }))
      .filter(f => Number.isFinite(f.lat) && Number.isFinite(f.lng))
    if (!full || !fsQuery.trim()) return base
    const q = fsQuery.trim().toLowerCase()
    return base.filter(f => (f.headName || '').toLowerCase().includes(q))
  }, [features, full, fsQuery])

  const center = useMemo(() => {
    if (points.length === 0) return [-12.0464, -77.0428]
    const lat = points.reduce((s, f) => s + f.lat, 0) / points.length
    const lng = points.reduce((s, f) => s + f.lng, 0) / points.length
    return [lat, lng]
  }, [points])

  const mapKey = `${points.length}-${full ? 1 : 0}`

// Dentro de MapView
const centerOnMe = () => {
  const map = mapRef.current
  if (!map) {
    console.warn('No se pudo centrar: mapa aún no está listo')
    return
  }

  // Si ya tenemos posición del hook, centramos directo
  if (userPos?.lat && userPos?.lng) {
    map.flyTo([userPos.lat, userPos.lng], 17, { duration: 0.8 })
    return
  }

  // Fallback: pedimos una ubicación "on demand"
  map.once('locationfound', (e) => {
    map.flyTo(e.latlng, 17, { duration: 0.8 })
  })
  map.once('locationerror', (e) => {
    alert('No pudimos obtener tu ubicación. Verifica permisos de geolocalización y que estés en HTTPS.')
    console.warn('locationerror:', e)
  })

  map.locate({
    enableHighAccuracy: true,
    setView: false, // centramos nosotros en el evento
    maxZoom: 17,
    watch: false,
    timeout: 10000
  })
}



  const enterFull = async () => {
    setFull(true)
    try { await shellRef.current?.requestFullscreen?.() } catch {}
  }
  const exitFull = async () => {
    setFull(false)
    try { if (document.fullscreenElement) await document.exitFullscreen() } catch {}
  }

  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') exitFull() }
    if (full) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onEsc)
    } else {
      document.body.style.overflow = ''
      setFsQuery('')
      window.removeEventListener('keydown', onEsc)
    }
    return () => window.removeEventListener('keydown', onEsc)
  }, [full])

  return (
    <div ref={shellRef} className={`mapShell ${full ? 'full' : ''}`}>
      <div className="mapControls">
        {!full ? (
          <button className="btn" onClick={enterFull}>Pantalla completa</button>
        ) : (
          <button className="btn" onClick={exitFull}>Salir pantalla completa</button>
        )}
        <button className="btn" onClick={centerOnMe} disabled={!userPos}>Centrar en mí</button>
        {full && (
          <input
            className="mapSearch"
            placeholder="Buscar jefe de familia..."
            value={fsQuery}
            onChange={(e) => setFsQuery(e.target.value)}
          />
        )}
      </div>

      <MapContainer
        key={mapKey}
        center={center}
        zoom={14}
        scrollWheelZoom
        style={{ width:'100%', height:'100%' }}
        whenCreated={(map) => { mapRef.current = map }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {userPos && (
          <>
            <Circle
              center={[userPos.lat, userPos.lng]}
              radius={Math.max(20, userPos.accuracy || 40)}
              pathOptions={{ color:'#1e90ff', opacity:.35, fillOpacity:.1 }}
            />
            <CircleMarker
              center={[userPos.lat, userPos.lng]}
              radius={7}
              pathOptions={{ color:'#1e90ff', fill:true, fillOpacity:1 }}
            />
          </>
        )}

        <ClusterLayer points={points} />
      </MapContainer>
    </div>
  )
}

/* ========== Dashboard & App ========== */
function Dashboard({ promoter, all, onBack }) {
  const mine = useMemo(() => all.filter(x => x.promoter === promoter), [all, promoter])
  const [tab, setTab] = useState('list')

  return (
    <div className="promos" style={{ paddingTop: 0 }}>
      <div className="toolbar card" style={{ padding: 10, marginBottom: 12 }}>
        <button className="btn" onClick={onBack}>← Cambiar promotor</button>
        <span className="badge">Promotor: <strong>{promoter}</strong></span>
        <span className="legend">{mine.length} punto(s) asignados</span>
      </div>

      <div className="card" style={{ padding: 8, marginBottom: 12, display: 'flex', gap: 8 }}>
        <button className={`btn ${tab === 'list' ? 'primary' : ''}`} onClick={() => setTab('list')}>📋 Lista</button>
        <button className={`btn ${tab === 'map' ? 'primary' : ''}`} onClick={() => setTab('map')}>🗺️ Mapa</button>
      </div>

      {tab === 'list' ? <ListView features={mine} /> : <MapView features={mine} />}
    </div>
  )
}

export default function App() {
  const normalized = useNormalizedData(data)
  const [stage, setStage] = useState('pick')
  const [promoter, setPromoter] = useState(null)

  return (
    <div className="app">
      <header className="header">
        <div className="brand">📍 Mapa de Promotores</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Versión 1.4</div>
      </header>

      {stage === 'pick' && (
        <PromoterPicker
          list={normalized}
          onPick={name => { setPromoter(name); setStage('dash') }}
        />
      )}

      {stage === 'dash' && (
        <Dashboard promoter={promoter} all={normalized} onBack={() => setStage('pick')} />
      )}
    </div>
  )
}
