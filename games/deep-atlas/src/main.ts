import 'leaflet/dist/leaflet.css';
import './style.css';
import { boot } from './app';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
