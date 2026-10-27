import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Uses the dev proxy locally, but direct OWS URL when deployed to production
const WMS_BASE_URL = import.meta.env.DEV 
  ? '/de-africa/wms' 
  : 'https://ows.digitalearthafrica.org/wms';

const VARIABLES = {
  anomaly: {
    label: 'NDVI Anomaly',
    layer: 'ndvi_anomaly',
    style: 'style_ndvi_anomaly',
    timeType: 'monthly',
    legendType: 'image',
    legendUrl: `${WMS_BASE_URL}?service=WMS&request=GetLegendGraphic&format=image/png&layer=ndvi_anomaly&style=style_ndvi_anomaly`,
    description: 'Standard deviations from long-term mean (-3 to +3)',
  },
  mean: {
    label: 'NDVI Mean',
    layer: 'ndvi_anomaly',
    style: 'style_ndvi_mean',
    timeType: 'monthly',
    legendType: 'gradient',
    description: 'Average vegetation index (0.0 – 1.0)',
  },
  fc_annual: {
    label: 'Fractional Cover Annual',
    layer: 'fc_ls_summary_annual',
    style: '',
    timeType: 'annual',
    legendType: 'fc_legend',
    description: 'Annual summary: Green (PV), Blue (NPV), Red (Bare Soil)',
  },
};

// Generate monthly steps from 2017-01 to present
function generateMonthlySteps(startYear = 2017) {
  const steps = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  

  for (let y = startYear; y <= currentYear; y++) {
    const endM = y === currentYear ? currentMonth : 12;
    for (let m = 1; m <= endM; m++) {
      steps.push(`${y}-${m.toString().padStart(2, '0')}`);
    }
  }
  return steps;
}

// Generate annual steps (DE Africa WOfS spans back to the late 1980s; 2017 to current year)
function generateAnnualSteps(startYear = 2017) {
  const steps = [];
  const currentYear = new Date().getFullYear();
  for (let y = startYear; y <= currentYear; y++) {
    steps.push(`${y}`);
  }
  return steps;
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const wmsLayerRef = useRef(null);
  const geojsonRef = useRef(null);
  const clipPathRef = useRef(null);

  const monthlySteps = useMemo(() => generateMonthlySteps(2017), []);
  const annualSteps = useMemo(() => generateAnnualSteps(2017), []);

  const [activeVar, setActiveVar] = useState('anomaly');
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [monthIndex, setMonthIndex] = useState(() => {
    const idx = monthlySteps.indexOf('2022-01');
    return idx !== -1 ? idx : monthlySteps.length - 1;
  });
  const [yearIndex, setYearIndex] = useState(() => {
    const idx = annualSteps.indexOf('2022');
    return idx !== -1 ? idx : annualSteps.length - 1;
  });

  const currentConfig = VARIABLES[activeVar];
  const isAnnual = currentConfig.timeType === 'annual';

  // Active steps and index depending on selected variable
  const activeSteps = isAnnual ? annualSteps : monthlySteps;
  const activeIndex = isAnnual ? yearIndex : monthIndex;
  const setActiveIndex = isAnnual ? setYearIndex : setMonthIndex;

  const currentDisplayTime = activeSteps[activeIndex];
  // WMS expects YYYY-01-01 for annual layers, and YYYY-MM-01 for monthly layers
  const wmsTimeParam = isAnnual ? `${currentDisplayTime}-01-01` : `${currentDisplayTime}-01`;

  // Calculate pixel coordinates locked to the WMS layer pane
  const updateClipPath = () => {
    const map = mapInstanceRef.current;
    const geojson = geojsonRef.current;
    const pathElem = clipPathRef.current;
    if (!map || !geojson || !pathElem) return;

    const feature = geojson.features ? geojson.features[0] : geojson;
    const geom = feature.geometry;

    const rings =
      geom.type === 'Polygon'
        ? geom.coordinates
        : geom.type === 'MultiPolygon'
        ? geom.coordinates[0]
        : [];

    if (!rings.length) return;

    let d = '';
    rings.forEach((ring) => {
      ring.forEach(([lng, lat], idx) => {
        const point = map.latLngToLayerPoint([lat, lng]);
        d += (idx === 0 ? 'M ' : 'L ') + `${point.x} ${point.y} `;
      });
      d += 'Z ';
    });

    pathElem.setAttribute('d', d);
  };

  // 1. Initialize Map, Pane, WMS Layer, and GeoJSON
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current).setView([0.29, 36.9], 11);

    // Esri World Imagery
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      maxZoom: 19,
    }).addTo(map);

    const wmsPane = map.createPane('ndviPane');
    wmsPane.style.zIndex = '450';
    wmsPane.style.clipPath = 'url(#mpala-clip-path)';
    wmsPane.style.webkitClipPath = 'url(#mpala-clip-path)';

    const wms = L.tileLayer.wms(WMS_BASE_URL, {
      pane: 'ndviPane',
      layers: currentConfig.layer,
      styles: currentConfig.style,
      format: 'image/png',
      transparent: true,
      time: wmsTimeParam,
      version: '1.1.1',
      attribution: '&copy; Digital Earth Africa',
    }).addTo(map);

    mapInstanceRef.current = map;
    wmsLayerRef.current = wms;

    map.on('move', updateClipPath);
    map.on('zoom', updateClipPath);
    map.on('viewreset', updateClipPath);
    map.on('zoomend', updateClipPath);

    fetch('/data/Mpala.geojson')
      .then((res) => res.json())
      .then((geojson) => {
        geojsonRef.current = geojson;

        const boundary = L.geoJSON(geojson, {
          style: {
            color: '#dc2626',
            weight: 2,
            fillOpacity: 0,
          },
        }).addTo(map);

        map.fitBounds(boundary.getBounds(), { padding: [30, 30] });
        setTimeout(updateClipPath, 100);
      })
      .catch((err) => console.error('AOI load error:', err));

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

