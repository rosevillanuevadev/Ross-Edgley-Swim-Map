/* ===================== CONFIG ===================== */
/* Paste your RAW CSV URLs below (the "Raw" link from GitHub) */
const DATASETS = [
  { name: 'Main GPX',   url: 'https://raw.githubusercontent.com/rosevillanuevadev/Ross-Edgley-Swim-Map/refs/heads/main/consolidated_gpx%20-%20consolidated_gpx.csv', color: 'red'   },
  { name: 'Skirr GPX',  url: 'https://raw.githubusercontent.com/rosevillanuevadev/Ross-Edgley-Swim-Map/refs/heads/main/Skirr%20GPX%20-%20Skirr%20GPX.csv', color: 'blue'  },
  { name: 'Garmin GPX', url: 'https://raw.githubusercontent.com/rosevillanuevadev/Ross-Edgley-Swim-Map/refs/heads/main/GarminGPX%20-%20GarminGPX.csv', color: 'green' },
];

/* =============== CSV / UTIL FUNCTIONS ============= */
function normalizeHeader(h){
  return String(h||'')
    .replace(/^\uFEFF/,'')   // strip BOM if present
    .trim()
    .toLowerCase()
    .replace(/\s+/g,'_')
    .replace(/[^a-z0-9_]/g,'');
}
function isLatLonString(s){
  return /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(String(s||''));
}
function parseLatLon(pair){
  const [lat,lon] = String(pair).split(',').map(x=>Number(String(x).trim()));
  return (Number.isFinite(lat) && Number.isFinite(lon)) ? [lat,lon] : null; // lat,lon
}
function toUtcDate(row){
  const d=(row.start_date||'').trim();
  const t=(row.start_time||'00:00:00').trim();
  if(!d) return null;
  const iso=`${d}T${t.endsWith('Z')?t:(t+'Z')}`;
  const ms=Date.parse(iso);
  return Number.isNaN(ms)?null:new Date(ms);
}
const CENTER={lat:64.9631,lon:-19.0208}; // Iceland center (for spatial sort fallback)
function angleFromCenter(lat,lon){
  let deg = Math.atan2(lat-CENTER.lat, lon-CENTER.lon)*180/Math.PI;
  return deg<0?deg+360:deg;
}

function loadCsv(url){
  // Fetch as text first to catch HTML (wrong URL) early
  return fetch(url, { cache:'no-cache' })
    .then(r => r.text())
    .then(text => {
      if (/^\s*<!doctype html/i.test(text) || /\<html[\s>]/i.test(text)) {
        throw new Error('Got HTML instead of CSV. Use the RAW file URL.');
      }
      return new Promise((resolve,reject)=>{
        Papa.parse(text, {
          header:true,
          skipEmptyLines:'greedy',
          transformHeader: normalizeHeader,
          complete: res => {
            const rows=(res.data||[]).map(obj=>{
              const out={};
              for(const k in obj){
                out[normalizeHeader(k)] = String(obj[k] ?? '').trim();
              }
              return out;
            });
            const good=[];
            for(const r of rows){
              if (r.filename && isLatLonString(r.start_coordinates) && isLatLonString(r.end_coordinates)){
                good.push(r);
              }
            }
            resolve(good);
          },
          error: reject
        });
      });
    });
}

