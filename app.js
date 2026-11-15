/* RegistraObra v1.2 — Gestión documental Offline-First (Proyecto Pampahuasi, CUI 2236116)
   Aplicación web progresiva sin dependencias externas: funciona sin Internet, guarda en el
   celular (IndexedDB), valida fecha y numeración, y genera el expediente semanal foliado. */
'use strict';
let timerInt = null;

/* ------------------------------------------------------------------ utilidades */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, l = 2) => String(n).padStart(l, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const monday = s => { const d = parse(s); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_C = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dmy = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
const dm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const dayLabel = s => `${DIAS_C[parse(s).getDay()]} ${dmy(s)}`;
const sum = a => a.reduce((x, y) => x + y, 0);
const r1 = x => Math.round(x * 10) / 10;

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ------------------------------------------------------------------ configuración */
const DEFAULTS = {
  proyecto: 'CREACIÓN DEL PARQUE EN EL ANEXO DE PAMPAHUASI, DISTRITO DE SAN JUAN, LUCANAS - AYACUCHO',
  corto: 'Parque Pampahuasi',
  cui: '2236116', codProyecto: '4100000351', infobras: '558020', convenio: '41-0001-PIR-07',
  lugar: 'anexo de Pampa Huasi, distrito de San Juan, provincia de Lucanas, departamento de Ayacucho',
  residente: '', ssoma: '', supervisor: '', asistencia: '', representante: '',
  horaIngreso: '08:00', horaSalida: '17:00', charlasSemana: 3, sabados: false, syncUrl: '', pinHash: '',
  horasDia: 8, ciudad: 'San Juan', siglasInforme: 'SSOMA/DGQA/MDSJ', inicioObra: '', informeNum: 1
};
let CFG = { ...DEFAULTS };
async function loadCfg() { CFG = { ...DEFAULTS, ...(await DB.getConfig('cfg', {})) }; }
async function saveCfg() { await DB.setConfig('cfg', CFG); }

async function logEvent(tipo, detalle) { await DB.add('eventos', { t: new Date().toISOString(), fecha: today(), tipo, detalle, sync: false }); }

/* ------------------------------------------------------------------ datos */
async function participantes(fecha) { return (await DB.all('participantes')).filter(p => activoEn(p, fecha)).sort((a, b) => a.n - b.n || (a.fechaAlta || '').localeCompare(b.fechaAlta || '')); }
async function registros(tipo) { const all = await DB.all('registros'); return tipo ? all.filter(r => r.tipo === tipo) : all; }
async function nextCode(tipo, anio) {
  const nums = (await registros(tipo)).filter(r => r.anio === anio).map(r => r.numero);
  const n = nums.length ? Math.max(...nums) + 1 : 1;
  return { numero: n, id: `${tipo}-${anio}-${pad(n, 3)}` };
}
const snap = ps => ps.map(p => ({ id: p.id, n: p.n, nombres: p.nombres, dni: p.dni }));
/* ---------- v1.2: días no laborables, estados de asistencia, altas y bajas */
let NOLAB = {}; // { 'AAAA-MM-DD': { fecha, motivo, detalle } }
async function loadNolab() { NOLAB = Object.fromEntries((await DB.all('nolab')).map(x => [x.fecha, x])); }
const FERIADOS_PE = { '01-01': 'Año Nuevo', '05-01': 'Día del Trabajo', '06-07': 'Batalla de Arica y Día de la Bandera', '06-29': 'San Pedro y San Pablo',
  '07-23': 'Día de la Fuerza Aérea del Perú', '07-28': 'Fiestas Patrias', '07-29': 'Fiestas Patrias', '08-06': 'Batalla de Junín', '08-30': 'Santa Rosa de Lima',
  '10-08': 'Combate de Angamos', '11-01': 'Día de Todos los Santos', '12-08': 'Inmaculada Concepción', '12-09': 'Batalla de Ayacucho', '12-25': 'Navidad' };
function semanaSanta(y) { // Jueves y Viernes Santo a partir de la fecha de Pascua (algoritmo de Meeus)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1, p = iso(new Date(y, mes - 1, dia));
  return { [addDays(p, -3)]: 'Jueves Santo', [addDays(p, -2)]: 'Viernes Santo' };
}
const feriadoNacional = f => f ? (FERIADOS_PE[f.slice(5)] || semanaSanta(+f.slice(0, 4))[f] || '') : '';
const MOTIVOS_NL = ['Feriado nacional', 'Feriado regional o local', 'Lluvia o mal clima', 'Paralización de obra', 'Otro'];
const diasTrabajo = lun => laborables(lun).filter(d => !NOLAB[d]);
const MOTIVOS_F = ['Injustificada', 'Descanso médico', 'Permiso', 'Reemplazo'];
const EST = { T: 'Tardanza', MD: 'Medio día' };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const estadoP = p => p.estado || (p.activo === false ? 'Inactivo' : 'Activo');
/* Un participante figura en una fecha si ya fue dado de alta y aún no fue dado de baja */
function activoEn(p, f) {
  if (f && p.fechaAlta && f < p.fechaAlta) return false;
  return estadoP(p) === 'Activo' || !!(f && p.fechaBaja && f < p.fechaBaja);
}
async function faltasDel(fecha) { const ra = (await registros('RA')).find(r => r.fecha === fecha); return { ra, faltas: new Set(ra ? ra.faltas : []) }; }
/* Registros de días anteriores: solo lectura hasta confirmar la edición */
function soloLectura(box, info, alDesbloquear) {
  const ctrls = $$('input:not(#fecha):not(#dia):not(#buscar), select, textarea, .pbtn, .btns button, #fotosBox label', box).filter(c => !c.closest('#nlForm'));
  ctrls.forEach(c => { c.dataset.prevDis = c.disabled ? '1' : ''; c.disabled = true; c.classList.add('ro-dis'); });
  $('#save', box).classList.add('hidden');
  const bar = document.createElement('div'); bar.className = 'robar';
  bar.innerHTML = '<span>🔒 Registro de un día anterior: <b>solo lectura</b>.</span><button class="btn sec sm" id="desbloq">Editar</button>';
  $('.meta', box).after(bar);
  $('#desbloq', box).onclick = async e => {
    const b = e.target;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '¿Corregir este registro? Toque otra vez'; b.classList.replace('sec', 'danger'); return; }
    ctrls.forEach(c => { c.disabled = c.dataset.prevDis === '1'; c.classList.remove('ro-dis'); });
    $('#save', box).classList.remove('hidden'); bar.remove();
    await logEvent('edicion_desbloqueada', info);
    toast('Edición habilitada. El cambio quedará registrado en el historial.');
    if (alDesbloquear) alDesbloquear();
  };
}

/* Botón de participante: número + apellidos + nombres (v1.1.1, hallazgo de la prueba de usabilidad) */
function etiquetaP(p) {
  const limpio = String(p.nombres || '').replace(/\s*\(EJEMPLO\)\s*$/i, '');
  const [ape, nom] = limpio.includes(',') ? limpio.split(',').map(x => x.trim()) : [limpio, ''];
  const tit = t => t.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  return `<b>${pad(p.n)}</b><span class="ap">${esc(ape)}</span><span class="no">${esc(tit(nom))}</span>`;
}

/* ---------- Fotos (panel fotográfico): se comprimen y se guardan en el celular */
function comprimir(file, max = 1280, q = 0.72) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}
function ubicacion() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5) }), () => res(null), { timeout: 4000, maximumAge: 600000 });
  });
}
async function fotosDe(ref) { return (await DB.all('fotos')).filter(f => f.ref === ref).sort((a, b) => a.t.localeCompare(b.t)); }
/* Widget: pendientes en memoria hasta guardar el registro */
function widgetFotos(cont, existentes) {
  const pend = [];
  cont.innerHTML = `<h3>Fotos para el panel fotográfico</h3>
    <label class="btn sec" style="display:block;text-align:center;margin:0">📷 Tomar o elegir fotos<input type="file" id="fotoIn" accept="image/*" capture="environment" multiple style="display:none"></label>
    <div class="fotos" id="fotoGrid"></div><p class="hint" id="fotoHint"></p>`;
  const paint = () => {
    $('#fotoGrid', cont).innerHTML = existentes.map(f => `<div class="ft"><img src="${f.data}"><button data-del="${f.id}">✕</button></div>`).join('') +
      pend.map((f, i) => `<div class="ft nuevo"><img src="${f.data}"><button data-pend="${i}">✕</button></div>`).join('');
    $('#fotoHint', cont).textContent = `${existentes.length + pend.length} foto(s)${pend.length ? ` · ${pend.length} se guardarán al pulsar Guardar` : ''}`;
  };
  paint();
  $('#fotoIn', cont).onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    toast('Procesando fotos…');
    const loc = await ubicacion();
    for (const f of files) { try { pend.push({ data: await comprimir(f), t: new Date(f.lastModified || Date.now()).toISOString(), loc }); } catch (err) { toast(err.message); } }
    e.target.value = ''; paint();
  };
  $('#fotoGrid', cont).onclick = async e => {
    const d = e.target.closest('[data-del]'), q = e.target.closest('[data-pend]');
    if (d) { await DB.del('fotos', +d.dataset.del); existentes.splice(existentes.findIndex(f => f.id === +d.dataset.del), 1); paint(); }
    if (q) { pend.splice(+q.dataset.pend, 1); paint(); }
  };
  return { async guardar(ref, fecha, tipo, titulo) { for (const f of pend) await DB.add('fotos', { ref, fecha, tipo, titulo, data: f.data, t: f.t, loc: f.loc }); const n = pend.length; pend.length = 0; return n; } };
}
async function markChanged() { await refreshPending(); if (navigator.onLine && CFG.syncUrl) syncNow(true); }

