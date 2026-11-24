import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { Marker } from './field.api';

export function EvidenceMap({ markers }: { markers: Marker[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || !markers.length) return;
    const map = L.map(el.current, { scrollWheelZoom: false });
    L.tileLayer(
      import.meta.env.VITE_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution:
          import.meta.env.VITE_MAP_ATTRIBUTION ??
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      },
    ).addTo(map);
    const cluster = L.markerClusterGroup({ showCoverageOnHover: false });
    const icon = L.divIcon({ className: 'field-marker', iconSize: [20, 20], iconAnchor: [10, 10] });
    for (const point of markers) {
      if (
        !Number.isFinite(point.latitude) ||
        !Number.isFinite(point.longitude) ||
        Math.abs(point.latitude) > 90 ||
        Math.abs(point.longitude) > 180
      )
        continue;
      const card = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = point.clientName;
      const info = document.createElement('p');
      info.textContent = [
        point.code,
        point.employee,
        point.visitDate,
        point.status.replaceAll('_', ' ').toLowerCase(),
      ]
        .filter(Boolean)
        .join(' · ');
      const link = document.createElement('a');
      link.href = '/visits/' + encodeURIComponent(point.id);
      link.textContent = 'Open visit';
      card.append(title, info, link);
      cluster.addLayer(
        L.marker([point.latitude, point.longitude], { icon, title: point.clientName }).bindPopup(
          card,
        ),
      );
    }
    map.addLayer(cluster);
    const bounds = cluster.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    else map.setView([0, 0], 2);
    const observe = new ResizeObserver(() => map.invalidateSize());
    observe.observe(el.current);
    return () => {
      observe.disconnect();
      map.remove();
    };
  }, [markers]);
  return markers.length ? (
    <div ref={el} className="evidence-map" role="region" aria-label="Map of recorded visits" />
  ) : (
    <div className="empty">
      <p>No submitted visit locations match these filters.</p>
    </div>
  );
}
