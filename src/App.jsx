import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import Fuse from 'fuse.js'
import data from './data/households.json'

import 'leaflet/dist/leaflet.css'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import icon2xUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

// Configurar icono por defecto de Leaflet (no afecta cuando pasamos icono custom)
const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl: icon2xUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})
L.Marker.prototype.options.icon = DefaultIcon

// Icono minimalista con L.divIcon (usa las clases de tu CSS)
function minimalIcon(variant = 'blue') {
  const cls =
    variant === 'green' ? 'mini-dot green' :
    variant === 'gray'  ? 'mini-dot gray'  : 'mini-dot'
  return L.divIcon({
    className: '',
    html: `<div class="${cls}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -8]
  })
}

// Decide color por promotor (puedes cambiar a sector si prefieres)
function variantFor(feature) {
  if (!feature.promoter || feature.promoter === 'Sin asignar') return 'gray'
  const h = [...feature.promoter].reduce((a,c)=>a+c.charCodeAt(0),0)
  return h % 2 === 0 ? 'blue' : 'green'
}

// ===== Util: normalización segura de datos =====
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

// ===== Util: geolocalización del usuario (SOLO UNA DEFINICIÓN) =====
function useUserLocation() {
  const [pos, setPos] = useState(null) // {lat,lng,accuracy}
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy ?? 40
        })
      },
      (err) => {
        console.warn('Geolocation error:', err.message)
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  return pos
}

// ===== Componente: Picker de promotor =====
function PromoterPicker({ list, onPick }) {
  const [q, setQ] = useState('')

  const names = useMemo(() => {
    const uniques = Array.from(new Set(list.map(r => r.promoter))).sort()
    const counts = uniques.map(name => ({
      name,
      count: list.filter(r => r.promoter === name).length
    }))
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
          <button
            key={p.name}
            className="promoItem"
            onClick={() => onPick(p.name)}
          >
            <div className="promoName">{p.name}</div>
            <div className="promoCount">{p.count} puntos asignados</div>
          </button>
        ))}
        {names.length === 0 && <div style={{ opacity: 0.7 }}>No hay resultados.</div>}
      </div>
    </section>
  )
}

// ===== Capa de clúster con carga dinámica y fallback =====
function ClusterLayer({ points }) {
  const map = useMap()
  const clusterRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let mounted = true
    import('leaflet.markercluster')
      .then(() => { if (mounted) setReady(true) })
      .catch((e) => {
        console.warn('No se pudo cargar leaflet.markercluster, usando marcadores simples.', e)
        setReady(false)
      })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!map) return

    // Limpia capa previa
    if (clusterRef.current) {
      clusterRef.current.clearLayers()
      map.removeLayer(clusterRef.current)
      clusterRef.current = null
    }

    // Fallback: marcadores simples (sin clustering) con icono minimalista y popup clean
    if (!ready || typeof L.markerClusterGroup !== 'function') {
      const layer = L.layerGroup()
      points.forEach(f => {
        const m = L.marker([f.lat, f.lng], { icon: minimalIcon(variantFor(f)) })
        const html = `
          <div class="popupCard">
            ${f.photo ? `<img class="popupPhoto" src="${f.photo}" alt="${f.headName || ''}" />` : ''}
            <h3 class="popupTitle">${(f.headName || 'Sin nombre')}</h3>
            ${f.address ? `<div class="popupRow">📍 ${f.address}</div>` : ''}
            ${f.phone ? `<div class="popupRow">📞 <a href="tel:${String(f.phone)}">${String(f.phone)}</a></div>` : ''}
            ${f.dni ? `<div class="popupRow">🪪 DNI: ${String(f.dni)}</div>` : ''}
            ${f.notes ? `<div class="popupRow">📝 ${f.notes}</div>` : ''}
          </div>
        `
        m.bindPopup(html, { maxWidth: 320, className: 'cleanPopup' })
        layer.addLayer(m)
      })
      layer.addTo(map)
      clusterRef.current = layer
      return () => {
        if (clusterRef.current) {
          clusterRef.current.clearLayers()
          map.removeLayer(clusterRef.current)
          clusterRef.current = null
        }
      }
    }

    // Clustering real con iconos minimalistas y popup clean
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
          iconSize: L.point(40, 40, true)
        })
      }
    })

    points.forEach(f => {
      const m = L.marker([f.lat, f.lng], { icon: minimalIcon(variantFor(f)) })
      const html = `
        <div class="popupCard">
          ${f.photo ? `<img class="popupPhoto" src="${f.photo}" alt="${f.headName || ''}" />` : ''}
          <h3 class="popupTitle">${(f.headName || 'Sin nombre')}</h3>
          ${f.address ? `<div class="popupRow">📍 ${f.address}</div>` : ''}
          ${f.phone ? `<div class="popupRow">📞 <a href="tel:${String(f.phone)}">${String(f.phone)}</a></div>` : ''}
          ${f.dni ? `<div class="popupRow">🪪 DNI: ${String(f.dni)}</div>` : ''}
          ${f.notes ? `<div class="popupRow">📝 ${f.notes}</div>` : ''}
        </div>
      `
      m.bindPopup(html, { maxWidth: 320, className: 'cleanPopup' })
      cluster.addLayer(m)
    })

    cluster.addTo(map)
    clusterRef.current = cluster

    return () => {
      if (clusterRef.current) {
        clusterRef.current.clearLayers()
        map.removeLayer(clusterRef.current)
        clusterRef.current = null
      }
    }
  }, [map, points, ready])

  return null
}

// ===== Vista: Lista (tarjetas simples + modal de detalle) =====
function ListView({ features }) {
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState(null)

  const list = useMemo(() => {
    const sorted = [...features].sort((a, b) =>
      (a.headName || '').localeCompare(b.headName || '')
    )
    if (!q.trim()) return sorted
    const fuse = new Fuse(sorted, {
      keys: ['headName', 'address', 'dni', 'phone'],
      threshold: 0.35
    })
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

        {/* Tarjetas simples */}
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
                {f.phone && (
                  <div className="row phone">📞 {f.phone}</div>
                )}
                {f.address && (
                  <div className="row address">📍 {f.address}</div>
                )}
            </button>
          ))}
        </div>
      </div>

      {/* Modal de detalle */}
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>{detail.headName || 'Sin nombre'}</h3>
              <button className="btn" onClick={() => setDetail(null)}>Cerrar ✕</button>
            </header>

            <div className="meta">ID: {detail.id}{detail.dni ? ` · DNI: ${detail.dni}` : ''}</div>

            {detail.photo && (
              <img className="photo" src={detail.photo} alt={detail.headName} />
            )}

            {detail.address && <div className="row">📍 {detail.address}</div>}
            {detail.sector && <div className="row">🏷️ {detail.sector}</div>}
            {detail.phone && (
              <div className="row">
                📞 <a href={`tel:${detail.phone}`} onClick={e => e.stopPropagation()}>
                  {detail.phone}
                </a>
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

// ===== Vista: Mapa =====
function MapView({ features }) {
  const userPos = useUserLocation()
  const [full, setFull] = useState(false)

  const points = useMemo(() => {
    return features
      .map(f => ({ ...f, lat: Number(f.lat), lng: Number(f.lng) }))
      .filter(f => Number.isFinite(f.lat) && Number.isFinite(f.lng))
  }, [features])

  const center = useMemo(() => {
    if (points.length === 0) return [-12.0464, -77.0428] // Lima
    const lat = points.reduce((s, f) => s + f.lat, 0) / points.length
    const lng = points.reduce((s, f) => s + f.lng, 0) / points.length
    return [lat, lng]
  }, [points])

  // key para forzar re-montaje del mapa si se traba por estilos/estado
  const mapKey = `${points.length}-${full ? 1 : 0}`

  return (
    <div className={`mapShell ${full ? 'full' : ''}`}>
      <div style={{position:'absolute', zIndex:999, display:'flex', gap:8, padding:10}}>
        <button className="btn" onClick={()=>setFull(v=>!v)}>
          {full ? 'Salir de pantalla completa' : 'Pantalla completa'}
        </button>
        {userPos && <span className="badge">📍 Estás aquí (~{Math.round(userPos.accuracy)} m)</span>}
      </div>

      <MapContainer key={mapKey} center={center} zoom={14} scrollWheelZoom style={{ width:'100%', height:'100%' }}>
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Ubicación del usuario */}
        {userPos && (
          <>
            <Circle center={[userPos.lat, userPos.lng]} radius={Math.max(20, userPos.accuracy||40)} pathOptions={{ color:'#1e90ff', opacity:.35, fillOpacity:.1 }} />
            <CircleMarker center={[userPos.lat, userPos.lng]} radius={7} pathOptions={{ color:'#1e90ff', fill:true, fillOpacity:1 }} />
          </>
        )}

        {/* Capa de clustering (con fallback automático) */}
        <ClusterLayer points={points} />
      </MapContainer>
    </div>
  )
}

// ===== Dashboard con pestañas =====
function Dashboard({ promoter, all, onBack }) {
  const mine = useMemo(
    () => all.filter(x => x.promoter === promoter),
    [all, promoter]
  )
  const [tab, setTab] = useState('list') // 'list' | 'map'

  return (
    <div className="promos" style={{ paddingTop: 0 }}>
      <div className="toolbar card" style={{ padding: 10, marginBottom: 12 }}>
        <button className="btn" onClick={onBack}>
          ← Cambiar promotor
        </button>
        <span className="badge">
          Promotor: <strong>{promoter}</strong>
        </span>
        <span className="legend">{mine.length} punto(s) asignados</span>
      </div>

      <div
        className="card"
        style={{ padding: 8, marginBottom: 12, display: 'flex', gap: 8 }}
      >
        <button
          className={`btn ${tab === 'list' ? 'primary' : ''}`}
          onClick={() => setTab('list')}
        >
          📋 Lista
        </button>
        <button
          className={`btn ${tab === 'map' ? 'primary' : ''}`}
          onClick={() => setTab('map')}
        >
          🗺️ Mapa
        </button>
      </div>

      {tab === 'list' ? <ListView features={mine} /> : <MapView features={mine} />}
    </div>
  )
}

// ===== Componente principal =====
export default function App() {
  const normalized = useNormalizedData(data) // robusto ante tipos/campos vacíos
  const [stage, setStage] = useState('pick') // 'pick' | 'dash'
  const [promoter, setPromoter] = useState(null)

  return (
    <div className="app">
      <header className="header">
        <div className="brand">📍 Mapa de Promotores</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Versión 1.2</div>
      </header>

      {stage === 'pick' && (
        <PromoterPicker
          list={normalized}
          onPick={name => {
            setPromoter(name)
            setStage('dash')
          }}
        />
      )}

      {stage === 'dash' && (
        <Dashboard promoter={promoter} all={normalized} onBack={() => setStage('pick')} />
      )}
    </div>
  )
}