/* Validación de fecha común a todos los registros */
function validarFecha(f) {
  const e = [];
  if (!f) { e.push('La fecha es obligatoria.'); return e; }
  if (f > today()) e.push(`La fecha ${dmy(f)} es posterior a hoy (${dmy(today())}).`);
  const wd = parse(f).getDay();
  if (wd === 0) e.push(`El ${dmy(f)} es domingo: no es día laborable.`);
  if (wd === 6 && !CFG.sabados) e.push(`El ${dmy(f)} es sábado: no es día laborable (se puede habilitar en Configuración).`);
  if (NOLAB[f]) e.push(`El ${dmy(f)} está marcado como no laborable (${NOLAB[f].motivo}${NOLAB[f].detalle ? ': ' + NOLAB[f].detalle : ''}).`);
  return e;
}
function laborables(lunes) {
  const n = CFG.sabados ? 6 : 5; const out = [];
  for (let i = 0; i < n; i++) out.push(addDays(lunes, i));
  return out;
}
function showErrors(box, errs) {
  box.innerHTML = errs.length ? `<div class="errors"><b>No se guardó. Corrija:</b><ul>${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
}

/* ------------------------------------------------------------------ conexión y sincronización */
function updateNet() {
  const b = $('#netBadge');
  if (navigator.onLine) { b.textContent = 'Con conexión'; b.className = 'badge on'; }
  else { b.textContent = 'Sin conexión'; b.className = 'badge off'; }
}
async function pendientes() {
  const out = {};
  for (const s of ['registros', 'tiempos', 'entregas', 'nolab']) out[s] = (await DB.all(s)).filter(x => !x.sync);
  return out;
}
async function refreshPending() {
  const p = await pendientes();
  const n = p.registros.length + p.tiempos.length + p.entregas.length + p.nolab.length;
  $('#pendingTxt').textContent = n === 0 ? 'Todo sincronizado' : `${n} registro${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} de sincronizar`;
}
let syncing = false;
async function syncNow(silent = false) {
  if (syncing) return;
  if (!navigator.onLine) { if (!silent) toast('Sin conexión: los datos siguen guardados en el celular.'); return; }
  if (!CFG.syncUrl) { if (!silent) toast('Configure la URL de sincronización en Más → Configuración.'); return; }
  const p = await pendientes();
  const total = p.registros.length + p.tiempos.length + p.entregas.length + p.nolab.length;
  if (!total) { if (!silent) toast('No hay registros pendientes.'); return; }
  syncing = true;
  try {
    const res = await fetch(CFG.syncUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ app: 'RegistraObra', version: '1.2', cui: CFG.cui, enviado: new Date().toISOString(), ...p })
    });
    let ok = res.ok, recibidos = null;
    try { const j = await res.json(); ok = ok && j.ok !== false; recibidos = j.recibidos ?? null; } catch (_) { /* respuesta sin JSON */ }
    if (!ok) throw new Error('HTTP ' + res.status);
    const at = new Date().toISOString();
    for (const s of ['registros', 'tiempos', 'entregas', 'nolab']) for (const x of p[s]) { x.sync = true; x.syncAt = at; await DB.put(s, x); }
    await logEvent('sincronizacion', { enviados: total, recibidos });
    toast(`Sincronizados ${total} registros.`);
  } catch (err) {
    await logEvent('sincronizacion_fallida', { error: String(err.message || err) });
    if (!silent) toast('No se pudo sincronizar. Los datos siguen seguros en el celular.');
  } finally { syncing = false; refreshPending(); }
}

/* ------------------------------------------------------------------ navegación */
const VIEWS = {};
async function go(route) {
  const target = '#' + (route || 'asistencia');
  if (location.hash === target) render(); else location.hash = target;
}
async function render() {
  const [name, arg] = (location.hash.slice(1) || 'inicio').split('/');
  $$('nav.bottom button').forEach(b => b.classList.toggle('active', b.dataset.go === name || (b.dataset.go === 'mas' && ['tiempos', 'participantes', 'config', 'mas', 'datos', 'informes'].includes(name))));
  const v = VIEWS[name] || VIEWS.inicio;
  $('#printArea').innerHTML = '';
  $('#view').onclick = null;
  clearInterval(timerInt);
  window.scrollTo(0, 0);
  await v(arg);
}

/* ------------------------------------------------------------------ ASISTENCIA */
VIEWS.asistencia = async (fechaArg) => {
  const fecha = fechaArg || today();
  const ps = await participantes(fecha);
  const all = await registros('RA');
  const rec = all.find(r => r.fecha === fecha);
  const code = rec ? { id: rec.id } : await nextCode('RA', parse(fecha).getFullYear());
  const view = $('#view');
  if (!ps.length) {
    view.innerHTML = `<div class="card"><h2>ASISTENCIA DEL DÍA</h2><p>Aún no hay participantes registrados en este celular.</p>
      <button class="btn primary" id="goP">Registrar participantes</button></div>`;
    $('#goP').onclick = () => go('participantes'); return;
  }
  const lun = monday(fecha);
  const nl = NOLAB[fecha];
  const fer = feriadoNacional(fecha);
  // Estado por participante: sin valor = presente; 'T' tardanza; 'MD' medio día; 'F' falta (con motivo)
  const est = new Map(), mot = new Map();
  if (rec) {
    rec.faltas.forEach(id => { est.set(id, 'F'); mot.set(id, rec.detalle?.[id]?.m || 'Injustificada'); });
    Object.entries(rec.detalle || {}).forEach(([id, d]) => { if (d.e !== 'F') est.set(+id, d.e); });
  }
  const lectura = !!rec && fecha < today();
  const semRecs = all.filter(r => r.fecha >= lun && r.fecha <= addDays(lun, 6));
  const semana = laborables(lun).map(d => ({ d, r: semRecs.find(r => r.fecha === d), nl: NOLAB[d] })).filter(x => x.r || x.nl);
  const proximos = Object.values(NOLAB).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8);
  const formNL = `<div id="nlForm" class="nlform hidden">
      <h3>Marcar día no laborable</h3>
      <label>Fecha</label><input type="date" id="nlF" value="${fecha}">
      <label>Motivo</label><select id="nlM">${MOTIVOS_NL.map(m => `<option ${fer && m === 'Feriado nacional' ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <label>Detalle (opcional)</label><input id="nlD" value="${esc(fer)}" placeholder="Ej.: Inmaculada Concepción, lluvia intensa desde las 7:00">
      <div id="nlErr"></div>
      <button class="btn primary" id="nlSave">GUARDAR DÍA NO LABORABLE</button>
      <p class="hint">Ese día no se exige asistencia, charla ni entrega de agua, y el expediente lo indica en el índice.</p></div>`;
  const btn = p => {
    const e = est.get(p.id) || '';
    const tag = e === 'F' ? `<i class="tg">Falta · ${esc(mot.get(p.id))}</i>` : e ? `<i class="tg">${EST[e]}</i>` : '';
    return `<button class="pbtn ${e === 'F' ? 'off' : e === 'T' ? 'tard' : e === 'MD' ? 'mdia' : ''}" data-id="${p.id}" data-q="${esc(norm(pad(p.n) + ' ' + p.nombres))}" title="${esc(p.nombres)}">${etiquetaP(p)}${tag}</button>`;
  };
  view.innerHTML = nl ? `
  <div class="card">
    <h2>ASISTENCIA DEL DÍA</h2>
    <label>Fecha</label><input type="date" id="fecha" value="${fecha}" max="${today()}">
    <div class="nlbox"><b>Día no laborable</b><span>${DIAS[parse(fecha).getDay()]} ${dmy(fecha)} · ${esc(nl.motivo)}${nl.detalle ? ': ' + esc(nl.detalle) : ''}</span></div>
    <p class="hint">No se registra asistencia, charla ni agua. El expediente semanal no lo cuenta como falta de registro.</p>
    <button class="btn danger" id="nlDel" style="width:100%;margin-top:12px">Quitar marca de no laborable</button>
  </div>` : `
  <div class="card" id="cardA">
    <h2>ASISTENCIA DEL DÍA</h2>
    <div class="meta"><span class="code">${esc(code.id)}</span><span>${rec ? (lectura ? 'Registro guardado · solo lectura' : 'Registro guardado · se puede corregir') : 'Nuevo registro'}</span></div>
    ${fer && !rec ? `<div class="ferbox">📅 El ${dmy(fecha)} es feriado nacional (${esc(fer)}). <button class="btn sec sm" id="ferSi">Marcar como no laborable</button></div>` : ''}
    <label>Fecha</label><input type="date" id="fecha" value="${fecha}" max="${today()}">
    <div class="row2">
      <div><label>Hora de ingreso</label><input type="time" id="hi" value="${esc(rec?.horaIngreso || CFG.horaIngreso)}"></div>
      <div><label>Hora de salida</label><input type="time" id="hs" value="${esc(rec?.horaSalida || CFG.horaSalida)}"></div>
    </div>
    <label>Responsable de asistencia</label><input id="resp" value="${esc(rec?.responsable || CFG.asistencia)}" placeholder="Nombre del responsable">
    <p class="hint" id="respHint"></p>
    <div class="meta" style="margin-top:12px"><span class="pill ok" id="cP"></span><span class="pill bad" id="cF"></span><span class="pill warn" id="cT"></span></div>
    <input type="search" id="buscar" class="buscar" placeholder="🔍 Buscar por nombre o número" autocomplete="off">
    <p class="hint">Toque el nombre de quien <b>falta</b> y elija el motivo. <b>Mantenga presionado</b> un nombre para marcar <b>tardanza</b> o <b>medio día</b>.</p>
    <div class="grid-p" id="grid">${ps.map(btn).join('')}</div>
    <div id="faltasList" class="hint"></div>
    <div id="err"></div>
    <button class="btn primary" id="save">${rec ? 'ACTUALIZAR ASISTENCIA' : 'GUARDAR ASISTENCIA'}</button>
    <p class="hint">La firma y huella de los participantes se mantienen en el formato impreso.</p>
    <button class="btn sec" id="nlOpen" style="width:100%;margin-top:12px">Marcar un día como no laborable (feriado, lluvia…)</button>
    ${formNL}
  </div>`;
  view.insertAdjacentHTML('beforeend', `
  <div class="card"><h3>Asistencias de la semana</h3><p class="hint">Toque un día para verlo. Los días anteriores se abren en solo lectura.</p><ul class="list" id="sem"></ul></div>
  ${proximos.length ? `<div class="card"><h3>Días no laborables registrados</h3><ul class="list" id="nlList">${proximos.map(x => `<li><span>${dayLabel(x.fecha)}<br><small>${esc(x.motivo)}${x.detalle ? ' · ' + esc(x.detalle) : ''}</small></span><button class="btn sec sm" data-f="${x.fecha}">Ver</button></li>`).join('')}</ul></div>` : ''}`);
  $('#fecha').onchange = e => go('asistencia/' + e.target.value);
  $('#sem').innerHTML = semana.length ? semana.map(x => x.nl
    ? `<li class="clic" data-f="${x.d}"><span>${dayLabel(x.d)}</span><span class="pill nl">No laborable · ${esc(x.nl.motivo)}</span></li>`
    : `<li class="clic" data-f="${x.d}"><span><span class="code">${x.r.id}</span> ${dayLabel(x.d)}</span><span>${x.r.presentes.length} pres. · ${x.r.faltas.length} falta${x.r.faltas.length === 1 ? '' : 's'} ${x.d < today() ? '🔒' : ''}</span></li>`).join('') : '<li>Sin registros esta semana.</li>';
  $('#sem').onclick = e => { const li = e.target.closest('[data-f]'); if (li) go('asistencia/' + li.dataset.f); };
  if ($('#nlList')) $('#nlList').onclick = e => { const b = e.target.closest('[data-f]'); if (b) go('asistencia/' + b.dataset.f); };

  if (nl) {
    $('#nlDel').onclick = async e => {
      const b = e.target; if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Toque otra vez para confirmar'; return; }
      await DB.del('nolab', fecha); delete NOLAB[fecha];
      await logEvent('no_laborable_quitado', { fecha }); toast('Se quitó la marca de no laborable.'); render();
    };
    return;
  }

  /* --- día no laborable */
  const guardarNL = async (f, motivo, detalle) => {
    const errs = [];
    if (!f) errs.push('Indique la fecha.');
    else {
      if (parse(f).getDay() === 0) errs.push('El domingo ya es no laborable.');
      const r = all.find(x => x.fecha === f);
      if (r) errs.push(`El ${dmy(f)} ya tiene la asistencia ${r.id}. Un día con asistencia registrada no puede marcarse como no laborable.`);
      const regs = (await registros()).filter(x => (x.tipo === 'CH' && x.fecha === f) || (x.tipo === 'AA' && x.dias?.[f]?.length));
      if (regs.length) errs.push(`El ${dmy(f)} ya tiene registros (${regs.map(x => x.id).join(', ')}).`);
    }
    if (errs.length) { showErrors($('#nlErr') || $('#err'), errs); return false; }
    const obj = { fecha: f, motivo, detalle, creado: new Date().toISOString(), sync: false };
    await DB.put('nolab', obj); NOLAB[f] = obj;
    await logEvent('no_laborable', { fecha: f, motivo });
    toast(`${dmy(f)} marcado como no laborable.`); await markChanged(); go('asistencia/' + (f <= today() ? f : fecha)); return true;
  };
  if ($('#ferSi')) $('#ferSi').onclick = () => guardarNL(fecha, 'Feriado nacional', fer);
  $('#nlOpen').onclick = () => { $('#nlForm').classList.toggle('hidden'); $('#nlForm').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('#nlSave').onclick = () => guardarNL($('#nlF').value, $('#nlM').value, $('#nlD').value.trim());
  $('#nlF').onchange = e => { const fn = feriadoNacional(e.target.value); if (fn) { $('#nlM').value = 'Feriado nacional'; $('#nlD').value = fn; } };

  /* --- responsable: viene de Configuración, editable si hay un encargado temporal */
  const respH = () => { const v = $('#resp').value.trim(); $('#respHint').textContent = CFG.asistencia && v && v !== CFG.asistencia ? `Encargado temporal (en Configuración figura: ${CFG.asistencia}).` : ''; };
  $('#resp').oninput = respH; respH();

  /* --- cuadrícula */
  const upd = () => {
    const f = ps.filter(p => est.get(p.id) === 'F'), t = ps.filter(p => est.get(p.id) === 'T'), m = ps.filter(p => est.get(p.id) === 'MD');
    $('#cP').textContent = `${ps.length - f.length} presentes`; $('#cF').textContent = `${f.length} falta${f.length === 1 ? '' : 's'}`;
    $('#cT').textContent = t.length || m.length ? `${t.length} tardanza${t.length === 1 ? '' : 's'} · ${m.length} medio día` : '';
    $('#cT').classList.toggle('hidden', !(t.length || m.length));
    $('#faltasList').innerHTML = [f.length ? 'Faltas: ' + f.map(p => `${pad(p.n)} ${esc(p.nombres)} (${esc(mot.get(p.id))})`).join(' · ') : '',
      t.length ? 'Tardanzas: ' + t.map(p => `${pad(p.n)} ${esc(p.nombres)}`).join(' · ') : '',
      m.length ? 'Medio día: ' + m.map(p => `${pad(p.n)} ${esc(p.nombres)}`).join(' · ') : ''].filter(Boolean).join('<br>');
  };
  const pintar = id => { const b = $(`#grid .pbtn[data-id="${id}"]`); const p = ps.find(x => x.id === id); const tmp = document.createElement('div'); tmp.innerHTML = btn(p); b.replaceWith(tmp.firstElementChild); upd(); };
  const fijar = (id, e, m) => { if (!e) { est.delete(id); mot.delete(id); } else { est.set(id, e); if (e === 'F') mot.set(id, m || 'Injustificada'); else mot.delete(id); } pintar(id); };
  const menu = (id, modo) => {
    const p = ps.find(x => x.id === id);
    const ops = modo === 'falta' ? MOTIVOS_F.map(m => ['F', m]) : [['', 'Presente'], ['T', 'Tardanza'], ['MD', 'Medio día'], ...MOTIVOS_F.map(m => ['F', m])];
    const sh = document.createElement('div'); sh.className = 'msheet';
    sh.innerHTML = `<div class="ms-card"><b>${pad(p.n)} · ${esc(p.nombres)}</b><small>${modo === 'falta' ? 'Motivo de la falta' : 'Estado de asistencia'}</small>
      <div class="ms-ops">${ops.map(([e, m]) => `<button class="ms-op ${e === 'F' ? 'f' : e === 'T' ? 't' : e === 'MD' ? 'm' : 'p'}" data-e="${e}" data-m="${esc(m)}">${e === 'F' ? 'Falta · ' : ''}${esc(m)}</button>`).join('')}</div>
      <button class="btn sec" data-x="1" style="width:100%;margin-top:8px">${modo === 'falta' ? 'Listo (Injustificada)' : 'Cancelar'}</button></div>`;
    document.body.appendChild(sh);
    sh.onclick = ev => { const o = ev.target.closest('.ms-op'); if (o) fijar(id, o.dataset.e, o.dataset.m); else if (!(ev.target === sh || ev.target.closest('[data-x]'))) return; sh.remove(); };
  };
  const grid = $('#grid');
  let lpT = null, lpHecho = false;
  grid.addEventListener('pointerdown', e => { const b = e.target.closest('.pbtn'); if (!b || b.disabled) return; lpHecho = false; clearTimeout(lpT); lpT = setTimeout(() => { lpHecho = true; menu(+b.dataset.id, 'todo'); }, 550); });
  ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach(ev => grid.addEventListener(ev, e => { if (ev !== 'pointermove' || Math.abs(e.movementY) > 6) clearTimeout(lpT); }));
  grid.addEventListener('contextmenu', e => { e.preventDefault(); const b = e.target.closest('.pbtn'); if (b && !b.disabled && !lpHecho) { clearTimeout(lpT); menu(+b.dataset.id, 'todo'); } });
  grid.onclick = e => {
    const b = e.target.closest('.pbtn'); if (!b || b.disabled) return;
    if (lpHecho) { lpHecho = false; return; }
    const id = +b.dataset.id;
    if (est.get(id) === 'F') fijar(id, ''); else { fijar(id, 'F', 'Injustificada'); menu(id, 'falta'); }
  };
  $('#buscar').oninput = e => { const q = norm(e.target.value.trim()); $$('#grid .pbtn').forEach(b => b.style.display = !q || b.dataset.q.includes(q) ? '' : 'none'); };
  upd();
  if (lectura) soloLectura($('#cardA'), { id: rec.id });

  $('#save').onclick = async () => {
    const f = $('#fecha').value, hi = $('#hi').value, hs = $('#hs').value, resp = $('#resp').value.trim();
    const errs = validarFecha(f);
    if (!hi || !hs) errs.push('Las horas de ingreso y salida son obligatorias.');
    else if (hi >= hs) errs.push('La hora de salida debe ser posterior a la de ingreso.');
    if (!resp) errs.push('Indique el responsable de asistencia.');
    const faltas = ps.filter(p => est.get(p.id) === 'F').map(p => p.id);
    if (faltas.length >= ps.length) errs.push('Debe haber al menos un participante presente.');
    const dup = all.find(r => r.fecha === f && (!rec || r.id !== rec.id));
    if (dup) errs.push(`Ya existe la asistencia ${dup.id} para el ${dmy(f)}.`);
    showErrors($('#err'), errs);
    if (errs.length) { await logEvent('bloqueo', { modulo: 'asistencia', errores: errs }); return; }
    const c = rec ? { id: rec.id, numero: rec.numero } : await nextCode('RA', parse(f).getFullYear());
    const detalle = {}; est.forEach((e, id) => { detalle[id] = e === 'F' ? { e, m: mot.get(id) } : { e }; });
    const obj = {
      id: c.id, tipo: 'RA', numero: c.numero, anio: parse(f).getFullYear(), fecha: f, horaIngreso: hi, horaSalida: hs, responsable: resp,
      presentes: ps.filter(p => est.get(p.id) !== 'F').map(p => p.id), faltas, detalle,
      tardanzas: [...est.values()].filter(e => e === 'T').length, medioDia: [...est.values()].filter(e => e === 'MD').length,
      participantes: snap(ps), creado: rec?.creado || new Date().toISOString(), modificado: new Date().toISOString(), sync: false
    };
    await DB.put('registros', obj);
    if (!CFG.asistencia) { CFG.asistencia = resp; await saveCfg(); }
    await logEvent(rec ? 'edicion' : 'registro', { id: obj.id });
    toast(`Asistencia ${obj.id} guardada en el celular.`);
    await markChanged(); render();
  };
};

/* ------------------------------------------------------------------ CHARLA SSOMA */
const TEMAS = ['Orden y limpieza en obra', 'Uso correcto de EPP', 'Prevención de caídas al mismo nivel', 'Manipulación manual de cargas',
  'Uso seguro de herramientas manuales', 'Exposición a radiación solar y frío (zona altoandina)', 'Primeros auxilios básicos', 'Señalización de obra',
  'Trabajo en excavaciones y zanjas', 'Hidratación y salud en altura'];
VIEWS.ssoma = async (editId) => {
  const all = await registros('CH');
  const rec = editId ? all.find(r => r.id === editId) : null;
  const fecha = rec?.fecha || today();
  const ps = await participantes(fecha);
  const code = rec ? { id: rec.id } : await nextCode('CH', parse(fecha).getFullYear());
  const view = $('#view');
  if (!ps.length) { view.innerHTML = `<div class="card"><h2>CHARLA DE SEGURIDAD</h2><p>Primero registre los participantes en Más → Participantes.</p></div>`; return; }
  const asis = new Set(rec ? rec.asistentes : []);
  view.innerHTML = `
  <div class="card" id="cardC">
    <h2>CHARLA DE SEGURIDAD</h2>
    <div class="meta"><span class="code">${esc(code.id)}</span><span>${rec ? 'Editando' : 'Nueva charla'}</span></div>
    <label>Fecha</label><input type="date" id="fecha" value="${fecha}" max="${today()}">
    <div class="row2">
      <div><label>Hora</label><input type="time" id="hora" value="${esc(rec?.hora || '07:30')}"></div>
      <div><label>Duración (min)</label><input type="number" id="dur" min="5" max="120" value="${esc(rec?.duracion || 10)}"></div>
    </div>
    <label>Tema principal (a)</label>
    <select id="t1"><option value="">— Seleccione —</option>${TEMAS.map(t => `<option ${rec?.temas[0] === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}<option value="__otro">Otro…</option></select>
    <input id="t1o" class="hidden" placeholder="Escriba el tema" style="margin-top:6px">
    <label>Tema (b) — opcional</label><input id="t2" value="${esc(rec?.temas[1] || '')}">
    <label>Tema (c) — opcional</label><input id="t3" value="${esc(rec?.temas[2] || '')}">
    <label>Responsable SSOMA</label><input id="resp" value="${esc(rec?.responsable || CFG.ssoma)}" placeholder="Ing. responsable de SSOMA">
    <p class="hint" id="respHint"></p>
    <h3>Asistentes</h3>
    <p class="hint" id="bloqHint"></p>
    <div class="btns"><button class="btn sec sm" id="fromRA">Tomar de la asistencia del día</button><button class="btn sec sm" id="todos">Todos</button><button class="btn sec sm" id="ninguno">Ninguno</button></div>
    <p class="hint" id="cnt"></p>
    <div id="lst">${ps.map(p => `<label class="chk"><input type="checkbox" value="${p.id}" ${asis.has(p.id) ? 'checked' : ''}>P-${pad(p.n)} ${esc(p.nombres)}</label>`).join('')}</div>
    <div id="fotosBox"></div>
    <div id="err"></div>
    <button class="btn primary" id="save">${rec ? 'ACTUALIZAR CHARLA' : 'GUARDAR CHARLA'}</button>
  </div>
  <div class="card"><h3>Charlas de la semana</h3><ul class="list" id="sem"></ul></div>`;
  const wf = widgetFotos($('#fotosBox'), rec ? await fotosDe('CH:' + rec.id) : []);
  if (rec && rec.temas[0] && !TEMAS.includes(rec.temas[0])) { $('#t1').value = '__otro'; $('#t1o').classList.remove('hidden'); $('#t1o').value = rec.temas[0]; }
  $('#t1').onchange = e => $('#t1o').classList.toggle('hidden', e.target.value !== '__otro');
  const cnt = () => $('#cnt').textContent = `${$$('#lst input:checked').length} asistentes seleccionados`;
  $('#lst').onchange = cnt; cnt();
  const respH = () => { const v = $('#resp').value.trim(); $('#respHint').textContent = CFG.ssoma && v && v !== CFG.ssoma ? `Encargado temporal (en Configuración figura: ${CFG.ssoma}).` : ''; };
  $('#resp').oninput = respH; respH();
  /* Bloqueo cruzado: quien tiene falta ese día no puede figurar en la charla */
  let faltasDia = new Set();
  const bloquear = async () => {
    const { ra, faltas } = await faltasDel($('#fecha').value); faltasDia = faltas;
    $$('#lst label.chk').forEach(l => {
      const i = l.querySelector('input'), b = faltas.has(+i.value);
      if (b) i.checked = false; if (!l.classList.contains('ro-dis') && !i.classList.contains('ro-dis')) i.disabled = b; else i.dataset.prevDis = b ? '1' : '';
      l.classList.toggle('blk', b); l.querySelector('.fx')?.remove();
      if (b) l.insertAdjacentHTML('beforeend', `<span class="fx">Faltó · ${esc(ra.detalle?.[i.value]?.m || 'Injustificada')}</span>`);
    });
    $('#bloqHint').textContent = faltas.size ? `${faltas.size} participante(s) con falta en la asistencia ${ra.id} aparecen bloqueados.` : '';
    cnt();
  };
  await bloquear();
  $('#fecha').onchange = bloquear;
  const setAll = v => { $$('#lst input').forEach(i => i.checked = v && !i.disabled); cnt(); };
  $('#todos').onclick = () => setAll(true); $('#ninguno').onclick = () => setAll(false);
  $('#fromRA').onclick = async () => {
    const ra = (await registros('RA')).find(r => r.fecha === $('#fecha').value);
    if (!ra) { toast('No hay asistencia registrada para esa fecha.'); return; }
    const pr = new Set(ra.presentes); $$('#lst input').forEach(i => i.checked = pr.has(+i.value) && !i.disabled); cnt();
    toast(`Se marcaron ${ra.presentes.length} presentes de ${ra.id}.`);
  };
  const lun = monday(fecha);
  const sem = all.filter(r => r.fecha >= lun && r.fecha <= addDays(lun, 6)).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  $('#sem').innerHTML = sem.length ? sem.map(r => `<li><span><span class="code">${r.id}</span> ${dayLabel(r.fecha)}<br><small>${esc(r.temas[0])}</small></span><button class="btn sec sm" data-e="${r.id}">Editar</button></li>`).join('') : '<li>Sin charlas esta semana.</li>';
  $('#sem').onclick = e => { const b = e.target.closest('[data-e]'); if (b) go('ssoma/' + b.dataset.e); };
  if (rec && rec.fecha < today()) soloLectura($('#cardC'), { id: rec.id });
  $('#save').onclick = async () => {
    const f = $('#fecha').value, hora = $('#hora').value, dur = +$('#dur').value;
    const t1 = $('#t1').value === '__otro' ? $('#t1o').value.trim() : $('#t1').value;
    const resp = $('#resp').value.trim();
    const sel = $$('#lst input:checked').map(i => +i.value);
    const errs = validarFecha(f);
    if (!hora) errs.push('La hora de la charla es obligatoria.');
    if (!t1) errs.push('Indique el tema principal de la charla.');
    if (!resp) errs.push('Indique el responsable de SSOMA.');
    if (!(dur >= 5 && dur <= 120)) errs.push('La duración debe estar entre 5 y 120 minutos.');
    if (!sel.length) errs.push('Seleccione al menos un asistente.');
    const conFalta = sel.filter(id => faltasDia.has(id));
    if (conFalta.length) errs.push(`${conFalta.length} asistente(s) tienen falta en la asistencia de ese día.`);
    const dup = all.find(r => r.fecha === f && r.hora === hora && (!rec || r.id !== rec.id));
    if (dup) errs.push(`Ya existe la charla ${dup.id} el ${dmy(f)} a las ${hora}.`);
    showErrors($('#err'), errs);
    if (errs.length) { await logEvent('bloqueo', { modulo: 'ssoma', errores: errs }); return; }
    const c = rec ? { id: rec.id, numero: rec.numero } : await nextCode('CH', parse(f).getFullYear());
    const obj = {
      id: c.id, tipo: 'CH', numero: c.numero, anio: parse(f).getFullYear(), fecha: f, hora, duracion: dur,
      temas: [t1, $('#t2').value.trim(), $('#t3').value.trim()], responsable: resp, asistentes: sel, participantes: snap(ps),
      creado: rec?.creado || new Date().toISOString(), modificado: new Date().toISOString(), sync: false
    };
    await DB.put('registros', obj);
    const nf = await wf.guardar('CH:' + obj.id, obj.fecha, 'CH', obj.temas[0]);
    if (!CFG.ssoma) { CFG.ssoma = resp; await saveCfg(); }
    await logEvent(rec ? 'edicion' : 'registro', { id: obj.id });
    toast(`Charla ${obj.id} guardada en el celular${nf ? ` con ${nf} foto(s)` : ''}.`);
    await markChanged(); go('ssoma');
  };
};

/* ------------------------------------------------------------------ ACTA DE AGUA (semanal, se marca día a día) */
VIEWS.agua = async (fechaArg) => {
  const dia = fechaArg || today();
  const ps = await participantes(dia);
  const view = $('#view');
  if (!ps.length) { view.innerHTML = `<div class="card"><h2>ACTA DE ENTREGA DE AGUA</h2><p>Primero registre los participantes en Más → Participantes.</p></div>`; return; }
  const { ra: raDia, faltas: faltasDia } = await faltasDel(dia);
  const lun = monday(dia);
  const dias = laborables(lun);
  const all = await registros('AA');
  const rec = all.find(r => r.semana === lun);
  const code = rec ? { id: rec.id } : await nextCode('AA', parse(lun).getFullYear());
  const marcados = new Set((rec?.dias?.[dia] || []).filter(id => !faltasDia.has(id)));
  const nl = NOLAB[dia];
  view.innerHTML = `
  <div class="card">
    <h2>ACTA DE ENTREGA DE AGUA</h2>
    <div class="meta"><span class="code">${esc(code.id)}</span><span>Semana del ${dmy(lun)} al ${dmy(dias[dias.length - 1])}</span></div>
    <div style="margin-top:10px">${dias.map(d => `<span class="daytag ${NOLAB[d] ? 'nl' : rec?.dias?.[d]?.length ? 'on' : ''}" title="${dmy(d)}${NOLAB[d] ? ' · no laborable' : ''}">${DIAS_C[parse(d).getDay()][0].toUpperCase()}</span>`).join('')}</div>
    ${nl ? `<div class="nlbox"><b>Día no laborable</b><span>${dmy(dia)} · ${esc(nl.motivo)}${nl.detalle ? ': ' + esc(nl.detalle) : ''}. No corresponde entrega de agua.</span></div>` : ''}
    <label>Día de entrega</label><input type="date" id="dia" value="${dia}" max="${today()}">
    <div class="row2">
      <div><label>Litros por persona</label><input type="number" id="lit" min="0.5" step="0.5" value="${esc(rec?.litros || 1)}"></div>
      <div><label>Responsable</label><input id="resp" value="${esc(rec?.responsable || CFG.residente)}" placeholder="Ing. residente"></div>
    </div>
    <div class="btns"><button class="btn sec sm" id="fromRA">Marcar presentes del día</button><button class="btn sec sm" id="todos">Todos</button><button class="btn sec sm" id="ninguno">Ninguno</button></div>
    <p class="hint" id="cnt"></p>
    <div class="tot" id="tot"></div>
    ${faltasDia.size ? `<p class="hint">${faltasDia.size} participante(s) con falta en ${raDia.id} aparecen bloqueados (no pueden recibir agua ese día).</p>` : raDia ? '' : '<p class="hint">Aún no hay asistencia de este día: regístrela primero para bloquear a quienes faltaron.</p>'}
    <div class="grid-p agua" id="grid">${ps.map(p => faltasDia.has(p.id)
      ? `<button class="pbtn blk" data-id="${p.id}" disabled title="${esc(p.nombres)}">${etiquetaP(p)}<i class="tg">Faltó · ${esc(raDia.detalle?.[p.id]?.m || 'Injustificada')}</i></button>`
      : `<button class="pbtn ${marcados.has(p.id) ? '' : 'off'}" data-id="${p.id}" title="${esc(p.nombres)}">${etiquetaP(p)}</button>`).join('')}</div>
    <div id="fotosBox"></div>
    <div id="err"></div>
    <button class="btn primary" id="save">GUARDAR ENTREGA DEL DÍA</button>
    <p class="hint">Verde = recibió agua. El acta semanal se imprime con una columna por día para la firma de cada participante.</p>
  </div>`;
  const cnt = () => {
    $('#cnt').textContent = `${marcados.size} beneficiarios marcados para el ${dayLabel($('#dia').value)}`;
    const lit = +$('#lit').value || 0;
    const otros = Object.entries(rec?.dias || {}).filter(([d]) => d !== dia).map(([, ids]) => ids.length);
    const diasCon = otros.filter(n => n).length + (marcados.size ? 1 : 0);
    const hoyL = marcados.size * lit, semL = (sum(otros) + marcados.size) * lit;
    $('#tot').innerHTML = `<div><small>Total entregado hoy</small><b>${String(r1(hoyL)).replace(".", ",")} L</b><small>${marcados.size} × ${String(lit).replace(".", ",")} L</small></div><div><small>Acumulado de la semana</small><b>${String(r1(semL)).replace(".", ",")} L</b><small>${diasCon} día${diasCon === 1 ? '' : 's'} con entrega</small></div>`;
  };
  cnt();
  $('#lit').oninput = cnt;
  const wf = widgetFotos($('#fotosBox'), await fotosDe('AA:' + dia));
  const paint = () => { $$('#grid .pbtn:not(.blk)').forEach(b => b.classList.toggle('off', !marcados.has(+b.dataset.id))); cnt(); };
  $('#grid').onclick = e => { const b = e.target.closest('.pbtn'); if (!b || b.disabled) return; const id = +b.dataset.id; marcados.has(id) ? marcados.delete(id) : marcados.add(id); paint(); };
  $('#todos').onclick = () => { ps.filter(p => !faltasDia.has(p.id)).forEach(p => marcados.add(p.id)); paint(); };
  $('#ninguno').onclick = () => { marcados.clear(); paint(); };
  $('#fromRA').onclick = async () => {
    const ra = (await registros('RA')).find(r => r.fecha === $('#dia').value);
    if (!ra) { toast('No hay asistencia registrada para ese día.'); return; }
    marcados.clear(); ra.presentes.filter(id => !faltasDia.has(id)).forEach(id => marcados.add(id)); paint();
  };
  $('#dia').onchange = e => go('agua/' + e.target.value);
  $('#save').onclick = async () => {
    const d = $('#dia').value, lit = +$('#lit').value, resp = $('#resp').value.trim();
    const errs = validarFecha(d);
    if (monday(d) !== lun) errs.push('El día no pertenece a la semana del acta.');
    if (!resp) errs.push('Indique el responsable de la entrega.');
    if (!(lit > 0)) errs.push('Los litros por persona deben ser mayores a cero.');
    if (!marcados.size) errs.push('Marque al menos un beneficiario.');
    if ([...marcados].some(id => faltasDia.has(id))) errs.push('Hay beneficiarios con falta en la asistencia de ese día.');
    showErrors($('#err'), errs);
    if (errs.length) { await logEvent('bloqueo', { modulo: 'agua', errores: errs }); return; }
    const fresh = (await registros('AA')).find(r => r.semana === lun);
    const c = fresh ? { id: fresh.id, numero: fresh.numero } : await nextCode('AA', parse(lun).getFullYear());
    const obj = fresh || { id: c.id, tipo: 'AA', numero: c.numero, anio: parse(lun).getFullYear(), semana: lun, fecha: lun, dias: {}, creado: new Date().toISOString() };
    obj.dias[d] = [...marcados]; obj.litros = lit; obj.responsable = resp;
    const ids = new Set(ps.map(p => p.id)), usados = new Set(Object.values(obj.dias).flat());
    obj.participantes = [...snap(ps), ...(obj.participantes || []).filter(p => !ids.has(p.id) && usados.has(p.id))].sort((a, b) => a.n - b.n);
    obj.modificado = new Date().toISOString(); obj.sync = false;
    await DB.put('registros', obj);
    const nf = await wf.guardar('AA:' + d, d, 'AA', 'Entrega de agua para consumo humano');
    if (!CFG.residente) { CFG.residente = resp; await saveCfg(); }
    await logEvent('registro', { id: obj.id, dia: d });
    toast(`Entrega del ${dmy(d)} guardada en ${obj.id}${nf ? ` con ${nf} foto(s)` : ''}.`);
    await markChanged(); render();
  };
};

/* ------------------------------------------------------------------ EXPEDIENTE SEMANAL */
async function revisarSemana(lun) {
  const dias = diasTrabajo(lun).filter(d => d <= today());
  const nlSem = laborables(lun).filter(d => NOLAB[d]);
  const fin = addDays(lun, 6);
  const all = await registros();
  const ra = all.filter(r => r.tipo === 'RA' && r.fecha >= lun && r.fecha <= fin);
  const ch = all.filter(r => r.tipo === 'CH' && r.fecha >= lun && r.fecha <= fin);
  const aa = all.find(r => r.tipo === 'AA' && r.semana === lun);
  const checks = [];
  const add = (estado, texto) => checks.push({ estado, texto });
  // 1. Numeración correlativa
  const gaps = [];
  for (const t of ['RA', 'CH', 'AA']) {
    const byYear = {};
    all.filter(r => r.tipo === t).forEach(r => (byYear[r.anio] = byYear[r.anio] || []).push(r.numero));
    for (const [y, nums] of Object.entries(byYear)) {
      const s = [...nums].sort((a, b) => a - b);
      const dups = s.filter((n, i) => s[i - 1] === n);
      if (dups.length) gaps.push(`${t}-${y}: números duplicados ${dups.join(', ')}`);
      for (let i = 1; i <= s[s.length - 1]; i++) if (!s.includes(i)) gaps.push(`${t}-${y}-${pad(i, 3)} falta`);
    }
  }
  add(gaps.length ? 'ERROR' : 'OK', gaps.length ? `Numeración con saltos o duplicados: ${gaps.slice(0, 4).join('; ')}` : 'Numeración correlativa sin saltos ni duplicados');
  // 2. Fechas
  const malas = [...ra, ...ch].filter(r => validarFecha(r.fecha).length);
  add(malas.length ? 'ERROR' : 'OK', malas.length ? `Fechas no válidas en: ${malas.map(r => r.id).join(', ')}` : `Todas las fechas están dentro de la semana ${dm(lun)}–${dm(laborables(lun).slice(-1)[0])}`);
  // 3. Asistencia todos los días
  const faltaRA = dias.filter(d => !ra.some(r => r.fecha === d));
  add(faltaRA.length ? 'ERROR' : 'OK', faltaRA.length ? `Falta la asistencia de: ${faltaRA.map(dayLabel).join(', ')}` : `Asistencia registrada los ${dias.length} días laborables${nlSem.length ? ` (${nlSem.length} no laborable${nlSem.length > 1 ? 's' : ''}: ${nlSem.map(d => dm(d) + ' ' + NOLAB[d].motivo.toLowerCase()).join(', ')})` : ''}`);
  // 4. Agua
  if (!aa && !dias.length) add('OK', 'Sin días laborables con entrega de agua');
  else if (!aa) add('ERROR', 'No existe el acta de entrega de agua de la semana');
  else {
    const faltaAA = dias.filter(d => !(aa.dias[d] && aa.dias[d].length));
    add(faltaAA.length ? 'ERROR' : 'OK', faltaAA.length ? `Acta de agua ${aa.id} sin entrega el: ${faltaAA.map(dayLabel).join(', ')}` : `Acta de agua ${aa.id} con los ${dias.length} días`);
  }
  // 5. Charlas
  add(ch.length === 0 ? 'ERROR' : ch.length < CFG.charlasSemana ? 'AVISO' : 'OK', `${ch.length} charla${ch.length === 1 ? '' : 's'} SSOMA en la semana (mínimo ${CFG.charlasSemana})`);
  // 6. Campos obligatorios
  const inc = [...ra.filter(r => !r.responsable || !r.horaIngreso), ...ch.filter(r => !r.temas[0] || !r.responsable || !r.hora), ...(aa && !aa.responsable ? [aa] : [])];
  add(inc.length ? 'ERROR' : 'OK', inc.length ? `Campos incompletos en: ${inc.map(r => r.id).join(', ')}` : 'Campos obligatorios completos');
  // 7. DNI
  const ps = await participantes();
  const dniMal = ps.filter(p => !/^\d{8}$/.test(String(p.dni || '')));
  add(dniMal.length ? 'AVISO' : 'OK', dniMal.length ? `${dniMal.length} participante(s) sin DNI de 8 dígitos: ${dniMal.slice(0, 3).map(p => 'P-' + pad(p.n)).join(', ')}` : 'DNI de los participantes con 8 dígitos');
  // 8. Coherencia charlas-asistencia
  const inco = [];
  ch.forEach(c => { const r = ra.find(x => x.fecha === c.fecha); if (r) { const pr = new Set(r.presentes); const n = c.asistentes.filter(a => !pr.has(a)).length; if (n) inco.push(`${c.id} (${n})`); } });
  if (aa) Object.entries(aa.dias).forEach(([d, ids]) => { const r = ra.find(x => x.fecha === d); if (r) { const fs = new Set(r.faltas); const n = ids.filter(i => fs.has(i)).length; if (n) inco.push(`${aa.id} del ${dm(d)} (${n})`); } });
  add(inco.length ? 'ERROR' : 'OK', inco.length ? `Participantes con falta que figuran en charla o entrega de agua: ${inco.join(', ')}` : 'Charlas y entrega de agua coinciden con la asistencia del día');
  return { checks, ra, ch, aa, dias, errores: checks.filter(c => c.estado === 'ERROR').length };
}

VIEWS.expediente = async (lunArg) => {
  const lun = lunArg || monday(today());
  const rev = await revisarSemana(lun);
  const entregas = (await DB.all('entregas')).sort((a, b) => b.semana.localeCompare(a.semana));
  const view = $('#view');
  view.innerHTML = `
  <div class="card">
    <h2>EXPEDIENTE SEMANAL</h2>
    <label>Semana (elija cualquier día)</label><input type="date" id="sem" value="${lun}">
    <p class="hint">Semana del ${dmy(lun)} al ${dmy(laborables(lun).slice(-1)[0])}</p>
    <ul class="list checks">${rev.checks.map(c => `<li><span class="${c.estado === 'OK' ? 'ok-ic' : c.estado === 'ERROR' ? 'bad-ic' : 'warn-ic'}">${c.estado}</span><span>${esc(c.texto)}</span></li>`).join('')}</ul>
    <button class="btn sec" id="vprev" style="width:100%;margin-top:16px">👁 VISTA PREVIA (revisar antes de imprimir)</button>
    <button class="btn primary" id="gen" ${rev.errores ? 'disabled style="opacity:.55"' : ''}>GENERAR EXPEDIENTE FOLIADO</button>
    <p class="hint">${rev.errores ? `Corrija ${rev.errores} error(es) antes de generar el expediente.` : 'Se generará el índice foliado y todos los formatos listos para imprimir y firmar.'}</p>
    <button class="btn sec" id="goInf" style="width:100%;margin-top:10px">Informes SSOMA y panel fotográfico de esta semana</button>
  </div>
  <div id="prev"></div>
  <div class="card">
    <h3>Entrega a la Municipalidad</h3>
    <p class="hint">Registre cada envío y su resultado: así se mide la tasa de devolución (KPI-2) y los documentos observados (KPI-3).</p>
    <ul class="list" id="ent">${entregas.length ? '' : '<li>Aún no hay entregas registradas.</li>'}</ul>
  </div>`;
  $('#sem').onchange = e => go('expediente/' + monday(e.target.value));
  $('#goInf').onclick = () => go('informes/' + lun);
  const ent = $('#ent');
  entregas.forEach(en => {
    const li = document.createElement('li');
    const est = en.resultado === 'conforme' ? '<span class="pill ok">Conforme</span>' : en.resultado === 'devuelto' ? `<span class="pill bad">Devuelto · ${esc(en.motivo || '')}</span>` : '<span class="pill warn">En revisión</span>';
    li.innerHTML = `<span>Semana ${dm(en.semana)} · ${en.documentos} docs / ${en.folios} folios<br><small>Enviado ${dmy(en.fechaEntrega)}</small></span><span>${est}${en.resultado ? '' : ` <button class="btn sec sm" data-r="${en.id}">Resultado</button>`}</span>`;
    ent.appendChild(li);
  });
  ent.onclick = e => { const b = e.target.closest('[data-r]'); if (b) resultadoEntrega(+b.dataset.r); };
  $('#vprev').onclick = async () => {
    const exp = await construirExpediente(lun, rev);
    $('#prev').innerHTML = `<div class="card"><h3>Vista previa · ${exp.total} folios</h3>
      <p class="hint">Revise los correlativos, los folios y los cuadros. ${rev.errores ? `<b>Hay ${rev.errores} error(es) por corregir:</b> la vista previa no es válida para la entrega.` : 'Si todo está correcto, pulse "Generar expediente foliado".'}</p>
      <table class="mini"><tr><th>Documento</th><th>Fecha</th><th>Folios</th></tr>
      ${exp.indice.map(i => `<tr><td>${esc(i.codigo)}</td><td>${dm(i.fecha)}</td><td>${i.desde === i.hasta ? pad(i.desde, 3) : pad(i.desde, 3) + '–' + pad(i.hasta, 3)}</td></tr>`).join('')}</table></div>
      <div class="screen-preview borrador">${exp.html}</div>`;
    await logEvent('vista_previa', { semana: lun, folios: exp.total });
    $('#prev').scrollIntoView({ behavior: 'smooth' });
  };
  $('#gen').onclick = async () => {
    if (rev.errores) return;
    const exp = await construirExpediente(lun, rev);
    $('#printArea').innerHTML = exp.html;
    $('#prev').innerHTML = `
    <div class="card">
      <h3>Expediente generado · ${exp.total} folios</h3>
      <table class="mini"><tr><th>Documento</th><th>Fecha</th><th>Folios</th></tr>
      ${exp.indice.map(i => `<tr><td>${esc(i.codigo)}</td><td>${dm(i.fecha)}</td><td>${i.desde === i.hasta ? pad(i.desde, 3) : pad(i.desde, 3) + '–' + pad(i.hasta, 3)}</td></tr>`).join('')}
      <tr><th>Total</th><th></th><th>${exp.total} folios</th></tr></table>
      <div class="btns"><button class="btn primary" id="print">IMPRIMIR / GUARDAR PDF</button></div>
      <button class="btn sec" id="reg" style="width:100%;margin-top:10px">Registrar entrega a la Municipalidad</button>
      <p class="hint">En el celular elija "Guardar como PDF" o una impresora. Las firmas, huellas y sellos se colocan sobre el impreso.</p>
    </div>
    <div class="screen-preview">${exp.html}</div>`;
    $('#print').onclick = () => window.print();
    $('#reg').onclick = async () => {
      const existe = (await DB.all('entregas')).find(e => e.semana === lun && !e.resultado);
      if (existe) { toast('Esta semana ya tiene una entrega en revisión.'); return; }
      await DB.add('entregas', { semana: lun, fechaEntrega: today(), documentos: exp.indice.length, folios: exp.total, resultado: '', motivo: '', observados: 0, sync: false });
      await logEvent('entrega', { semana: lun });
      toast('Entrega registrada.'); await markChanged(); render();
    };
    await logEvent('expediente', { semana: lun, folios: exp.total, documentos: exp.indice.length });
    $('#prev').scrollIntoView({ behavior: 'smooth' });
  };
};

async function resultadoEntrega(id) {
  const en = await DB.get('entregas', id);
  $('#view').innerHTML = `
  <div class="card"><h2>RESULTADO DE LA REVISIÓN</h2>
    <p class="hint">Expediente de la semana ${dmy(en.semana)} · enviado el ${dmy(en.fechaEntrega)} · ${en.documentos} documentos</p>
    <label>Resultado</label><select id="res"><option value="conforme">Conforme (aprobado)</option><option value="devuelto">Devuelto para corrección</option></select>
    <div id="dev" class="hidden">
      <label>Motivo principal</label><select id="mot">
        <option>Error de fecha</option><option>Error de numeración</option><option>Error de escritura</option><option>Firma o sello faltante</option><option>Documento faltante</option><option>Otro</option></select>
      <label>N.° de documentos observados</label><input type="number" id="obs" min="1" max="${en.documentos}" value="1">
      <label>Detalle</label><textarea id="det" rows="2"></textarea>
    </div>
    <label>Fecha de respuesta</label><input type="date" id="fr" value="${today()}" max="${today()}">
    <div id="err"></div>
    <button class="btn primary" id="ok">GUARDAR RESULTADO</button>
  </div>`;
  $('#res').onchange = e => $('#dev').classList.toggle('hidden', e.target.value !== 'devuelto');
  $('#ok').onclick = async () => {
    en.resultado = $('#res').value; en.fechaRespuesta = $('#fr').value;
    if (en.resultado === 'devuelto') { en.motivo = $('#mot').value; en.observados = +$('#obs').value || 1; en.detalle = $('#det').value.trim(); }
    else { en.motivo = ''; en.observados = 0; }
    en.sync = false;
    await DB.put('entregas', en); await logEvent('resultado_entrega', { semana: en.semana, resultado: en.resultado });
    toast('Resultado guardado.'); await markChanged(); go('expediente/' + en.semana);
  };
}

/* Paginación: filas por hoja para que el foliado sea exacto */
const FILAS_1 = 20, FILAS_N = 26;
function trozos(arr) {
  const out = [arr.slice(0, FILAS_1)];
  for (let i = FILAS_1; i < arr.length; i += FILAS_N) out.push(arr.slice(i, i + FILAS_N));
  return out;
}
const encab = (folio) => `<div class="folio">FOLIO ${pad(folio, 3)}</div><div class="prog">Programa de Empleo Temporal "Llamkasun Perú" · Ministerio de Trabajo y Promoción del Empleo</div>`;
const firmas = (a, b, c) => `<div class="firmas"><div>${a}</div><div>${b}</div><div>${c}</div></div>`;
const nombreRol = (n, rol) => `${n ? esc(n) + '<br>' : ''}${rol}`;

async function construirExpediente(lun, rev, opts = {}) {
  const docs = [];
  for (const d of laborables(lun)) {
    rev.ra.filter(r => r.fecha === d).forEach(r => docs.push(r));
    rev.ch.filter(r => r.fecha === d).sort((a, b) => a.hora.localeCompare(b.hora)).forEach(r => docs.push(r));
  }
  if (rev.aa) docs.push(rev.aa);
  let folio = opts.folioInicial ?? 2; const pages = []; const indice = [];
  for (const r of docs) {
    const ps = r.participantes;
    let rows, titulo, intro, tabla, fin;
    if (r.tipo === 'RA') {
      const pr = new Set(r.presentes), det = r.detalle || {};
      rows = ps.map(p => { const d = det[p.id]; return pr.has(p.id)
        ? `<tr><td class="c">${pad(p.n)}</td><td>${esc(p.nombres)}</td><td class="c">${esc(p.dni)}</td><td class="c">${d?.e === 'T' ? '<b>TARDANZA</b>' : r.horaIngreso}</td><td></td><td class="c">${d?.e === 'MD' ? '<b>MEDIO DÍA</b>' : r.horaSalida}</td><td></td></tr>`
        : `<tr><td class="c">${pad(p.n)}</td><td>${esc(p.nombres)}</td><td class="c">${esc(p.dni)}</td><td class="c" colspan="4"><b>FALTA</b>${d?.m ? ' — ' + esc(d.m) : ''}</td></tr>`; });
      titulo = 'REGISTRO DE ASISTENCIA DE PARTICIPANTES';
      intro = `<p><b>Convenio N.°</b> ${esc(CFG.convenio)} &nbsp;·&nbsp; <b>Fecha:</b> ${DIAS[parse(r.fecha).getDay()]} ${dmy(r.fecha)} &nbsp;·&nbsp; <b>Código:</b> ${r.id} &nbsp;·&nbsp; <b>Presentes:</b> ${r.presentes.length} &nbsp;·&nbsp; <b>Faltas:</b> ${r.faltas.length}${r.tardanzas ? ` &nbsp;·&nbsp; <b>Tardanzas:</b> ${r.tardanzas}` : ''}${r.medioDia ? ` &nbsp;·&nbsp; <b>Medio día:</b> ${r.medioDia}` : ''}</p>`;
      tabla = `<tr><th class="c">N.°</th><th>APELLIDOS Y NOMBRES</th><th class="c">DNI/CE</th><th class="c" style="width:9%">HORA DE INGRESO</th><th class="c" style="width:15%">FIRMA</th><th class="c" style="width:9%">HORA DE SALIDA</th><th class="c" style="width:15%">FIRMA</th></tr>`;
      fin = firmas(nombreRol(CFG.residente, 'Residente / Responsable técnico de obra'), nombreRol(CFG.supervisor, 'Supervisor / Inspector de obra'), nombreRol(CFG.representante, 'Representante del Programa "Llamkasun Perú"'));
    } else if (r.tipo === 'CH') {
      const as = new Set(r.asistentes);
      rows = ps.filter(p => as.has(p.id)).map((p, i) => `<tr><td class="c">${pad(i + 1)}</td><td>${esc(p.nombres)}</td><td class="c">${esc(p.dni)}</td><td></td></tr>`);
      const f = parse(r.fecha);
      titulo = 'ACTA DE CHARLA DE SEGURIDAD';
      intro = `<p>En el ${esc(CFG.lugar)}, a los ${f.getDate()} días del mes de ${MESES[f.getMonth()]} de ${f.getFullYear()}, a horas ${r.hora}, el responsable de SSOMA del proyecto de inversión, ${esc(r.responsable)}, brindó la charla de seguridad en obra (${r.duracion} min) a los participantes del convenio N.° ${esc(CFG.convenio)} del proyecto de inversión denominado: "${esc(CFG.proyecto)}" con CUI N.° ${esc(CFG.cui)}, código de proyecto N.° ${esc(CFG.codProyecto)}, Cod. INFOBRAS N.° ${esc(CFG.infobras)}.</p>
        <p><b>Código:</b> ${r.id}. Los temas abordados en la charla fueron los siguientes:</p>
        <p>a. ${esc(r.temas[0])}<br>b. ${esc(r.temas[1] || '________________________')}<br>c. ${esc(r.temas[2] || '________________________')}</p>
        <p>En conformidad con la presente firman los asistentes a la charla:</p>`;
      tabla = `<tr><th class="c">N.°</th><th>NOMBRE</th><th class="c">DNI</th><th class="c" style="width:28%">FIRMA</th></tr>`;
      fin = firmas(nombreRol(CFG.residente, 'Residente de obra'), nombreRol(r.responsable, 'Responsable de SSOMA'), nombreRol(CFG.supervisor, 'Supervisor de obra'));
    } else {
      const dias = laborables(r.semana);
      rows = ps.map(p => `<tr><td class="c">${pad(p.n)}</td><td>${esc(p.nombres)}</td>${dias.map(d => `<td class="c">${NOLAB[d] ? '—' : (r.dias[d] || []).includes(p.id) ? 'X' : ''}</td>`).join('')}<td class="c">${esc(p.dni)}</td><td></td></tr>`);
      titulo = 'ACTA DE ENTREGA DE AGUA PARA CONSUMO HUMANO';
      const ult = dias[dias.length - 1];
      intro = `<p>En el ${esc(CFG.lugar)}, durante la semana del <b>${parse(r.semana).getDate()} de ${MESES[parse(r.semana).getMonth()]} al ${parse(ult).getDate()} de ${MESES[parse(ult).getMonth()]} de ${parse(ult).getFullYear()}</b>, se deja constancia de la entrega de agua para consumo humano a los participantes del Proyecto de Inversión denominado: "${esc(CFG.proyecto)}" con CUI N.° ${esc(CFG.cui)}, código de proyecto N.° ${esc(CFG.codProyecto)}, Cod. INFOBRAS N.° ${esc(CFG.infobras)} del Programa Llamkasun Perú, con Convenio N.° ${esc(CFG.convenio)}; por lo que a continuación firman los participantes y marcan los días que han recibido la cantidad de ${r.litros === 1 ? 'un (01) litro' : r.litros + ' litros'} de agua para consumo humano. <b>Código:</b> ${r.id}.</p>`;
      tabla = `<tr><th class="c">N.°</th><th>NOMBRE</th>${dias.map(d => `<th class="c">${DIAS_C[parse(d).getDay()]}<br>${dm(d)}${NOLAB[d] ? '<br>NO LAB.' : ''}</th>`).join('')}<th class="c">DNI</th><th class="c" style="width:20%">FIRMA</th></tr>`;
      fin = firmas(nombreRol(r.responsable, 'Residente de obra'), nombreRol(CFG.supervisor, 'Supervisor de obra'), nombreRol(CFG.representante, 'Representante del Programa'));
    }
    const ch = trozos(rows);
    const desde = folio;
    ch.forEach((rs, i) => {
      const last = i === ch.length - 1;
      pages.push(`<section class="sheet">${encab(folio)}<h1>${titulo}</h1>${i === 0 ? intro : `<p class="cont">${r.id} — continuación (hoja ${i + 1} de ${ch.length})</p>`}
        <table>${tabla}${rs.join('')}</table>${last ? fin : `<p class="cont">Continúa en el folio ${pad(folio + 1, 3)}</p>`}</section>`);
      folio++;
    });
    indice.push({ codigo: r.id, doc: titulo, fecha: r.fecha, desde, hasta: folio - 1 });
  }
  const total = folio - 1;
  const fin = laborables(lun).slice(-1)[0];
  const idx = `<section class="sheet">${encab(1)}<h1>ÍNDICE DEL EXPEDIENTE SEMANAL</h1>
    <p><b>Proyecto:</b> "${esc(CFG.proyecto)}" · CUI N.° ${esc(CFG.cui)} · Convenio N.° ${esc(CFG.convenio)}</p>
    <p><b>Semana:</b> del ${dmy(lun)} al ${dmy(fin)} &nbsp;·&nbsp; <b>Total de folios:</b> ${total} &nbsp;·&nbsp; <b>Generado:</b> ${dmy(today())}</p>
    <table class="idx"><tr><th class="c">N.°</th><th>Documento</th><th class="c">Código</th><th class="c">Fecha</th><th class="c">Folios</th></tr>
    <tr><td class="c">00</td><td>Índice del expediente</td><td class="c">—</td><td class="c">${dmy(today())}</td><td class="c">001</td></tr>
    ${indice.map((x, i) => `<tr><td class="c">${pad(i + 1)}</td><td>${esc(x.doc)}</td><td class="c">${x.codigo}</td><td class="c">${dmy(x.fecha)}</td><td class="c">${x.desde === x.hasta ? pad(x.desde, 3) : pad(x.desde, 3) + ' – ' + pad(x.hasta, 3)}</td></tr>`).join('')}
    <tr><th colspan="4" style="text-align:right">TOTAL DE FOLIOS</th><th class="c">${total}</th></tr></table>
    ${laborables(lun).some(d => NOLAB[d]) ? `<p><b>Días no laborables de la semana:</b> ${laborables(lun).filter(d => NOLAB[d]).map(d => `${DIAS[parse(d).getDay()]} ${dmy(d)} (${esc(NOLAB[d].motivo)}${NOLAB[d].detalle ? ': ' + esc(NOLAB[d].detalle) : ''})`).join('; ')}. En esas fechas no corresponde registro de asistencia, charla ni entrega de agua.</p>` : ''}
    <p style="margin-top:10px"><b>Revisión automática previa (RegistraObra v1.2):</b> ${rev.checks.map(c => `${c.estado === 'OK' ? '✔' : '⚠'} ${esc(c.texto)}`).join('; ')}.</p>
    ${firmas(nombreRol(CFG.residente, 'Residente de obra'), nombreRol(CFG.supervisor, 'Supervisor de obra'), 'Recibido por (cargo de entrega)')}</section>`;
  return { html: (opts.sinIndice ? '' : idx) + pages.join(''), indice, total };
}

/* ------------------------------------------------------------------ MÁS */
VIEWS.mas = async () => {
  $('#view').innerHTML = `
  <div class="card"><h2>MÁS OPCIONES</h2>
    <ul class="list">
      <li><span><b>Informes automáticos</b><br><small>Remisión semanal SSOMA, informe mensual y panel fotográfico</small></span><button class="btn sec sm" data-g="informes">Abrir</button></li>
      <li><span><b>Tiempos e indicadores</b><br><small>Cronómetro de actividades y KPIs del piloto</small></span><button class="btn sec sm" data-g="tiempos">Abrir</button></li>
      <li><span><b>Participantes</b><br><small>Lista del programa guardada solo en este celular</small></span><button class="btn sec sm" data-g="participantes">Abrir</button></li>
      <li><span><b>Datos y respaldo</b><br><small>Compartir respaldo, exportar CSV/JSON, restaurar</small></span><button class="btn sec sm" data-g="datos">Abrir</button></li>
      <li><span><b>Configuración</b><br><small>Proyecto, responsables, sincronización y clave</small></span><button class="btn sec sm" data-g="config">Abrir</button></li>
    </ul>
    <p class="hint">RegistraObra v1.2 · funciona sin Internet · datos protegidos según la Ley N.° 29733.</p>
  </div>`;
  $('#view').onclick = e => { const b = e.target.closest('[data-g]'); if (b) go(b.dataset.g); };
};

/* ---------- Tiempos e indicadores */
const ACTIVIDADES = ['Llenado del registro de asistencia', 'Recolección de firmas de asistencia', 'Registro de charla SSOMA y firmas',
  'Acta de entrega de agua y firmas', 'Revisión y generación del expediente', 'Foliado, copias y cargos', 'Corrección por devolución'];
const ROLES = ['Responsable de asistencia', 'Ingeniero SSOMA', 'Ingeniero residente', 'Equipo del proyecto'];
const LINEA_BASE = { hh: 43.5, meta: 21.75, devolucion: 100, metaDev: 25 };
VIEWS.tiempos = async (lunArg) => {
  const lun = lunArg || monday(today());
  const fin = addDays(lun, 6);
  const run = await DB.getConfig('timerRun', null);
  const ts = (await DB.all('tiempos')).filter(t => t.fecha >= lun && t.fecha <= fin).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const hh = sum(ts.map(t => t.minutos)) / 60;
  const ent = await DB.all('entregas');
  const resueltas = ent.filter(e => e.resultado);
  const dev = resueltas.filter(e => e.resultado === 'devuelto');
  const docs = sum(resueltas.map(e => e.documentos)); const obs = sum(resueltas.map(e => e.observados || 0));
  const regs = await DB.all('registros'); const syncd = regs.filter(r => r.sync).length;
  const ev = await DB.all('eventos'); const bloqueos = ev.filter(e => e.tipo === 'bloqueo').length;
  const porRol = ROLES.map(r => [r, sum(ts.filter(t => t.rol === r).map(t => t.minutos)) / 60]).filter(x => x[1] > 0);
  $('#view').innerHTML = `
  <div class="card"><h2>CRONÓMETRO DE ACTIVIDADES</h2>
    <label>Actividad documental</label><select id="act">${ACTIVIDADES.map(a => `<option ${run?.actividad === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
    <label>Rol de quien la realiza</label><select id="rol">${ROLES.map(a => `<option ${run?.rol === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
    <div class="timer" id="tm">00:00:00</div>
    <button class="btn primary" id="tbtn">${run ? 'DETENER Y GUARDAR' : 'INICIAR CRONÓMETRO'}</button>
    ${run ? '<button class="btn danger" id="tcancel" style="width:100%;margin-top:8px">Cancelar sin guardar</button>' : ''}
    <h3>Registro manual</h3>
    <div class="row2"><div><label>Fecha</label><input type="date" id="mf" value="${today()}" max="${today()}"></div><div><label>Minutos</label><input type="number" id="mm" min="1" max="600"></div></div>
    <label>Nota (opcional)</label><input id="mn" placeholder="p. ej. medido con reloj, en papel">
    <div id="err"></div>
    <button class="btn sec" id="madd" style="width:100%;margin-top:10px">Agregar tiempo manual</button>
  </div>
  <div class="card"><h2>INDICADORES DE LA SEMANA</h2>
    <label>Semana</label><input type="date" id="sem" value="${lun}">
    <div class="kpi" style="margin-top:10px">
      <div><b>${r1(hh)} h-h</b><span>KPI-1 · línea base ${LINEA_BASE.hh} · meta ≤ ${LINEA_BASE.meta}${hh ? ` · ${r1((1 - hh / LINEA_BASE.hh) * 100)} % menos` : ''}</span></div>
      <div><b>${resueltas.length ? Math.round(dev.length / resueltas.length * 100) + ' %' : '—'}</b><span>KPI-2 · devolución (${dev.length}/${resueltas.length} entregas) · meta ≤ 25 %</span></div>
      <div><b>${docs ? r1(obs / docs * 100) + ' %' : '—'}</b><span>KPI-3 · documentos observados (${obs}/${docs})</span></div>
      <div><b>${regs.length ? Math.round(syncd / regs.length * 100) + ' %' : '—'}</b><span>KPI-5 · registros sincronizados (${syncd}/${regs.length})</span></div>
    </div>
    <p class="hint">Errores bloqueados por las validaciones de la app (acumulado): <b>${bloqueos}</b>.</p>
    ${porRol.length ? `<table class="mini"><tr><th>Rol</th><th>h-h semana</th></tr>${porRol.map(([r, h]) => `<tr><td>${r}</td><td>${r1(h)}</td></tr>`).join('')}</table>` : ''}
    <h3>Tiempos registrados</h3>
    <table class="mini"><tr><th>Fecha</th><th>Actividad</th><th>Min</th><th></th></tr>
    ${ts.length ? ts.map(t => `<tr><td>${dm(t.fecha)}</td><td>${esc(t.actividad)}<br><small>${esc(t.rol)} · ${esc(t.metodo)}</small></td><td>${r1(t.minutos)}</td><td><button class="btn danger sm" data-d="${t.id}">✕</button></td></tr>`).join('') : '<tr><td colspan="4">Sin tiempos esta semana.</td></tr>'}</table>
  </div>`;
  clearInterval(timerInt);
  if (run) {
    const tick = () => { const s = Math.floor((Date.now() - run.inicio) / 1000); $('#tm') && ($('#tm').textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`); };
    tick(); timerInt = setInterval(tick, 1000);
    $('#tcancel').onclick = async () => { await DB.setConfig('timerRun', null); clearInterval(timerInt); render(); };
  }
  $('#tbtn').onclick = async () => {
    if (!run) { await DB.setConfig('timerRun', { actividad: $('#act').value, rol: $('#rol').value, inicio: Date.now() }); render(); return; }
    const min = (Date.now() - run.inicio) / 60000;
    await DB.setConfig('timerRun', null); clearInterval(timerInt);
    if (min < 0.1) { toast('Tiempo demasiado corto: no se guardó.'); render(); return; }
    await DB.add('tiempos', { fecha: today(), actividad: run.actividad, rol: run.rol, minutos: r1(min), metodo: 'cronómetro', inicio: new Date(run.inicio).toISOString(), fin: new Date().toISOString(), sync: false });
    toast(`Guardados ${r1(min)} min de "${run.actividad}".`); await markChanged(); render();
  };
  $('#madd').onclick = async () => {
    const f = $('#mf').value, m = +$('#mm').value;
    const errs = [];
    if (!f || f > today()) errs.push('Fecha no válida.');
    if (!(m > 0 && m <= 600)) errs.push('Ingrese minutos entre 1 y 600.');
    showErrors($('#err'), errs); if (errs.length) return;
    await DB.add('tiempos', { fecha: f, actividad: $('#act').value, rol: $('#rol').value, minutos: m, metodo: 'manual', nota: $('#mn').value.trim(), sync: false });
    toast('Tiempo agregado.'); await markChanged(); render();
  };
  $('#sem').onchange = e => go('tiempos/' + monday(e.target.value));
  $('#view').onclick = async e => { const b = e.target.closest('[data-d]'); if (b) { await DB.del('tiempos', +b.dataset.d); toast('Tiempo eliminado.'); refreshPending(); render(); } };
};

/* ---------- Participantes */
const EJEMPLO = ['QUISPE HUAMÁN, ROSA ELENA', 'CONDORI MAMANI, JUAN CARLOS', 'HUAMANÍ ROJAS, MARÍA LUZ', 'PALOMINO CCAHUANA, PEDRO', 'TAIPE QUISPE, ANA MARÍA',
  'CCORAHUA LAPA, LUIS ALBERTO', 'MENDOZA AYALA, CARMEN ROSA', 'YUPANQUI SOTO, JOSÉ LUIS', 'GUTIÉRREZ PAREDES, ELENA', 'RAMOS CUADROS, MIGUEL ÁNGEL',
  'SULCA HUAMANÍ, LUCÍA', 'PILLACA ORÉ, VÍCTOR RAÚL', 'CÁRDENAS LÓPEZ, NORMA', 'ALLCCA TINCO, FÉLIX', 'BARRIENTOS CRUZ, SONIA',
  'ESPINOZA VARGAS, JULIO CÉSAR', 'TORRES CAYLLAHUA, MARTHA', 'LLACCTA PARIONA, RUBÉN', 'ORÉ CHAUCA, GLADYS', 'CAHUANA RIVERA, ÓSCAR',
  'NÚÑEZ PALACIOS, ROCÍO', 'VILCA AUCCASI, ALBERTO', 'MEDINA ARONÉS, SILVIA', 'CHIPANA HUARCAYA, EDGAR', 'ZEA MORALES, YOLANDA',
  'PAUCAR TITO, RAÚL', 'ROMÁN SALCEDO, ISABEL', 'HUAYTA ÑAUPA, DANIEL', 'ACHAHUI CÓRDOVA, NANCY', 'LIMACHE QUINTO, ERNESTO',
  'SAIRE BELLIDO, PATRICIA', 'MAYTA ROJAS, FREDY', 'VELARDE INGA, TERESA', 'CUSI ALARCÓN, MARIO', 'FLORES ANCCASI, BEATRIZ',
  'HUARACA POMA, SAMUEL', 'LAURA CHIRINOS, DORIS'];
VIEWS.participantes = async () => {
  const todos = (await DB.all('participantes')).sort((a, b) => a.n - b.n || (a.fechaAlta || '').localeCompare(b.fechaAlta || ''));
  const ps = todos.filter(p => estadoP(p) === 'Activo');
  const inact = todos.filter(p => estadoP(p) !== 'Activo');
  const usados = new Set((await registros()).flatMap(r => [...(r.presentes || []), ...(r.faltas || []), ...(r.asistentes || []), ...Object.values(r.dias || {}).flat()]));
  const nombreDe = id => { const p = todos.find(x => x.id === id); return p ? `P-${pad(p.n)} ${p.nombres}` : ''; };
  const sigN = () => (todos.length ? Math.max(...todos.map(p => p.n)) : 0) + 1;
  const item = p => {
    const e = estadoP(p);
    const extra = [p.fechaAlta ? `alta ${dmy(p.fechaAlta)}` : '', p.reemplazaA ? `reemplaza a ${esc(nombreDe(p.reemplazaA))}` : '',
      p.fechaBaja ? `baja ${dmy(p.fechaBaja)}${p.motivoBaja ? ' · ' + esc(p.motivoBaja) : ''}` : '', p.reemplazadoPor ? `reemplazado por ${esc(nombreDe(p.reemplazadoPor))}` : ''].filter(Boolean).join(' · ');
    return `<li class="pitem" data-id="${p.id}"><span>P-${pad(p.n)} · ${esc(p.nombres)} <span class="est est-${e.toLowerCase()}">${e}</span><br><small>DNI ${esc(p.dni)}${extra ? ' · ' + extra : ''}</small></span>
      <span class="pacc">${e === 'Activo' ? `<button class="btn sec sm" data-a="baja">Baja</button><button class="btn sec sm" data-a="reem">Reemplazar</button>` : `<button class="btn sec sm" data-a="reac">Reactivar</button>`}
      ${usados.has(p.id) ? '' : `<button class="btn danger sm" data-a="del">Quitar</button>`}</span></li>`;
  };
  $('#view').innerHTML = `
  <div class="card"><h2>PARTICIPANTES (${ps.length} activos)</h2>
    <p class="hint">La lista se guarda solo en este celular. No la comparta por redes ni la publique (Ley N.° 29733).</p>
    <div class="row2"><div><label>N.°</label><input id="pn" type="number" min="1" value="${sigN()}"></div><div><label>DNI/CE</label><input id="pd" inputmode="numeric" maxlength="12"></div></div>
    <label>Apellidos y nombres</label><input id="pnom" style="text-transform:uppercase" placeholder="APELLIDOS, NOMBRES">
    <div id="err"></div>
    <button class="btn sec" id="padd" style="width:100%;margin-top:10px">Agregar participante</button>
    <h3>Importar lista</h3>
    <p class="hint">Pegue una fila por participante: <code>N;APELLIDOS Y NOMBRES;DNI</code> (también acepta comas o tabulaciones, como al copiar desde Excel).</p>
    <textarea id="imp" rows="4"></textarea>
    <div class="btns"><button class="btn sec sm" id="pimp">Importar</button><button class="btn sec sm" id="pej">Cargar 37 participantes de EJEMPLO (ficticios)</button>${usados.size ? '' : '<button class="btn danger sm" id="pclr">Vaciar lista</button>'}</div>
    <input type="search" id="pbus" class="buscar" placeholder="🔍 Buscar participante" autocomplete="off">
    <h3>Activos</h3>
    <ul class="list" id="pl">${ps.map(item).join('') || '<li>Sin participantes activos.</li>'}</ul>
    ${inact.length ? `<h3>Dados de baja o reemplazados (${inact.length})</h3><p class="hint">Se conservan para que las semanas anteriores se impriman igual.</p><ul class="list" id="pl2">${inact.map(item).join('')}</ul>` : ''}
    <p class="hint">"Quitar" solo aparece si el participante no figura en ningún registro. Si ya figura, use "Baja" o "Reemplazar": su historial se conserva.</p>
  </div>`;
  const addMany = async lines => {
    const exist = await participantes(); let n = 0; const errs = [];
    for (const [num, nom, dni] of lines) {
      if (!nom || !num) { errs.push(`Fila incompleta: ${num || ''} ${nom || ''}`); continue; }
      if (exist.some(p => p.n === +num)) { errs.push(`El N.° ${num} ya está asignado a un participante activo.`); continue; }
      const p = { n: +num, nombres: nom.trim().toUpperCase(), dni: String(dni || '').trim(), activo: true, estado: 'Activo', fechaAlta: '' };
      p.id = await DB.add('participantes', p); exist.push(p); n++;
    }
    return { n, errs };
  };
  $('#padd').onclick = async () => {
    const r = await addMany([[$('#pn').value, $('#pnom').value, $('#pd').value]]);
    showErrors($('#err'), r.errs);
    if (r.n) { toast('Participante agregado.'); render(); }
  };
  $('#pimp').onclick = async () => {
    const lines = $('#imp').value.split(/\r?\n/).map(l => l.split(/[;\t]|,(?=\s*\d{6,}\s*$)/).map(s => s.trim())).filter(l => l.length >= 2 && l[0]);
    const r = await addMany(lines);
    showErrors($('#err'), r.errs); toast(`${r.n} participantes importados.`); if (r.n) render();
  };
  $('#pej').onclick = async () => {
    const base = sigN() - 1;
    const r = await addMany(EJEMPLO.map((nom, i) => [base + i + 1, nom + ' (EJEMPLO)', String(90000001 + base + i)]));
    toast(`${r.n} participantes de ejemplo cargados.`); render();
  };
  if ($('#pclr')) $('#pclr').onclick = async () => {
    if ($('#pclr').dataset.armed) { await DB.clear('participantes'); toast('Lista vaciada.'); render(); return; }
    $('#pclr').dataset.armed = '1'; $('#pclr').textContent = 'Toque otra vez para confirmar';
  };
  $('#pbus').oninput = e => { const q = norm(e.target.value.trim()); $$('.pitem').forEach(li => li.style.display = !q || norm(li.textContent).includes(q) ? '' : 'none'); };
  const form = (li, html) => { $$('.pform').forEach(f => f.remove()); li.insertAdjacentHTML('afterend', `<li class="pform"><div>${html}<div class="perr"></div></div></li>`); return li.nextElementSibling; };
  $('#view').onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const li = b.closest('.pitem'), p = todos.find(x => x.id === +li.dataset.id), a = b.dataset.a;
    if (a === 'del') {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '¿Seguro?'; return; }
      await DB.del('participantes', p.id); toast('Participante quitado.'); render(); return;
    }
    if (a === 'reac') {
      Object.assign(p, { estado: 'Activo', activo: true, fechaBaja: '', motivoBaja: '' });
      if (ps.some(x => x.n === p.n)) { toast(`El N.° ${p.n} está ocupado: se le asignó el N.° ${sigN()}.`); p.n = sigN(); }
      await DB.put('participantes', p); await logEvent('participante_reactivado', { id: p.id }); render(); return;
    }
    if (a === 'baja') {
      const f = form(li, `<b>Dar de baja a P-${pad(p.n)} ${esc(p.nombres)}</b>
        <div class="row2"><div><label>Desde (ya no figura)</label><input type="date" class="fb" value="${today()}"></div>
        <div><label>Motivo</label><select class="mb"><option>Renuncia</option><option>Abandono</option><option>Descanso médico prolongado</option><option>Fin de participación</option><option>Otro</option></select></div></div>
        <button class="btn primary ok">CONFIRMAR BAJA</button>`);
      $('.ok', f).onclick = async () => {
        const fb = $('.fb', f).value; if (!fb) { showErrors($('.perr', f), ['Indique la fecha.']); return; }
        Object.assign(p, { estado: 'Inactivo', activo: false, fechaBaja: fb, motivoBaja: $('.mb', f).value });
        await DB.put('participantes', p); await logEvent('participante_baja', { id: p.id, fecha: fb });
        toast(`P-${pad(p.n)} dado de baja desde el ${dmy(fb)}. Su historial se conserva.`); render();
      };
    }
    if (a === 'reem') {
      const f = form(li, `<b>Reemplazar a P-${pad(p.n)} ${esc(p.nombres)}</b>
        <label>Desde (primer día del reemplazante)</label><input type="date" class="fb" value="${today()}">
        <label>Apellidos y nombres del reemplazante</label><input class="nn" style="text-transform:uppercase" placeholder="APELLIDOS, NOMBRES">
        <label>DNI/CE</label><input class="nd" inputmode="numeric" maxlength="12">
        <label>Código</label><select class="nc"><option value="mismo">Usar el mismo N.° (P-${pad(p.n)})</option><option value="nuevo">Nuevo N.° correlativo (P-${pad(sigN())})</option></select>
        <button class="btn primary ok">CONFIRMAR REEMPLAZO</button>`);
      $('.ok', f).onclick = async () => {
        const fb = $('.fb', f).value, nom = $('.nn', f).value.trim().toUpperCase(), dni = $('.nd', f).value.trim(), errs = [];
        if (!fb) errs.push('Indique la fecha.'); if (!nom) errs.push('Indique el nombre del reemplazante.');
        if (dni && !/^\d{8,12}$/.test(dni)) errs.push('El DNI/CE debe tener solo números (8 dígitos para DNI).');
        if (errs.length) { showErrors($('.perr', f), errs); return; }
        const n = $('.nc', f).value === 'mismo' ? p.n : sigN();
        const nuevo = { n, nombres: nom, dni, activo: true, estado: 'Activo', fechaAlta: fb, reemplazaA: p.id };
        nuevo.id = await DB.add('participantes', nuevo);
        Object.assign(p, { estado: 'Reemplazado', activo: false, fechaBaja: fb, motivoBaja: 'Reemplazo', reemplazadoPor: nuevo.id });
        await DB.put('participantes', p); await logEvent('participante_reemplazo', { sale: p.id, entra: nuevo.id, fecha: fb });
        toast(`${nom} reemplaza a P-${pad(p.n)} desde el ${dmy(fb)}.`); render();
      };
    }
  };
};

/* ---------- Datos y respaldo */
function descargar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const csv = (rows) => '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
VIEWS.datos = async () => {
  $('#view').innerHTML = `
  <div class="card"><h2>DATOS Y RESPALDO</h2>
    <p class="hint">Exporte los datos para el informe del piloto (se abren en Excel) o haga un respaldo completo.</p>
    <button class="btn primary" id="eS" style="margin-top:8px">📤 COMPARTIR RESPALDO RÁPIDO</button>
    <p class="hint">Abre WhatsApp, correo u otra app del celular con el respaldo completo. Contiene datos personales: envíelo solo a su propio correo o al residente (Ley N.° 29733).</p>
    <div class="btns">
      <button class="btn sec" id="eT">Tiempos (CSV)</button>
      <button class="btn sec" id="eR">Registros (CSV)</button>
      <button class="btn sec" id="eE">Entregas (CSV)</button>
      <button class="btn sec" id="eV">Eventos y validaciones (CSV)</button>
      <button class="btn sec" id="eJ">Respaldo completo (JSON)</button>
    </div>
    <h3>Restaurar respaldo</h3>
    <input type="file" id="fJ" accept="application/json,.json">
    <p class="hint">Reemplaza todos los datos del celular por los del archivo.</p>
    <div id="msg"></div>
  </div>`;
  const stamp = today();
  $('#eT').onclick = async () => { const t = await DB.all('tiempos'); descargar(`tiempos_${stamp}.csv`, csv([['fecha', 'semana', 'actividad', 'rol', 'minutos', 'metodo', 'nota'], ...t.map(x => [x.fecha, monday(x.fecha), x.actividad, x.rol, String(x.minutos).replace('.', ','), x.metodo, x.nota || ''])]), 'text/csv'); };
  $('#eR').onclick = async () => {
    const r = await DB.all('registros');
    const nl = await DB.all('nolab');
    descargar(`registros_${stamp}.csv`, csv([['codigo', 'tipo', 'fecha', 'presentes/asistentes/beneficiarios', 'faltas', 'tardanzas', 'medio_dia', 'responsable', 'creado', 'sincronizado'],
      ...r.map(x => [x.id, x.tipo, x.fecha, x.tipo === 'RA' ? x.presentes.length : x.tipo === 'CH' ? x.asistentes.length : Object.values(x.dias).map(a => a.length).join('/'), x.tipo === 'RA' ? x.faltas.length : '', x.tipo === 'RA' ? x.tardanzas || 0 : '', x.tipo === 'RA' ? x.medioDia || 0 : '', x.responsable, x.creado, x.sync ? 'sí' : 'no']),
      ...nl.map(x => ['NO LABORABLE', 'NL', x.fecha, '', '', '', '', `${x.motivo}${x.detalle ? ': ' + x.detalle : ''}`, x.creado, x.sync ? 'sí' : 'no'])]), 'text/csv');
  };
  $('#eE').onclick = async () => { const e = await DB.all('entregas'); descargar(`entregas_${stamp}.csv`, csv([['semana', 'fecha_entrega', 'documentos', 'folios', 'resultado', 'motivo', 'documentos_observados', 'fecha_respuesta'], ...e.map(x => [x.semana, x.fechaEntrega, x.documentos, x.folios, x.resultado || 'en revisión', x.motivo, x.observados, x.fechaRespuesta || ''])]), 'text/csv'); };
  $('#eV').onclick = async () => { const e = await DB.all('eventos'); descargar(`eventos_${stamp}.csv`, csv([['momento', 'tipo', 'detalle'], ...e.map(x => [x.t, x.tipo, JSON.stringify(x.detalle)])]), 'text/csv'); };
  $('#eS').onclick = async () => {
    const nombre = `respaldo_registraobra_${stamp}.json`, txt = JSON.stringify(await DB.dump());
    let file = null; try { file = new File([txt], nombre, { type: 'application/json' }); } catch (_) { }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Respaldo RegistraObra', text: `Respaldo de RegistraObra · ${CFG.corto} · ${dmy(today())}` }); await logEvent('respaldo_compartido', { bytes: txt.length }); toast('Respaldo compartido.'); }
      catch (err) { if (err.name !== 'AbortError') { descargar(nombre, txt, 'application/json'); toast('No se pudo compartir: se descargó el archivo.'); } }
    } else { descargar(nombre, txt, 'application/json'); await logEvent('respaldo_descargado', { bytes: txt.length }); toast('Este navegador no permite compartir archivos: se descargó el respaldo.'); }
  };
  $('#eJ').onclick = async () => { descargar(`respaldo_registraobra_${stamp}.json`, JSON.stringify(await DB.dump(), null, 1), 'application/json'); };
  $('#fJ').onchange = async e => {
    try { const data = JSON.parse(await e.target.files[0].text()); await DB.restore(data); await loadCfg(); await loadNolab(); toast('Respaldo restaurado.'); refreshPending(); }
    catch (err) { $('#msg').innerHTML = `<p class="msg err">Archivo no válido: ${esc(err.message)}</p>`; }
  };
};