// 2. Update parameters when active variable or time changes
  useEffect(() => {
    if (!wmsLayerRef.current) return;

    wmsLayerRef.current.setParams({
      layers: currentConfig.layer,
      styles: currentConfig.style || '',
      time: wmsTimeParam,
      version: '1.1.1',
    });
  }, [activeVar, wmsTimeParam]);

return (
    <div style={{ height: '100vh', width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Hidden SVG defining the clip path element */}
      <svg style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}>
        <defs>
          <clipPath id="mpala-clip-path" clipPathUnits="userSpaceOnUse">
            <path ref={clipPathRef} d="" />
          </clipPath>
        </defs>
      </svg>

      {/* Header */}
      <header
        style={{
          height: '62px',
          boxSizing: 'border-box',
          padding: '0 24px',
          background: '#0f172a',
          color: '#f8fafc',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 1000,
          borderBottom: '1px solid #334155',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <img
            src="/DE_Africa_Logo.jpg"
            alt="Digital Earth Africa Logo"
            style={{
              height: '38px',
              width: 'auto',
              borderRadius: '4px',
              objectFit: 'contain',
            }}
          />

          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#ffffff' }}>
            Mpala Earth Observation Dashboard
          </h2>

          <div style={{ display: 'flex', gap: '8px' }}>
            {Object.entries(VARIABLES).map(([key, config]) => (
              <button
                key={key}
                onClick={() => setActiveVar(key)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: '1px solid #475569',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  background: activeVar === key ? '#2563eb' : '#1e293b',
                  color: '#fff',
                  fontWeight: activeVar === key ? '600' : '400',
                  transition: 'background 0.2s ease',
                }}
              >
                {config.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
          Displaying: <strong style={{ color: '#fff' }}>{currentConfig.label}</strong>
        </div>
      </header>

      {/* 1. Standalone Vertically Centered Tab Button */}
      <button
        onClick={() => setIsInfoOpen(!isInfoOpen)}
        title={isInfoOpen ? 'Close information' : 'Open information'}
        style={{
          position: 'fixed',
          top: '50%',
          transform: 'translateY(-50%)',
          left: isInfoOpen ? '320px' : '0px',
          width: '32px',
          height: '56px',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #334155',
          borderLeft: 'none',
          borderRadius: '0 8px 8px 0',
          color: '#38bdf8',
          fontSize: '1rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '4px 0 14px rgba(0, 0, 0, 0.4)',
          zIndex: 2500,
          transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {isInfoOpen ? '◀' : '▶'}
      </button>

      {/* 2. Slide-out Drawer */}
      <div
        style={{
          position: 'fixed',
          top: '62px',
          bottom: 0,
          left: 0,
          width: '320px',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(10px)',
          borderRight: '1px solid #334155',
          boxShadow: '4px 0 24px rgba(0, 0, 0, 0.5)',
          transform: isInfoOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 2400,
          display: 'flex',
          flexDirection: 'column',
          color: '#f8fafc',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '1.15rem', color: '#ffffff' }}>
            About This Dashboard
          </h3>
          <p style={{ fontSize: '0.82rem', lineHeight: '1.5', color: '#94a3b8', margin: '0 0 18px 0' }}>
            This portal provides time-series monitoring of vegetation condition, anomalies, and land cover dynamics across Mpala Research Centre in Laikipia, Kenya.
          </p>

          <div style={{ height: '1px', background: '#334155', margin: '16px 0' }} />

          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#38bdf8' }}>
            Current Layer Info
          </h4>
          <p style={{ fontSize: '0.8rem', lineHeight: '1.4', color: '#cbd5e1', margin: '0 0 18px 0' }}>
            <strong style={{ color: '#fff' }}>{currentConfig.label}:</strong> {currentConfig.description}
          </p>

          <div style={{ height: '1px', background: '#334155', margin: '16px 0' }} />

          <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#ffffff' }}>
            External Resources
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <a
              href="https://mpala.org/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                padding: '10px 14px',
                borderRadius: '6px',
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#38bdf8',
                fontSize: '0.82rem',
                textDecoration: 'none',
                fontWeight: 500,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#1e293b')}
            >
              Mpala Research Centre &rarr;
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '3px' }}>
                Living laboratory for conservation & science in Kenya
              </div>
            </a>

            <a
              href="https://www.digitalearthafrica.org/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                padding: '10px 14px',
                borderRadius: '6px',
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#38bdf8',
                fontSize: '0.82rem',
                textDecoration: 'none',
                fontWeight: 500,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#1e293b')}
            >
              Digital Earth Africa &rarr;
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '3px' }}>
                Free open satellite data infrastructure across Africa
              </div>
            </a>

            <a
              href="https://docs.digitalearthafrica.org/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                padding: '10px 14px',
                borderRadius: '6px',
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#38bdf8',
                fontSize: '0.82rem',
                textDecoration: 'none',
                fontWeight: 500,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#1e293b')}
            >
              Technical Documentation &rarr;
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '3px' }}>
                Learn more about Digital Earth Africa services & datasets
              </div>
            </a>
          </div>
        </div>
      </div>

      {/* Map DOM */}
      <div ref={mapContainerRef} style={{ flex: 1, width: '100%' }} />

      {/* Attribution Badge */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          right: '12px',
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(4px)',
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '0.72rem',
          color: '#cbd5e1',
          zIndex: 1000,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span>Powered by</span>
        <strong style={{ color: '#ffffff', fontWeight: 600 }}>Digital Earth Africa</strong>
      </div>

      {/* Floating Dynamic Legend */}
      <div
        style={{
          position: 'absolute',
          top: '80px',
          right: '20px',
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(8px)',
          borderRadius: '8px',
          padding: '12px 16px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          border: '1px solid #334155',
          color: '#f8fafc',
          zIndex: 1000,
          minWidth: '220px',
          maxWidth: '260px',
        }}
      >
        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
          {currentConfig.label}
        </div>
        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '10px' }}>
          {currentConfig.description}
        </div>

        {/* 1. NDVI Mean Continuous Ramp */}
        {currentConfig.legendType === 'gradient' && (
          <div>
            <div
              style={{
                height: '14px',
                width: '100%',
                borderRadius: '3px',
                background: 'linear-gradient(to right, #8c510a, #d8b365, #f6e8c3, #c7eae5, #5ab4ac, #01665e)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.7rem',
                color: '#cbd5e1',
                marginTop: '4px',
              }}
            >
              <span>0.0</span>
              <span>0.5</span>
              <span>1.0</span>
            </div>
          </div>
        )}

        {/* 2. Fractional Cover Ternary RGB Guide */}
        {currentConfig.legendType === 'fc_legend' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#22c55e' }} />
              <span>Green Veg (PV)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#3b82f6' }} />
              <span>Dry / Dead Veg (NPV)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#ef4444' }} />
              <span>Bare Soil (BS)</span>
            </div>
          </div>
        )}

        {/* 3. Standard WMS Graphic (NDVI Anomaly) */}
        {currentConfig.legendType === 'image' && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: '4px',
              padding: '6px',
              display: 'inline-block',
            }}
          >
            <img
              key={currentConfig.layer + currentConfig.style}
              src={currentConfig.legendUrl}
              alt={`${currentConfig.label} Legend`}
              style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement.innerText = 'Legend unavailable';
              }}
            />
          </div>
        )}
      </div>

      {/* Dynamic Timeline Scrubber */}
      <div
        style={{
          position: 'absolute',
          bottom: '48px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(700px, 90vw)',
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(8px)',
          borderRadius: '12px',
          padding: '16px 24px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f8fafc' }}>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            {isAnnual ? 'Year (Annual Summary)' : 'Month (Monthly Composite)'}
          </span>
          <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#38bdf8' }}>
            {currentDisplayTime}
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={activeSteps.length - 1}
          value={activeIndex}
          onChange={(e) => setActiveIndex(Number(e.target.value))}
          style={{ width: '100%', cursor: 'pointer', accentColor: '#38bdf8' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b' }}>
          <span>{activeSteps[0]}</span>
          <span>{activeSteps[activeSteps.length - 1]}</span>
        </div>
      </div>
    </div>
  );
}