/* ===================== RENDERING ===================== */
function initSwimMap(map){
  const container = document.getElementById('checkboxes');
  const globalBounds = L.latLngBounds();
  const allDatasets = [];
  let remaining = DATASETS.length;

  DATASETS.forEach((ds, index)=>{
    // Sidebar section
    const section = document.createElement('div');
    section.className = 'dataset';
    section.innerHTML = `
      <h4>
        <label><input type="checkbox" class="ds-toggle" data-ds="${index}" checked> ${ds.name}</label>
        <button class="ds-show"  data-ds="${index}">Show</button>
        <button class="ds-clear" data-ds="${index}">Clear</button>
      </h4>
      <div id="list-ds-${index}"></div>
    `;
    container.appendChild(section);

    // Map group + state for this dataset
    const group = L.layerGroup().addTo(map);
    const legLayers = {}; // key -> layer
    const listEl = section.querySelector(`#list-ds-${index}`);
    const dataset = { name: ds.name, color: ds.color || 'red', group, legLayers, listEl };
    allDatasets.push(dataset);

    // Load & render this dataset
    loadCsv(ds.url).then(rows=>{
      // Sort by datetime; fallback to clockwise spatial angle
      rows.sort((a,b)=>{
        const da=toUtcDate(a), db=toUtcDate(b);
        if(da && db) return da - db;
        const as=parseLatLon(a.start_coordinates), bs=parseLatLon(b.start_coordinates);
        if(as && bs) return angleFromCenter(as[0],as[1]) - angleFromCenter(bs[0],bs[1]);
        return 0;
      });

      rows.forEach((r, i)=>{
        const start=parseLatLon(r.start_coordinates);
        const end=parseLatLon(r.end_coordinates);
        if(!start || !end) return;

        const name=(r.filename||`Leg ${i+1}`).trim();
        const uid = `${index}|${name}`; // unique id

        const line = L.polyline([start,end], {
            color: dataset.color,
            weight: 4,
            opacity: 0.9
          })
          .bindPopup(
            `<strong>${name}</strong><br>
             ${r.start_date||''} ${r.start_time||''} → ${r.finish_date||''} ${r.end_time||''}<br>
             <small>Start: ${r.start_coordinates}<br>End: ${r.end_coordinates}</small>`
          )
          .bindTooltip(name); // filename on hover

        line.addTo(group);
        dataset.legLayers[uid] = line;
        globalBounds.extend(line.getBounds());

        // Per-leg checkbox
        const item = document.createElement('div');
        item.className = 'filter-item';
        const safe = name.replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        item.innerHTML = `<label><input type="checkbox" data-uid="${uid}" checked> ${safe}</label>`;
        listEl.appendChild(item);
      });

      // Dataset UI handlers
      section.querySelector('.ds-toggle').addEventListener('change', e=>{
        if(e.target.checked) group.addTo(map); else map.removeLayer(group);
      });
      section.querySelector('.ds-show').addEventListener('click', ()=>{
        group.addTo(map);
        section.querySelector('.ds-toggle').checked = true;
        listEl.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
          cb.checked = true;
          const layer = legLayers[cb.dataset.uid];
          if(layer) group.addLayer(layer);
        });
      });
      section.querySelector('.ds-clear').addEventListener('click', ()=>{
        listEl.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
          cb.checked = false;
          const layer = legLayers[cb.dataset.uid];
          if(layer) group.removeLayer(layer);
        });
      });
      listEl.addEventListener('change', e=>{
        const cb = e.target.closest('input[type="checkbox"]'); if(!cb) return;
        const layer = legLayers[cb.dataset.uid]; if(!layer) return;
        if(cb.checked) group.addLayer(layer); else group.removeLayer(layer);
      });

    }).catch(err=>{
      console.error(`Failed to load ${ds.name}:`, err);
    }).finally(()=>{
      remaining--;
      if (remaining===0 && globalBounds.isValid()) {
        map.fitBounds(globalBounds.pad(0.1));
      }
    });
  });

  // Global buttons
  window.showAll = function(){
    allDatasets.forEach((d, i)=>{
      d.group.addTo(map);
      const t = document.querySelector(`.ds-toggle[data-ds="${i}"]`);
      if (t) t.checked = true;
      d.listEl.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
        cb.checked = true;
        const layer = d.legLayers[cb.dataset.uid];
        if(layer) d.group.addLayer(layer);
      });
    });
  };
  window.clearAll = function(){
    allDatasets.forEach(d=>{
      d.listEl.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
        cb.checked = false;
        const layer = d.legLayers[cb.dataset.uid];
        if(layer) d.group.removeLayer(layer);
      });
    });
  };
}

/* Expose initializer (called from HTML after map is created) */
window.initSwimMap = initSwimMap;