/* ---------- Configuración */
async function hashPin(p) {
  if (crypto?.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ro:' + p)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  let h = 0; for (const c of 'ro:' + p) h = (h * 31 + c.charCodeAt(0)) | 0; return 'x' + h;
}
VIEWS.config = async () => {
  const f = (k, l, ph = '') => `<label>${l}</label><input data-k="${k}" value="${esc(CFG[k])}" placeholder="${esc(ph)}">`;
  $('#view').innerHTML = `
  <div class="card"><h2>CONFIGURACIÓN</h2>
    <h3>Proyecto</h3>${f('proyecto', 'Nombre del proyecto')}${f('corto', 'Nombre corto')}
    <div class="row2"><div>${f('cui', 'CUI')}</div><div>${f('convenio', 'Convenio N.°')}</div></div>
    <div class="row2"><div>${f('codProyecto', 'Código de proyecto')}</div><div>${f('infobras', 'Cód. INFOBRAS')}</div></div>
    ${f('lugar', 'Lugar (para las actas)')}
    <h3>Responsables (aparecen en las firmas)</h3>
    ${f('residente', 'Ingeniero residente', 'Ing. ...')}${f('ssoma', 'Ingeniero SSOMA', 'Ing. ...')}${f('supervisor', 'Supervisor de obra', 'Ing. ...')}
    ${f('asistencia', 'Responsable de asistencia')}${f('representante', 'Representante del programa')}
    <h3>Jornada</h3>
    <div class="row2"><div>${f('horaIngreso', 'Hora de ingreso')}</div><div>${f('horaSalida', 'Hora de salida')}</div></div>
    <div class="row2"><div><label>Charlas SSOMA por semana</label><input data-k="charlasSemana" type="number" min="0" max="6" value="${CFG.charlasSemana}"></div>
    <div><label>¿Se trabaja sábados?</label><select data-k="sabados"><option value="false">No</option><option value="true" ${CFG.sabados ? 'selected' : ''}>Sí</option></select></div></div>
    <h3>Informes SSOMA</h3>
    <div class="row2"><div>${f('siglasInforme', 'Siglas del N.° de informe', 'SSOMA/DGQA/MDSJ')}</div><div>${f('ciudad', 'Ciudad (para la fecha)', 'San Juan')}</div></div>
    <div class="row2"><div><label>Inicio de obra (semana N.° 1)</label><input data-k="inicioObra" type="date" value="${esc(CFG.inicioObra)}"></div><div><label>Horas diarias trabajadas</label><input data-k="horasDia" type="number" min="1" max="12" value="${CFG.horasDia}"></div></div>
    <h3>Sincronización</h3>
    ${f('syncUrl', 'URL del Apps Script (Google Sheets)', 'https://script.google.com/macros/s/.../exec')}
    <p class="hint">Si no hay URL, todo queda guardado en el celular y puede exportarse desde "Datos y respaldo".</p>
    <h3>Clave de acceso</h3>
    <input id="pin" type="password" inputmode="numeric" maxlength="6" placeholder="${CFG.pinHash ? 'Clave activa · escriba una nueva para cambiarla' : 'Recomendado: 4 dígitos (máximo 6)'}">
    <p class="hint">La clave se pide cada vez que se abre la app y protege los datos personales de los participantes (Ley N.° 29733).</p>
    <div id="err"></div>
    <button class="btn primary" id="save">GUARDAR CONFIGURACIÓN</button>
    ${CFG.pinHash ? '<button class="btn danger" id="nopin" style="width:100%;margin-top:8px">Quitar clave</button>' : ''}
  </div>`;
  $('#save').onclick = async () => {
    $$('[data-k]').forEach(i => { const k = i.dataset.k; let v = i.value.trim(); if (k === 'charlasSemana') v = +v || 0; if (k === 'horasDia') v = +v || 8; if (k === 'sabados') v = v === 'true'; CFG[k] = v; });
    const pin = $('#pin').value.trim();
    if (pin) { if (!/^\d{4,6}$/.test(pin)) { showErrors($('#err'), ['La clave debe tener de 4 a 6 dígitos.']); return; } CFG.pinHash = await hashPin(pin); }
    await saveCfg(); $('#subtitle').textContent = `${CFG.corto} · ${dayLabel(today())}`; toast('Configuración guardada.'); render();
  };
  if ($('#nopin')) $('#nopin').onclick = async () => { CFG.pinHash = ''; await saveCfg(); toast('Clave eliminada.'); render(); };
};


/* ------------------------------------------------------------------ INICIO (resumen del día y de la semana) */
VIEWS.inicio = async () => {
  const hoy = today(), lun = monday(hoy), lab = diasTrabajo(lun).filter(d => d <= hoy);
  const all = await registros(); const ps = await participantes(); const fotos = await DB.all('fotos');
  const ra = all.find(r => r.tipo === 'RA' && r.fecha === hoy);
  const chHoy = all.filter(r => r.tipo === 'CH' && r.fecha === hoy);
  const aa = all.find(r => r.tipo === 'AA' && r.semana === lun);
  const aguaHoy = aa?.dias?.[hoy]?.length || 0;
  const raSem = all.filter(r => r.tipo === 'RA' && r.fecha >= lun && r.fecha <= addDays(lun, 6)).length;
  const chSem = all.filter(r => r.tipo === 'CH' && r.fecha >= lun && r.fecha <= addDays(lun, 6)).length;
  const aaSem = aa ? Object.values(aa.dias).filter(x => x.length).length : 0;
  const rev = await revisarSemana(lun);
  const h = new Date().getHours(); const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const laborable = !validarFecha(hoy).length;
  const sn = semanaN(lun);
  const tarea = (cls, ico, titulo, ok, detalle, ruta) => `<button class="task ${cls} ${ok ? 'done' : ''}" data-r="${ruta}">
      <span class="tk-ic">${document.querySelector('.nv-' + ico + ' .ic').innerHTML}</span>
      <span class="tk-tx"><b>${titulo}</b><small>${detalle}</small></span><span class="tk-st">${ok ? '✓' : '›'}</span></button>`;
  const barra = (t, v, max, cls) => `<div class="bar-row"><span>${t}</span><div class="bar ${cls}"><i style="width:${max ? Math.min(100, v / max * 100) : 0}%"></i></div><b>${v}/${max}</b></div>`;
  $('#view').innerHTML = `
  <div class="hero">
    <div><small>${saludo}</small><h2>${esc(CFG.corto)}</h2><p>${DIAS[parse(hoy).getDay()].replace(/^./, c => c.toUpperCase())} ${dmy(hoy)}${sn ? ` · semana N.° ${pad(sn)} de obra` : ''}</p></div>
    <div class="hero-n"><b>${ps.length}</b><small>participantes</small></div>
  </div>
  ${!ps.length ? `<div class="card"><h3>Primer paso</h3><p>Cargue la lista de participantes para empezar.</p><button class="btn primary" data-r="participantes">Registrar participantes</button></div>` : ''}
  <div class="card"><h3>${laborable ? 'Tareas de hoy' : 'Hoy no es día laborable'}</h3>${NOLAB[hoy] ? `<div class="nlbox"><b>${esc(NOLAB[hoy].motivo)}</b><span>${esc(NOLAB[hoy].detalle || 'Día marcado como no laborable')}</span></div>` : feriadoNacional(hoy) ? `<div class="ferbox">📅 Hoy es feriado nacional (${esc(feriadoNacional(hoy))}). Si no se trabaja, márquelo en Asistencia.</div>` : ''}
    ${laborable ? `<div class="tasks">
      ${tarea('m-asis', 'asistencia', 'Asistencia', !!ra, ra ? `${ra.id} · ${ra.presentes.length} presentes · ${ra.faltas.length} falta${ra.faltas.length === 1 ? '' : 's'}` : 'Pendiente de registrar', 'asistencia')}
      ${tarea('m-ssoma', 'ssoma', 'Charla de seguridad', chHoy.length > 0, chHoy.length ? `${chHoy.map(c => c.id).join(', ')} · ${esc(chHoy[0].temas[0])}` : 'Sin charla registrada hoy', 'ssoma')}
      ${tarea('m-agua', 'agua', 'Entrega de agua', aguaHoy > 0, aguaHoy ? `${aguaHoy} beneficiarios · ${aa.id}` : 'Pendiente de registrar', 'agua')}
    </div>` : '<p class="hint">Revise el avance de la semana o genere sus informes.</p>'}
  </div>
  <div class="card"><h3>Avance de la semana</h3>
    ${barra('Asistencia', raSem, diasTrabajo(lun).length, 'm-asis')}
    ${barra('Charlas SSOMA', chSem, CFG.charlasSemana, 'm-ssoma')}
    ${barra('Entrega de agua', aaSem, diasTrabajo(lun).length, 'm-agua')}
    <button class="task m-exp ${rev.errores ? '' : 'done'}" data-r="expediente" style="margin-top:12px">
      <span class="tk-ic">${document.querySelector('.nv-expediente .ic').innerHTML}</span>
      <span class="tk-tx"><b>Expediente semanal</b><small>${rev.errores ? `${rev.errores} control(es) pendiente(s) antes de generar` : 'Listo para generar el expediente foliado'}</small></span><span class="tk-st">${rev.errores ? rev.errores : '✓'}</span></button>
  </div>
  <div class="card quick">
    <button class="qbtn" data-r="informes"><b>Informes SSOMA</b><small>Semanal, mensual y panel</small></button>
    <button class="qbtn" data-r="tiempos"><b>Tiempos</b><small>Cronómetro e indicadores</small></button>
    <button class="qbtn" data-r="datos"><b>${fotos.length}</b><small>fotos guardadas</small></button>
  </div>`;
  $('#view').onclick = e => { const b = e.target.closest('[data-r]'); if (b) go(b.dataset.r); };
};
/* ------------------------------------------------------------------ INFORMES AUTOMÁTICOS (v1.1) */
const fechaLarga = s => { const d = parse(s); return `${pad(d.getDate())} de ${MESES[d.getMonth()]} del ${d.getFullYear()}`; };
const semanaN = lun => CFG.inicioObra ? Math.floor((parse(lun) - parse(monday(CFG.inicioObra))) / 604800000) + 1 : null;
const refProyecto = () => `Proyecto de Inversión denominado: "${esc(CFG.proyecto)}" con CUI N.° ${esc(CFG.cui)}, CÓDIGO DE PROYECTO N.° ${esc(CFG.codProyecto)}, COD. INFOBRAS N.° ${esc(CFG.infobras)}.`;
function memo({ numero, asunto, referencia, fecha, deCargo = 'Responsable de SSOMA' }) {
  return `<p class="memo-n">INFORME N.° ${esc(numero)}</p>
  <table class="memo">
    <tr><td class="k">A</td><td>:</td><td><b>${esc((CFG.residente || 'Ing. ______________').toUpperCase())}</b><br>Residente de Obra</td></tr>
    <tr><td class="k">DE</td><td>:</td><td><b>${esc((CFG.ssoma || 'Ing. ______________').toUpperCase())}</b><br>${deCargo}</td></tr>
    <tr><td class="k">ASUNTO</td><td>:</td><td><b>${esc(asunto)}</b></td></tr>
    <tr><td class="k">REFERENCIA</td><td>:</td><td>${referencia}</td></tr>
    <tr><td class="k">FECHA</td><td>:</td><td>${esc(CFG.ciudad)}, ${fechaLarga(fecha)}</td></tr>
  </table><hr class="memo-hr">`;
}
const firmaSSOMA = () => `<div class="firma1"><div>${esc(CFG.ssoma || 'Ing. ______________')}<br>Responsable de SSOMA</div></div>`;
const numInforme = n => `${pad(n, 3)}-${new Date().getFullYear()}/${CFG.siglasInforme}`;

async function panelFotografico(desde, hasta, tipos) {
  const fotos = (await DB.all('fotos')).filter(f => f.fecha >= desde && f.fecha <= hasta && tipos.includes(f.tipo)).sort((a, b) => (a.fecha + a.t).localeCompare(b.fecha + b.t));
  const grupos = {};
  fotos.forEach(f => (grupos[f.ref] = grupos[f.ref] || []).push(f));
  const pages = [];
  for (const ref of Object.keys(grupos).sort((a, b) => grupos[a][0].fecha.localeCompare(grupos[b][0].fecha))) {
    const g = grupos[ref]; const f0 = g[0];
    const titulo = f0.tipo === 'CH' ? `PANEL FOTOGRÁFICO CHARLA ${dmy(f0.fecha)}` : `PANEL FOTOGRÁFICO ENTREGA DE AGUA ${dmy(f0.fecha)}`;
    for (let i = 0; i < g.length; i += 4) {
      const parte = g.slice(i, i + 4);
      pages.push(`<section class="sheet"><div class="prog">${esc(CFG.corto)} · CUI N.° ${esc(CFG.cui)} · Convenio N.° ${esc(CFG.convenio)}</div>
        <h1>${titulo}${g.length > 4 ? ` (${Math.floor(i / 4) + 1}/${Math.ceil(g.length / 4)})` : ''}</h1>
        ${f0.tipo === 'CH' ? `<p style="text-align:center"><b>Tema:</b> ${esc(f0.titulo || '')}</p>` : ''}
        <div class="panel">${parte.map((f, k) => `<figure><img src="${f.data}"><figcaption>Foto ${i + k + 1}. ${dmy(f.fecha)} ${new Date(f.t).toTimeString().slice(0, 5)}${f.loc ? ` · GPS ${f.loc.lat}, ${f.loc.lon}` : ''}</figcaption></figure>`).join('')}</div></section>`);
    }
  }
  return { html: pages.join(''), n: fotos.length, paginas: pages.length };
}

async function informeSemanal(lun, numero, fecha) {
  const fin = laborables(lun).slice(-1)[0];
  const ch = (await registros('CH')).filter(r => r.fecha >= lun && r.fecha <= fin).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const sn = semanaN(lun); const semTxt = `SEMANA N.° ${sn ? pad(sn) : '__'}`;
  const rango = `(${dm(lun)} al ${dmy(fin)})`;
  const panel = await panelFotografico(lun, fin, ['CH']);
  const asunto = `REMISIÓN DE ACTAS DE CHARLA DE SEGURIDAD - ${semTxt}`;
  const carta = `<section class="sheet">${memo({ numero, asunto, referencia: `Convenio N.° ${esc(CFG.convenio)}<br>${refProyecto()}`, fecha })}
    <p>Me dirijo a usted para saludarlo y, en mi calidad de responsable de SSOMA, remitir los documentos de las ACTAS DE CHARLA DE SEGURIDAD - ${semTxt}, del ${refProyecto().replace(/\.$/, '')}, en el marco del Convenio N.° ${esc(CFG.convenio)}.</p>
    <p>En este sentido, se adjuntan los siguientes documentos:</p>
    <ul><li>ACTAS DE CHARLA DE SEGURIDAD DE LA ${semTxt} ${rango}: ${ch.length ? ch.map(c => c.id).join(', ') : 'ninguna registrada'} (${ch.length} acta${ch.length === 1 ? '' : 's'}).</li>
    ${panel.n ? `<li>PANEL FOTOGRÁFICO DE LAS CHARLAS DE SEGURIDAD DE LA ${semTxt} ${rango} (${panel.n} fotografías).</li>` : ''}</ul>
    <table class="mini-p"><tr><th>Código</th><th>Fecha</th><th>Hora</th><th>Tema</th><th>Asistentes</th></tr>
    ${ch.map(c => `<tr><td>${c.id}</td><td>${dmy(c.fecha)}</td><td>${c.hora}</td><td>${esc(c.temas.filter(Boolean).join('; '))}</td><td style="text-align:center">${c.asistentes.length}</td></tr>`).join('')}</table>
    <p>Es todo lo que informo para su conocimiento.</p>
    <p>Se recomienda realizar la derivación y/o trasladar el presente informe a quien corresponda para los fines correspondientes.</p>
    <p>Atentamente,</p>${firmaSSOMA()}</section>`;
  let actas = '';
  if (ch.length) actas = (await construirExpediente(lun, { ra: [], ch, aa: null, checks: [] }, { sinIndice: true, folioInicial: 1 })).html;
  return { html: carta + actas + panel.html, resumen: `${ch.length} actas · ${panel.n} fotos` };
}

const OBJETIVOS = ['Cumplir con todos los requisitos legales aplicables y con otros requisitos que la organización suscriba relacionados con la prevención de riesgos laborales y los aspectos ambientales.',
  'Integrar la seguridad y el compromiso de protección ambiental en todos los niveles de la obra.',
  'Utilizar eficientemente los recursos y emplear prácticas que garanticen la prevención de la contaminación y el respeto al medio ambiente.',
  'Establecer y revisar periódicamente objetivos de salud laboral y medio ambiente acordes con el Plan de Seguridad y Salud en el Trabajo.'];
const ACT_BASE = `Se verificó que el personal use de manera obligatoria sus equipos de protección personal (EPP): casco, calzado de seguridad, lentes, guantes, entre otros.
Se verificó la correcta instalación de la señalización colectiva en la obra.
Se verificó que las partidas ejecutadas en el periodo se realizaran con el EPP adecuado, de forma segura y sin incidentes ni accidentes.
Se mantuvieron las estaciones de acopio de residuos sólidos en condiciones operativas.
Se desarrollaron las charlas diarias de seguridad de 10 minutos con el personal de obra.`;

async function informeMensual(o) {
  const ra = (await registros('RA')).filter(r => r.fecha >= o.desde && r.fecha <= o.hasta);
  const ch = (await registros('CH')).filter(r => r.fecha >= o.desde && r.fecha <= o.hasta).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const aa = (await registros('AA'));
  const presentes = sum(ra.map(r => r.presentes.length)), faltas = sum(ra.map(r => r.faltas.length));
  const nPart = (await participantes()).length || Math.max(0, ...ra.map(r => r.presentes.length + r.faltas.length));
  const medio = sum(ra.map(r => r.medioDia || 0));
  const HH = (presentes - medio / 2) * CFG.horasDia;
  const aus = presentes + faltas ? faltas / (presentes + faltas) * 100 : 0;
  const IF = HH ? o.accidentes * 200000 / HH : 0, IS = HH ? o.diasPerdidos * 200000 / HH : 0, IA = IF * IS / 200;
  let diasAgua = 0, litros = 0;
  aa.forEach(a => Object.entries(a.dias).forEach(([d, ids]) => { if (d >= o.desde && d <= o.hasta && ids.length) { diasAgua++; litros += ids.length * (a.litros || 1); } }));
  const n2 = x => x.toFixed(2).replace('.', ',');
  const periodo = `del ${fechaLarga(o.desde)} al ${fechaLarga(o.hasta)}`;
  const temas = [...new Set(ch.flatMap(c => c.temas.filter(Boolean)))];
  const panel = o.panel ? await panelFotografico(o.desde, o.hasta, ['CH', 'AA']) : { html: '', n: 0 };
  const concl = [
    `Se desarrollaron ${ch.length} charlas de seguridad en el periodo, con un promedio de ${ch.length ? Math.round(sum(ch.map(c => c.asistentes.length)) / ch.length) : 0} asistentes por charla, sobre ${temas.length} temas distintos.`,
    `Se registraron ${ra.length} días laborados y ${String(HH)} horas-hombre trabajadas, con un ausentismo de ${n2(aus)} %.`,
    `Se entregó agua para consumo humano durante ${diasAgua} días, con un total de ${String(litros)} litros.`,
    `Se cierra el periodo con ${o.accidentes} accidente(s) de trabajo y ${o.incidentes} incidente(s) peligroso(s); índice de frecuencia ${n2(IF)} e índice de severidad ${n2(IS)}.`,
    ...o.conclusiones.split('\n').map(x => x.trim()).filter(Boolean)];
  const html = `<section class="sheet sheet-flow">${memo({ numero: o.numero, asunto: 'INFORME DE SSOMA', referencia: refProyecto(), fecha: o.fecha, deCargo: 'Especialista SSOMA' })}
    <p>Mediante el presente me dirijo a usted a fin de saludarlo muy cordialmente y presentarle el informe de SSOMA correspondiente a las actividades ${periodo}, de la ejecución de la obra "${esc(CFG.proyecto)}" con CUI N.° ${esc(CFG.cui)}.</p>
    <h2>OBJETIVOS</h2><ul>${OBJETIVOS.map(x => `<li>${x}</li>`).join('')}</ul>
    <h2>I. ACTIVIDADES REALIZADAS ${periodo.toUpperCase()}</h2>
    <ul>${o.actividades.split('\n').map(x => x.trim()).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h2>Charlas de seguridad realizadas</h2>
    <table class="mini-p"><tr><th>N.°</th><th>Código</th><th>Fecha</th><th>Tema(s)</th><th>Asistentes</th></tr>
    ${ch.map((c, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${c.id}</td><td>${dmy(c.fecha)}</td><td>${esc(c.temas.filter(Boolean).join('; '))}</td><td style="text-align:center">${c.asistentes.length}</td></tr>`).join('') || '<tr><td colspan="5">Sin charlas registradas en el periodo.</td></tr>'}</table>
    <h2>Estadísticas de SST</h2>
    <table class="mini-p"><tr><th>Indicador</th><th>Valor</th></tr>
      <tr><td>Número de participantes</td><td>${nPart}</td></tr>
      <tr><td>N.° de días laborados en el periodo</td><td>${ra.length}</td></tr>
      <tr><td>N.° de horas diarias trabajadas</td><td>${CFG.horasDia}</td></tr>
      <tr><td>Jornadas trabajadas (asistencias registradas)</td><td>${presentes}</td></tr>
      <tr><td>Faltas registradas / porcentaje de ausentismo</td><td>${faltas} / ${n2(aus)} %</td></tr>
      <tr><td><b>Total de horas-hombre trabajadas</b></td><td><b>${String(HH)} HH</b></td></tr>
      <tr><td>Atenciones médicas comunes / ocupacionales</td><td>${o.atenComunes} / ${o.atenOcup}</td></tr>
      <tr><td>Incidentes / accidentes</td><td>${o.incidentes} / ${o.accidentes}</td></tr>
      <tr><td>Días perdidos</td><td>${o.diasPerdidos}</td></tr>
      <tr><td>Índice de frecuencia = accidentes × 200 000 / HH</td><td>${n2(IF)}</td></tr>
      <tr><td>Índice de severidad = días perdidos × 200 000 / HH</td><td>${n2(IS)}</td></tr>
      <tr><td>Índice de accidentabilidad = IF × IS / 200</td><td>${n2(IA)}</td></tr>
      <tr><td>Días con entrega de agua / litros entregados</td><td>${diasAgua} / ${String(litros)} L</td></tr></table>
    <p class="hint-p">Las horas-hombre, los días laborados, el ausentismo, las charlas y la entrega de agua se calcularon automáticamente con los registros de RegistraObra.</p>
    <h2>II. CONCLUSIONES</h2><ul>${concl.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <p>Sin otro en particular, aprovecho la oportunidad para reiterarle mi más distinguida consideración y estima personal.</p>
    <p>Atentamente,</p>${firmaSSOMA()}${panel.n ? '<p>Se adjuntan fotografías.</p>' : ''}</section>`;
  return { html: html + panel.html, resumen: `${ra.length} días · ${HH} HH · ${ch.length} charlas · ${panel.n} fotos`, HH, aus, dias: ra.length };
}

VIEWS.informes = async (lunArg) => {
  const lun = lunArg || monday(today());
  const hoy = today();
  const d0 = hoy.slice(0, 8) + '01';
  const fotos = await DB.all('fotos');
  $('#view').innerHTML = `
  <div class="card"><h2>INFORMES AUTOMÁTICOS</h2>
    <p class="hint">Los informes se arman con los registros guardados en la app. Revise la vista previa y luego imprima o guarde en PDF. Fotos guardadas en la app: <b>${fotos.length}</b>.</p></div>
  <div class="card"><h3>1. Remisión semanal de actas de charla (SSOMA)</h3>
    <div class="row2"><div><label>Semana (elija un día)</label><input type="date" id="sSem" value="${lun}"></div><div><label>N.° de informe</label><input type="number" id="sNum" min="1" value="${CFG.informeNum}"></div></div>
    <label>Fecha del informe</label><input type="date" id="sFec" value="${hoy}">
    <button class="btn primary" id="gSem">GENERAR INFORME SEMANAL</button>
    <p class="hint">Incluye el memorando, las actas de charla de la semana y su panel fotográfico.</p></div>
  <div class="card"><h3>2. Panel fotográfico</h3>
    <div class="row2"><div><label>Desde</label><input type="date" id="pDes" value="${lun}"></div><div><label>Hasta</label><input type="date" id="pHas" value="${addDays(lun, 6)}"></div></div>
    <label>Fotos de</label><select id="pTip"><option value="CH">Charlas de seguridad</option><option value="AA">Entrega de agua</option><option value="CH,AA">Ambas</option></select>
    <button class="btn primary" id="gPan">GENERAR PANEL FOTOGRÁFICO</button></div>
  <div class="card"><h3>3. Informe mensual de SSOMA</h3>
    <div class="row2"><div><label>Desde</label><input type="date" id="mDes" value="${d0}"></div><div><label>Hasta</label><input type="date" id="mHas" value="${hoy}"></div></div>
    <div class="row2"><div><label>N.° de informe</label><input type="number" id="mNum" min="1" value="${CFG.informeNum}"></div><div><label>Fecha del informe</label><input type="date" id="mFec" value="${hoy}"></div></div>
    <div class="row2"><div><label>Accidentes</label><input type="number" id="mAcc" min="0" value="0"></div><div><label>Incidentes</label><input type="number" id="mInc" min="0" value="0"></div></div>
    <div class="row2"><div><label>Días perdidos</label><input type="number" id="mDp" min="0" value="0"></div><div><label>Atenciones médicas comunes / ocupacionales</label><div class="row2"><input type="number" id="mAc" min="0" value="0"><input type="number" id="mAo" min="0" value="0"></div></div></div>
    <label>Actividades realizadas (una por línea)</label><textarea id="mAct" rows="6">${ACT_BASE}</textarea>
    <label>Conclusiones adicionales (opcional, una por línea)</label><textarea id="mCon" rows="3">Se garantizó el cumplimiento de la Norma Técnica G.050 Seguridad durante la Construcción.</textarea>
    <label class="chk"><input type="checkbox" id="mPan" checked> Adjuntar panel fotográfico del periodo</label>
    <div id="err"></div>
    <button class="btn primary" id="gMes">GENERAR INFORME MENSUAL</button>
    <p class="hint">Las horas-hombre, días laborados, ausentismo, charlas, temas, agua e índices se calculan solos.</p></div>
  <div id="prev"></div>`;
  const mostrar = async (res, nombre) => {
    $('#printArea').innerHTML = res.html;
    $('#prev').innerHTML = `<div class="card"><h3>${nombre}</h3><p class="hint">${res.resumen}</p>
      <button class="btn primary" id="print">IMPRIMIR / GUARDAR PDF</button></div><div class="screen-preview">${res.html}</div>`;
    $('#print').onclick = () => window.print();
    await logEvent('informe', { tipo: nombre, resumen: res.resumen });
    $('#prev').scrollIntoView({ behavior: 'smooth' });
  };
  const subirNum = async n => { if (n >= CFG.informeNum) { CFG.informeNum = n + 1; await saveCfg(); } };
  $('#gSem').onclick = async () => { const n = +$('#sNum').value || 1; await mostrar(await informeSemanal(monday($('#sSem').value), numInforme(n), $('#sFec').value), 'Informe semanal de remisión'); await subirNum(n); };
  $('#gPan').onclick = async () => {
    const r = await panelFotografico($('#pDes').value, $('#pHas').value, $('#pTip').value.split(','));
    if (!r.n) { toast('No hay fotos en ese periodo. Tómelas desde SSOMA o Agua.'); return; }
    await mostrar({ html: r.html, resumen: `${r.n} fotos en ${r.paginas} hoja(s)` }, 'Panel fotográfico');
  };
  $('#gMes').onclick = async () => {
    const o = { desde: $('#mDes').value, hasta: $('#mHas').value, fecha: $('#mFec').value, numero: numInforme(+$('#mNum').value || 1),
      accidentes: +$('#mAcc').value || 0, incidentes: +$('#mInc').value || 0, diasPerdidos: +$('#mDp').value || 0, atenComunes: +$('#mAc').value || 0, atenOcup: +$('#mAo').value || 0,
      actividades: $('#mAct').value, conclusiones: $('#mCon').value, panel: $('#mPan').checked };
    const errs = [];
    if (!o.desde || !o.hasta || o.desde > o.hasta) errs.push('Revise el periodo: la fecha inicial debe ser anterior a la final.');
    showErrors($('#err'), errs); if (errs.length) return;
    await mostrar(await informeMensual(o), 'Informe mensual de SSOMA'); await subirNum(+$('#mNum').value || 1);
  };
};

/* ------------------------------------------------------------------ inicio */
async function unlock() {
  if (!CFG.pinHash || sessionStorage.getItem('ro_ok') === '1') return;
  $('#lock').classList.remove('hidden');
  await new Promise(res => {
    const tryIt = async () => {
      if (await hashPin($('#lockPin').value) === CFG.pinHash) { try { sessionStorage.setItem('ro_ok', '1'); } catch (_) { } $('#lock').classList.add('hidden'); res(); }
      else { $('#lockMsg').textContent = 'Clave incorrecta.'; $('#lockPin').value = ''; }
    };
    $('#lockBtn').onclick = tryIt; $('#lockPin').onkeydown = e => { if (e.key === 'Enter') tryIt(); };
    $('#lockPin').oninput = async e => { const v = e.target.value; if (v.length >= 4 && await hashPin(v) === CFG.pinHash) tryIt(); };
    setTimeout(() => $('#lockPin').focus(), 100);
  });
}
(async function init() {
  await loadCfg();
  await loadNolab();
  await unlock();
  $('#subtitle').textContent = `${CFG.corto} · ${dayLabel(today())}`;
  updateNet(); refreshPending();
  /* Sincronización inteligente: al volver la señal (espera 3 s a que se estabilice), al volver a la app y cada minuto si hay pendientes */
  let tOn = null;
  const autoSync = async () => { if (!navigator.onLine || !CFG.syncUrl || syncing) return; const p = await pendientes(); if (Object.values(p).some(a => a.length)) syncNow(true); };
  window.addEventListener('online', () => { updateNet(); clearTimeout(tOn); tOn = setTimeout(autoSync, 3000); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });
  setInterval(autoSync, 60000);
  setTimeout(autoSync, 2000);
  window.addEventListener('offline', updateNet);
  window.addEventListener('hashchange', render);
  $$('nav.bottom button').forEach(b => b.onclick = () => go(b.dataset.go));
  $('#syncBtn').onclick = () => syncNow(false);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  render();
})();
