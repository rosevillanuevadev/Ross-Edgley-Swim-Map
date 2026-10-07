/* ===================== CONFIG ===================== */
/* Replace with your RAW CSV URLs */
const DATASETS = [
  { name: "Main Folder",       url: "https://raw.githubusercontent.com/rosevillanuevadev/Ross-Edgley-Swim-Map/refs/heads/main/Main%20Folder.csv",       color: "black"  },
  { name: "From Anthony",      url: "https://raw.githubusercontent.com/rosevillanuevadev/Ross-Edgley-Swim-Map/refs/heads/main/From%20Anthony.csv",      color: "pink"   },
  { name: "Garmin",            url: "https://raw.githubusercontent.com/rosevillanuevadev/Ross-Edgley-Swim-Map/refs/heads/main/Garmin.csv",              color: "red"    },
  { name: "Marshall Garmin",   url: "https://raw.githubusercontent.com/rosevillanuevadev/Ross-Edgley-Swim-Map/refs/heads/main/Marshall%20Garmin.csv",   color: "yellow" },
  { name: "Skirr",             url: "https://raw.githubusercontent.com/rosevillanuevadev/Ross-Edgley-Swim-Map/refs/heads/main/Skirr.csv",               color: "blue"   }
];

/* =============== CSV / UTIL FUNCTIONS ============= */
function normalizeHeader(h){
  return String(h||'')
    .replace(/^\uFEFF/,'')
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
  return (Number.isFinite(lat) && Number.isFinite(lon)) ? [lat,lon] : null;
}

function loadCsv(url){
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
    // Sidebar section with collapse toggle
    const section = document.createElement('div');
    section.className = 'dataset';
    section.innerHTML = `
      <h4>
        <span class="collapse-toggle" data-ds="${index}">[–]</span>
        <label><input type="checkbox" class="ds-toggle" data-ds="${index}" checked> ${ds.name}</label>
        <button class="ds-show"  data-ds="${index}">Show</button>
        <button class="ds-clear" data-ds="${index}">Clear</button>
      </h4>
      <div class="list" id="list-ds-${index}"></div>
    `;
    container.appendChild(section);

    const listEl = section.querySelector(`#list-ds-${index}`);
    const toggle = section.querySelector('.collapse-toggle');

    // collapse / expand
    toggle.addEventListener('click', ()=>{
      const collapsed = listEl.style.display === 'none';
      listEl.style.display = collapsed ? 'block' : 'none';
      toggle.textContent = collapsed ? '[–]' : '[+]';
    });

    // Map group + state for this dataset
    const group = L.layerGroup().addTo(map);
    const legLayers = {};
    const dataset = { name: ds.name, color: ds.color || 'red', group, legLayers, listEl };
    allDatasets.push(dataset);

    // Load & render this dataset
    loadCsv(ds.url).then(rows=>{
      rows.forEach((r, i)=>{
        const start=parseLatLon(r.start_coordinates);
        const end=parseLatLon(r.end_coordinates);
        if(!start || !end) return;

        const name=(r.filename||`Leg ${i+1}`).trim();
        const uid = `${index}|${name}`;

        const line = L.polyline([start,end], {
            color: dataset.color,
            weight: 3,
            opacity: 0.9
          })
          .bindTooltip(`${name} (${ds.name})`)
          .bindPopup(
            `<div style="font-size:8pt;line-height:1.2em">
               <strong>${name}</strong><br>
               Source: ${ds.name}<br>
               ${r.start_date||''} ${r.start_time||''} → ${r.finish_date||''} ${r.end_time||''}<br>
               Start: ${r.start_coordinates}<br>
               End: ${r.end_coordinates}
             </div>`
          );

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

/* Expose initializer */
window.initSwimMap = initSwimMap;
