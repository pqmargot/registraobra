/* RegistraObra v1.0 — Gestión documental Offline-First (Proyecto Pampahuasi, CUI 2236116)
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
  horaIngreso: '08:00', horaSalida: '17:00', charlasSemana: 3, sabados: false, syncUrl: '', pinHash: ''
};
let CFG = { ...DEFAULTS };
async function loadCfg() { CFG = { ...DEFAULTS, ...(await DB.getConfig('cfg', {})) }; }
async function saveCfg() { await DB.setConfig('cfg', CFG); }

async function logEvent(tipo, detalle) { await DB.add('eventos', { t: new Date().toISOString(), fecha: today(), tipo, detalle, sync: false }); }

/* ------------------------------------------------------------------ datos */
async function participantes() { return (await DB.all('participantes')).filter(p => p.activo !== false).sort((a, b) => a.n - b.n); }
async function registros(tipo) { const all = await DB.all('registros'); return tipo ? all.filter(r => r.tipo === tipo) : all; }
async function nextCode(tipo, anio) {
  const nums = (await registros(tipo)).filter(r => r.anio === anio).map(r => r.numero);
  const n = nums.length ? Math.max(...nums) + 1 : 1;
  return { numero: n, id: `${tipo}-${anio}-${pad(n, 3)}` };
}
const snap = ps => ps.map(p => ({ id: p.id, n: p.n, nombres: p.nombres, dni: p.dni }));
async function markChanged() { await refreshPending(); if (navigator.onLine && CFG.syncUrl) syncNow(true); }

/* Validación de fecha común a todos los registros */
function validarFecha(f) {
  const e = [];
  if (!f) { e.push('La fecha es obligatoria.'); return e; }
  if (f > today()) e.push(`La fecha ${dmy(f)} es posterior a hoy (${dmy(today())}).`);
  const wd = parse(f).getDay();
  if (wd === 0) e.push(`El ${dmy(f)} es domingo: no es día laborable.`);
  if (wd === 6 && !CFG.sabados) e.push(`El ${dmy(f)} es sábado: no es día laborable (se puede habilitar en Configuración).`);
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
  for (const s of ['registros', 'tiempos', 'entregas']) out[s] = (await DB.all(s)).filter(x => !x.sync);
  return out;
}
async function refreshPending() {
  const p = await pendientes();
  const n = p.registros.length + p.tiempos.length + p.entregas.length;
  $('#pendingTxt').textContent = n === 0 ? 'Todo sincronizado' : `${n} registro${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} de sincronizar`;
}
let syncing = false;
async function syncNow(silent = false) {
  if (syncing) return;
  if (!navigator.onLine) { if (!silent) toast('Sin conexión: los datos siguen guardados en el celular.'); return; }
  if (!CFG.syncUrl) { if (!silent) toast('Configure la URL de sincronización en Más → Configuración.'); return; }
  const p = await pendientes();
  const total = p.registros.length + p.tiempos.length + p.entregas.length;
  if (!total) { if (!silent) toast('No hay registros pendientes.'); return; }
  syncing = true;
  try {
    const res = await fetch(CFG.syncUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ app: 'RegistraObra', version: '1.0', cui: CFG.cui, enviado: new Date().toISOString(), ...p })
    });
    let ok = res.ok, recibidos = null;
    try { const j = await res.json(); ok = ok && j.ok !== false; recibidos = j.recibidos ?? null; } catch (_) { /* respuesta sin JSON */ }
    if (!ok) throw new Error('HTTP ' + res.status);
    const at = new Date().toISOString();
    for (const s of ['registros', 'tiempos', 'entregas']) for (const x of p[s]) { x.sync = true; x.syncAt = at; await DB.put(s, x); }
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
  const [name, arg] = (location.hash.slice(1) || 'asistencia').split('/');
  $$('nav.bottom button').forEach(b => b.classList.toggle('active', b.dataset.go === name || (b.dataset.go === 'mas' && ['tiempos', 'participantes', 'config', 'mas', 'datos'].includes(name))));
  const v = VIEWS[name] || VIEWS.asistencia;
  $('#printArea').innerHTML = '';
  $('#view').onclick = null;
  clearInterval(timerInt);
  window.scrollTo(0, 0);
  await v(arg);
}

/* ------------------------------------------------------------------ ASISTENCIA */
VIEWS.asistencia = async (fechaArg) => {
  const ps = await participantes();
  const fecha = fechaArg || today();
  const all = await registros('RA');
  let rec = all.find(r => r.fecha === fecha);
  const code = rec ? { id: rec.id } : await nextCode('RA', parse(fecha).getFullYear());
  const faltas = new Set(rec ? rec.faltas : []);
  const view = $('#view');
  if (!ps.length) {
    view.innerHTML = `<div class="card"><h2>ASISTENCIA DEL DÍA</h2><p>Aún no hay participantes registrados en este celular.</p>
      <button class="btn primary" id="goP">Registrar participantes</button></div>`;
    $('#goP').onclick = () => go('participantes'); return;
  }
  view.innerHTML = `
  <div class="card">
    <h2>ASISTENCIA DEL DÍA</h2>
    <div class="meta"><span class="code">${esc(code.id)}</span><span>${rec ? 'Registro guardado · se puede corregir' : 'Nuevo registro'}</span></div>
    <label>Fecha</label><input type="date" id="fecha" value="${fecha}" max="${today()}">
    <div class="row2">
      <div><label>Hora de ingreso</label><input type="time" id="hi" value="${esc(rec?.horaIngreso || CFG.horaIngreso)}"></div>
      <div><label>Hora de salida</label><input type="time" id="hs" value="${esc(rec?.horaSalida || CFG.horaSalida)}"></div>
    </div>
    <label>Responsable de asistencia</label><input id="resp" value="${esc(rec?.responsable || CFG.asistencia)}" placeholder="Nombre del responsable">
    <div class="meta" style="margin-top:12px"><span class="pill ok" id="cP"></span><span class="pill bad" id="cF"></span></div>
    <p class="hint">Toque un número para marcar falta. Debajo se listan los nombres de quienes faltan.</p>
    <div class="grid-p" id="grid">${ps.map(p => `<button class="pbtn ${faltas.has(p.id) ? 'off' : ''}" data-id="${p.id}" title="${esc(p.nombres)}">P-${pad(p.n)}</button>`).join('')}</div>
    <div id="faltasList" class="hint"></div>
    <div id="err"></div>
    <button class="btn primary" id="save">${rec ? 'ACTUALIZAR ASISTENCIA' : 'GUARDAR ASISTENCIA'}</button>
    <p class="hint">La firma y huella de los participantes se mantienen en el formato impreso.</p>
  </div>
  <div class="card"><h3>Asistencias de la semana</h3><ul class="list" id="sem"></ul></div>`;
  const upd = () => {
    $('#cP').textContent = `${ps.length - faltas.size} presentes`; $('#cF').textContent = `${faltas.size} faltas`;
    const nf = ps.filter(p => faltas.has(p.id));
    $('#faltasList').innerHTML = nf.length ? 'Faltas: ' + nf.map(p => `P-${pad(p.n)} ${esc(p.nombres)}`).join(' · ') : '';
  };
  upd();
  $('#grid').onclick = e => {
    const b = e.target.closest('.pbtn'); if (!b) return;
    const id = +b.dataset.id; faltas.has(id) ? faltas.delete(id) : faltas.add(id);
    b.classList.toggle('off'); upd();
  };
  $('#fecha').onchange = e => go('asistencia/' + e.target.value);
  const lun = monday(fecha);
  const semRecs = all.filter(r => r.fecha >= lun && r.fecha <= addDays(lun, 6)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  $('#sem').innerHTML = semRecs.length ? semRecs.map(r => `<li><span><span class="code">${r.id}</span> ${dayLabel(r.fecha)}</span><span>${r.presentes.length} pres. · ${r.faltas.length} faltas</span></li>`).join('') : '<li>Sin registros esta semana.</li>';
  $('#save').onclick = async () => {
    const f = $('#fecha').value, hi = $('#hi').value, hs = $('#hs').value, resp = $('#resp').value.trim();
    const errs = validarFecha(f);
    if (!hi || !hs) errs.push('Las horas de ingreso y salida son obligatorias.');
    else if (hi >= hs) errs.push('La hora de salida debe ser posterior a la de ingreso.');
    if (!resp) errs.push('Indique el responsable de asistencia.');
    if (faltas.size >= ps.length) errs.push('Debe haber al menos un participante presente.');
    const dup = all.find(r => r.fecha === f && (!rec || r.id !== rec.id));
    if (dup) errs.push(`Ya existe la asistencia ${dup.id} para el ${dmy(f)}.`);
    showErrors($('#err'), errs);
    if (errs.length) { await logEvent('bloqueo', { modulo: 'asistencia', errores: errs }); return; }
    const c = rec ? { id: rec.id, numero: rec.numero } : await nextCode('RA', parse(f).getFullYear());
    const obj = {
      id: c.id, tipo: 'RA', numero: c.numero, anio: parse(f).getFullYear(), fecha: f, horaIngreso: hi, horaSalida: hs, responsable: resp,
      presentes: ps.filter(p => !faltas.has(p.id)).map(p => p.id), faltas: [...faltas], participantes: snap(ps),
      creado: rec?.creado || new Date().toISOString(), modificado: new Date().toISOString(), sync: false
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
  const ps = await participantes();
  const all = await registros('CH');
  const rec = editId ? all.find(r => r.id === editId) : null;
  const fecha = rec?.fecha || today();
  const code = rec ? { id: rec.id } : await nextCode('CH', parse(fecha).getFullYear());
  const view = $('#view');
  if (!ps.length) { view.innerHTML = `<div class="card"><h2>CHARLA DE SEGURIDAD</h2><p>Primero registre los participantes en Más → Participantes.</p></div>`; return; }
  const asis = new Set(rec ? rec.asistentes : []);
  view.innerHTML = `
  <div class="card">
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
    <h3>Asistentes</h3>
    <div class="btns"><button class="btn sec sm" id="fromRA">Tomar de la asistencia del día</button><button class="btn sec sm" id="todos">Todos</button><button class="btn sec sm" id="ninguno">Ninguno</button></div>
    <p class="hint" id="cnt"></p>
    <div id="lst">${ps.map(p => `<label class="chk"><input type="checkbox" value="${p.id}" ${asis.has(p.id) ? 'checked' : ''}>P-${pad(p.n)} ${esc(p.nombres)}</label>`).join('')}</div>
    <div id="err"></div>
    <button class="btn primary" id="save">${rec ? 'ACTUALIZAR CHARLA' : 'GUARDAR CHARLA'}</button>
  </div>
  <div class="card"><h3>Charlas de la semana</h3><ul class="list" id="sem"></ul></div>`;
  if (rec && rec.temas[0] && !TEMAS.includes(rec.temas[0])) { $('#t1').value = '__otro'; $('#t1o').classList.remove('hidden'); $('#t1o').value = rec.temas[0]; }
  $('#t1').onchange = e => $('#t1o').classList.toggle('hidden', e.target.value !== '__otro');
  const cnt = () => $('#cnt').textContent = `${$$('#lst input:checked').length} asistentes seleccionados`;
  $('#lst').onchange = cnt; cnt();
  const setAll = v => { $$('#lst input').forEach(i => i.checked = v); cnt(); };
  $('#todos').onclick = () => setAll(true); $('#ninguno').onclick = () => setAll(false);
  $('#fromRA').onclick = async () => {
    const ra = (await registros('RA')).find(r => r.fecha === $('#fecha').value);
    if (!ra) { toast('No hay asistencia registrada para esa fecha.'); return; }
    const pr = new Set(ra.presentes); $$('#lst input').forEach(i => i.checked = pr.has(+i.value)); cnt();
    toast(`Se marcaron ${ra.presentes.length} presentes de ${ra.id}.`);
  };
  const lun = monday(fecha);
  const sem = all.filter(r => r.fecha >= lun && r.fecha <= addDays(lun, 6)).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  $('#sem').innerHTML = sem.length ? sem.map(r => `<li><span><span class="code">${r.id}</span> ${dayLabel(r.fecha)}<br><small>${esc(r.temas[0])}</small></span><button class="btn sec sm" data-e="${r.id}">Editar</button></li>`).join('') : '<li>Sin charlas esta semana.</li>';
  $('#sem').onclick = e => { const b = e.target.closest('[data-e]'); if (b) go('ssoma/' + b.dataset.e); };
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
    if (!CFG.ssoma) { CFG.ssoma = resp; await saveCfg(); }
    await logEvent(rec ? 'edicion' : 'registro', { id: obj.id });
    toast(`Charla ${obj.id} guardada en el celular.`);
    await markChanged(); go('ssoma');
  };
};

/* ------------------------------------------------------------------ ACTA DE AGUA (semanal, se marca día a día) */
VIEWS.agua = async (fechaArg) => {
  const ps = await participantes();
  const view = $('#view');
  if (!ps.length) { view.innerHTML = `<div class="card"><h2>ACTA DE ENTREGA DE AGUA</h2><p>Primero registre los participantes en Más → Participantes.</p></div>`; return; }
  const dia = fechaArg || today();
  const lun = monday(dia);
  const dias = laborables(lun);
  const all = await registros('AA');
  const rec = all.find(r => r.semana === lun);
  const code = rec ? { id: rec.id } : await nextCode('AA', parse(lun).getFullYear());
  const marcados = new Set(rec?.dias?.[dia] || []);
  view.innerHTML = `
  <div class="card">
    <h2>ACTA DE ENTREGA DE AGUA</h2>
    <div class="meta"><span class="code">${esc(code.id)}</span><span>Semana del ${dmy(lun)} al ${dmy(dias[dias.length - 1])}</span></div>
    <div style="margin-top:10px">${dias.map(d => `<span class="daytag ${rec?.dias?.[d]?.length ? 'on' : ''}" title="${dmy(d)}">${DIAS_C[parse(d).getDay()][0].toUpperCase()}</span>`).join('')}</div>
    <label>Día de entrega</label><input type="date" id="dia" value="${dia}" max="${today()}">
    <div class="row2">
      <div><label>Litros por persona</label><input type="number" id="lit" min="0.5" step="0.5" value="${esc(rec?.litros || 1)}"></div>
      <div><label>Responsable</label><input id="resp" value="${esc(rec?.responsable || CFG.residente)}" placeholder="Ing. residente"></div>
    </div>
    <div class="btns"><button class="btn sec sm" id="fromRA">Marcar presentes del día</button><button class="btn sec sm" id="todos">Todos</button><button class="btn sec sm" id="ninguno">Ninguno</button></div>
    <p class="hint" id="cnt"></p>
    <div class="grid-p" id="grid">${ps.map(p => `<button class="pbtn ${marcados.has(p.id) ? '' : 'off'}" data-id="${p.id}" title="${esc(p.nombres)}">P-${pad(p.n)}</button>`).join('')}</div>
    <div id="err"></div>
    <button class="btn primary" id="save">GUARDAR ENTREGA DEL DÍA</button>
    <p class="hint">Verde = recibió agua. El acta semanal se imprime con una columna por día para la firma de cada participante.</p>
  </div>`;
  const cnt = () => $('#cnt').textContent = `${marcados.size} beneficiarios marcados para el ${dayLabel($('#dia').value)}`;
  cnt();
  const paint = () => { $$('#grid .pbtn').forEach(b => b.classList.toggle('off', !marcados.has(+b.dataset.id))); cnt(); };
  $('#grid').onclick = e => { const b = e.target.closest('.pbtn'); if (!b) return; const id = +b.dataset.id; marcados.has(id) ? marcados.delete(id) : marcados.add(id); paint(); };
  $('#todos').onclick = () => { ps.forEach(p => marcados.add(p.id)); paint(); };
  $('#ninguno').onclick = () => { marcados.clear(); paint(); };
  $('#fromRA').onclick = async () => {
    const ra = (await registros('RA')).find(r => r.fecha === $('#dia').value);
    if (!ra) { toast('No hay asistencia registrada para ese día.'); return; }
    marcados.clear(); ra.presentes.forEach(id => marcados.add(id)); paint();
  };
  $('#dia').onchange = e => go('agua/' + e.target.value);
  $('#save').onclick = async () => {
    const d = $('#dia').value, lit = +$('#lit').value, resp = $('#resp').value.trim();
    const errs = validarFecha(d);
    if (monday(d) !== lun) errs.push('El día no pertenece a la semana del acta.');
    if (!resp) errs.push('Indique el responsable de la entrega.');
    if (!(lit > 0)) errs.push('Los litros por persona deben ser mayores a cero.');
    if (!marcados.size) errs.push('Marque al menos un beneficiario.');
    showErrors($('#err'), errs);
    if (errs.length) { await logEvent('bloqueo', { modulo: 'agua', errores: errs }); return; }
    const fresh = (await registros('AA')).find(r => r.semana === lun);
    const c = fresh ? { id: fresh.id, numero: fresh.numero } : await nextCode('AA', parse(lun).getFullYear());
    const obj = fresh || { id: c.id, tipo: 'AA', numero: c.numero, anio: parse(lun).getFullYear(), semana: lun, fecha: lun, dias: {}, creado: new Date().toISOString() };
    obj.dias[d] = [...marcados]; obj.litros = lit; obj.responsable = resp; obj.participantes = snap(ps);
    obj.modificado = new Date().toISOString(); obj.sync = false;
    await DB.put('registros', obj);
    if (!CFG.residente) { CFG.residente = resp; await saveCfg(); }
    await logEvent('registro', { id: obj.id, dia: d });
    toast(`Entrega del ${dmy(d)} guardada en ${obj.id}.`);
    await markChanged(); render();
  };
};

/* ------------------------------------------------------------------ EXPEDIENTE SEMANAL */
async function revisarSemana(lun) {
  const dias = laborables(lun).filter(d => d <= today());
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
  add(faltaRA.length ? 'ERROR' : 'OK', faltaRA.length ? `Falta la asistencia de: ${faltaRA.map(dayLabel).join(', ')}` : `Asistencia registrada los ${dias.length} días`);
  // 4. Agua
  if (!aa) add('ERROR', 'No existe el acta de entrega de agua de la semana');
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
  add(inco.length ? 'AVISO' : 'OK', inco.length ? `Asistentes de charla que figuran con falta: ${inco.join(', ')}` : 'Asistentes de charlas coinciden con la asistencia del día');
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
    <button class="btn primary" id="gen" ${rev.errores ? 'disabled style="opacity:.45"' : ''}>GENERAR EXPEDIENTE FOLIADO</button>
    <p class="hint">${rev.errores ? `Corrija ${rev.errores} error(es) antes de generar el expediente.` : 'Se generará el índice foliado y todos los formatos listos para imprimir y firmar.'}</p>
  </div>
  <div id="prev"></div>
  <div class="card">
    <h3>Entrega a la Municipalidad</h3>
    <p class="hint">Registre cada envío y su resultado: así se mide la tasa de devolución (KPI-2) y los documentos observados (KPI-3).</p>
    <ul class="list" id="ent">${entregas.length ? '' : '<li>Aún no hay entregas registradas.</li>'}</ul>
  </div>`;
  $('#sem').onchange = e => go('expediente/' + monday(e.target.value));
  const ent = $('#ent');
  entregas.forEach(en => {
    const li = document.createElement('li');
    const est = en.resultado === 'conforme' ? '<span class="pill ok">Conforme</span>' : en.resultado === 'devuelto' ? `<span class="pill bad">Devuelto · ${esc(en.motivo || '')}</span>` : '<span class="pill warn">En revisión</span>';
    li.innerHTML = `<span>Semana ${dm(en.semana)} · ${en.documentos} docs / ${en.folios} folios<br><small>Enviado ${dmy(en.fechaEntrega)}</small></span><span>${est}${en.resultado ? '' : ` <button class="btn sec sm" data-r="${en.id}">Resultado</button>`}</span>`;
    ent.appendChild(li);
  });
  ent.onclick = e => { const b = e.target.closest('[data-r]'); if (b) resultadoEntrega(+b.dataset.r); };
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

async function construirExpediente(lun, rev) {
  const docs = [];
  for (const d of laborables(lun)) {
    rev.ra.filter(r => r.fecha === d).forEach(r => docs.push(r));
    rev.ch.filter(r => r.fecha === d).sort((a, b) => a.hora.localeCompare(b.hora)).forEach(r => docs.push(r));
  }
  if (rev.aa) docs.push(rev.aa);
  let folio = 2; const pages = []; const indice = [];
  for (const r of docs) {
    const ps = r.participantes;
    let rows, titulo, intro, tabla, fin;
    if (r.tipo === 'RA') {
      const pr = new Set(r.presentes);
      rows = ps.map(p => pr.has(p.id)
        ? `<tr><td class="c">${pad(p.n)}</td><td>${esc(p.nombres)}</td><td class="c">${esc(p.dni)}</td><td class="c">${r.horaIngreso}</td><td></td><td class="c">${r.horaSalida}</td><td></td></tr>`
        : `<tr><td class="c">${pad(p.n)}</td><td>${esc(p.nombres)}</td><td class="c">${esc(p.dni)}</td><td class="c" colspan="4"><b>FALTA</b></td></tr>`);
      titulo = 'REGISTRO DE ASISTENCIA DE PARTICIPANTES';
      intro = `<p><b>Convenio N.°</b> ${esc(CFG.convenio)} &nbsp;·&nbsp; <b>Fecha:</b> ${DIAS[parse(r.fecha).getDay()]} ${dmy(r.fecha)} &nbsp;·&nbsp; <b>Código:</b> ${r.id} &nbsp;·&nbsp; <b>Presentes:</b> ${r.presentes.length} &nbsp;·&nbsp; <b>Faltas:</b> ${r.faltas.length}</p>`;
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
      rows = ps.map(p => `<tr><td class="c">${pad(p.n)}</td><td>${esc(p.nombres)}</td>${dias.map(d => `<td class="c">${(r.dias[d] || []).includes(p.id) ? 'X' : ''}</td>`).join('')}<td class="c">${esc(p.dni)}</td><td></td></tr>`);
      titulo = 'ACTA DE ENTREGA DE AGUA PARA CONSUMO HUMANO';
      const ult = dias[dias.length - 1];
      intro = `<p>En el ${esc(CFG.lugar)}, durante la semana del <b>${parse(r.semana).getDate()} de ${MESES[parse(r.semana).getMonth()]} al ${parse(ult).getDate()} de ${MESES[parse(ult).getMonth()]} de ${parse(ult).getFullYear()}</b>, se deja constancia de la entrega de agua para consumo humano a los participantes del Proyecto de Inversión denominado: "${esc(CFG.proyecto)}" con CUI N.° ${esc(CFG.cui)}, código de proyecto N.° ${esc(CFG.codProyecto)}, Cod. INFOBRAS N.° ${esc(CFG.infobras)} del Programa Llamkasun Perú, con Convenio N.° ${esc(CFG.convenio)}; por lo que a continuación firman los participantes y marcan los días que han recibido la cantidad de ${r.litros === 1 ? 'un (01) litro' : r.litros + ' litros'} de agua para consumo humano. <b>Código:</b> ${r.id}.</p>`;
      tabla = `<tr><th class="c">N.°</th><th>NOMBRE</th>${dias.map(d => `<th class="c">${DIAS_C[parse(d).getDay()]}<br>${dm(d)}</th>`).join('')}<th class="c">DNI</th><th class="c" style="width:20%">FIRMA</th></tr>`;
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
    <p style="margin-top:10px"><b>Revisión automática previa (RegistraObra v1.0):</b> ${rev.checks.map(c => `${c.estado === 'OK' ? '✔' : '⚠'} ${esc(c.texto)}`).join('; ')}.</p>
    ${firmas(nombreRol(CFG.residente, 'Residente de obra'), nombreRol(CFG.supervisor, 'Supervisor de obra'), 'Recibido por (cargo de entrega)')}</section>`;
  return { html: idx + pages.join(''), indice, total };
}

/* ------------------------------------------------------------------ MÁS */
VIEWS.mas = async () => {
  $('#view').innerHTML = `
  <div class="card"><h2>MÁS OPCIONES</h2>
    <ul class="list">
      <li><span><b>Tiempos e indicadores</b><br><small>Cronómetro de actividades y KPIs del piloto</small></span><button class="btn sec sm" data-g="tiempos">Abrir</button></li>
      <li><span><b>Participantes</b><br><small>Lista del programa guardada solo en este celular</small></span><button class="btn sec sm" data-g="participantes">Abrir</button></li>
      <li><span><b>Datos y respaldo</b><br><small>Exportar CSV/JSON, restaurar respaldo</small></span><button class="btn sec sm" data-g="datos">Abrir</button></li>
      <li><span><b>Configuración</b><br><small>Proyecto, responsables, sincronización y clave</small></span><button class="btn sec sm" data-g="config">Abrir</button></li>
    </ul>
    <p class="hint">RegistraObra v1.0 · funciona sin Internet · datos protegidos según la Ley N.° 29733.</p>
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
  const ps = await participantes();
  $('#view').innerHTML = `
  <div class="card"><h2>PARTICIPANTES (${ps.length})</h2>
    <p class="hint">La lista se guarda solo en este celular. No la comparta por redes ni la publique (Ley N.° 29733).</p>
    <div class="row2"><div><label>N.°</label><input id="pn" type="number" min="1" value="${ps.length ? Math.max(...ps.map(p => p.n)) + 1 : 1}"></div><div><label>DNI/CE</label><input id="pd" inputmode="numeric" maxlength="12"></div></div>
    <label>Apellidos y nombres</label><input id="pnom" style="text-transform:uppercase">
    <div id="err"></div>
    <button class="btn sec" id="padd" style="width:100%;margin-top:10px">Agregar participante</button>
    <h3>Importar lista</h3>
    <p class="hint">Pegue una fila por participante: <code>N;APELLIDOS Y NOMBRES;DNI</code> (también acepta comas o tabulaciones, como al copiar desde Excel).</p>
    <textarea id="imp" rows="4"></textarea>
    <div class="btns"><button class="btn sec sm" id="pimp">Importar</button><button class="btn sec sm" id="pej">Cargar 37 participantes de EJEMPLO (ficticios)</button><button class="btn danger sm" id="pclr">Vaciar lista</button></div>
    <ul class="list" id="pl">${ps.map(p => `<li><span>P-${pad(p.n)} · ${esc(p.nombres)}<br><small>DNI ${esc(p.dni)}</small></span><button class="btn danger sm" data-d="${p.id}">Quitar</button></li>`).join('')}</ul>
  </div>`;
  const addMany = async lines => {
    const exist = await participantes(); let n = 0; const errs = [];
    for (const [num, nom, dni] of lines) {
      if (!nom || !num) { errs.push(`Fila incompleta: ${num || ''} ${nom || ''}`); continue; }
      if (exist.some(p => p.n === +num)) { errs.push(`El N.° ${num} ya existe.`); continue; }
      const p = { n: +num, nombres: nom.trim().toUpperCase(), dni: String(dni || '').trim(), activo: true };
      p.id = await DB.add('participantes', p); exist.push(p); n++;
    }
    return { n, errs };
  };
  $('#padd').onclick = async () => {
    const r = await addMany([[$('#pn').value, $('#pnom').value, $('#pd').value]]);
    const dni = $('#pd').value.trim();
    if (dni && !/^\d{8}$/.test(dni)) r.errs.push('Aviso: el DNI no tiene 8 dígitos (si es carné de extranjería, ignore este aviso).');
    showErrors($('#err'), r.errs.filter(e => !e.startsWith('Aviso')));
    if (r.n) { toast('Participante agregado.'); render(); }
  };
  $('#pimp').onclick = async () => {
    const lines = $('#imp').value.split(/\r?\n/).map(l => l.split(/[;\t]|,(?=\s*\d{6,}\s*$)/).map(s => s.trim())).filter(l => l.length >= 2 && l[0]);
    const r = await addMany(lines);
    showErrors($('#err'), r.errs); toast(`${r.n} participantes importados.`); if (r.n) render();
  };
  $('#pej').onclick = async () => {
    const base = ps.length ? Math.max(...ps.map(p => p.n)) : 0;
    const r = await addMany(EJEMPLO.map((nom, i) => [base + i + 1, nom + ' (EJEMPLO)', String(90000001 + base + i)]));
    toast(`${r.n} participantes de ejemplo cargados.`); render();
  };
  $('#pclr').onclick = async () => {
    if ($('#pclr').dataset.armed) { await DB.clear('participantes'); toast('Lista vaciada.'); render(); return; }
    $('#pclr').dataset.armed = '1'; $('#pclr').textContent = 'Toque otra vez para confirmar';
  };
  $('#pl').onclick = async e => { const b = e.target.closest('[data-d]'); if (b) { await DB.del('participantes', +b.dataset.d); render(); } };
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
    descargar(`registros_${stamp}.csv`, csv([['codigo', 'tipo', 'fecha', 'presentes/asistentes/beneficiarios', 'faltas', 'responsable', 'creado', 'sincronizado'],
      ...r.map(x => [x.id, x.tipo, x.fecha, x.tipo === 'RA' ? x.presentes.length : x.tipo === 'CH' ? x.asistentes.length : Object.values(x.dias).map(a => a.length).join('/'), x.tipo === 'RA' ? x.faltas.length : '', x.responsable, x.creado, x.sync ? 'sí' : 'no'])]), 'text/csv');
  };
  $('#eE').onclick = async () => { const e = await DB.all('entregas'); descargar(`entregas_${stamp}.csv`, csv([['semana', 'fecha_entrega', 'documentos', 'folios', 'resultado', 'motivo', 'documentos_observados', 'fecha_respuesta'], ...e.map(x => [x.semana, x.fechaEntrega, x.documentos, x.folios, x.resultado || 'en revisión', x.motivo, x.observados, x.fechaRespuesta || ''])]), 'text/csv'); };
  $('#eV').onclick = async () => { const e = await DB.all('eventos'); descargar(`eventos_${stamp}.csv`, csv([['momento', 'tipo', 'detalle'], ...e.map(x => [x.t, x.tipo, JSON.stringify(x.detalle)])]), 'text/csv'); };
  $('#eJ').onclick = async () => { descargar(`respaldo_registraobra_${stamp}.json`, JSON.stringify(await DB.dump(), null, 1), 'application/json'); };
  $('#fJ').onchange = async e => {
    try { const data = JSON.parse(await e.target.files[0].text()); await DB.restore(data); await loadCfg(); toast('Respaldo restaurado.'); refreshPending(); }
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
    <h3>Sincronización</h3>
    ${f('syncUrl', 'URL del Apps Script (Google Sheets)', 'https://script.google.com/macros/s/.../exec')}
    <p class="hint">Si no hay URL, todo queda guardado en el celular y puede exportarse desde "Datos y respaldo".</p>
    <h3>Clave de acceso</h3>
    <input id="pin" type="password" inputmode="numeric" maxlength="6" placeholder="${CFG.pinHash ? 'Clave activa · escriba una nueva para cambiarla' : 'Opcional: 4 a 6 dígitos'}">
    <div id="err"></div>
    <button class="btn primary" id="save">GUARDAR CONFIGURACIÓN</button>
    ${CFG.pinHash ? '<button class="btn danger" id="nopin" style="width:100%;margin-top:8px">Quitar clave</button>' : ''}
  </div>`;
  $('#save').onclick = async () => {
    $$('[data-k]').forEach(i => { const k = i.dataset.k; let v = i.value.trim(); if (k === 'charlasSemana') v = +v || 0; if (k === 'sabados') v = v === 'true'; CFG[k] = v; });
    const pin = $('#pin').value.trim();
    if (pin) { if (!/^\d{4,6}$/.test(pin)) { showErrors($('#err'), ['La clave debe tener de 4 a 6 dígitos.']); return; } CFG.pinHash = await hashPin(pin); }
    await saveCfg(); $('#subtitle').textContent = `${CFG.corto} · ${dayLabel(today())}`; toast('Configuración guardada.'); render();
  };
  if ($('#nopin')) $('#nopin').onclick = async () => { CFG.pinHash = ''; await saveCfg(); toast('Clave eliminada.'); render(); };
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
  });
}
(async function init() {
  await loadCfg();
  await unlock();
  $('#subtitle').textContent = `${CFG.corto} · ${dayLabel(today())}`;
  updateNet(); refreshPending();
  window.addEventListener('online', () => { updateNet(); syncNow(true); });
  window.addEventListener('offline', updateNet);
  window.addEventListener('hashchange', render);
  $$('nav.bottom button').forEach(b => b.onclick = () => go(b.dataset.go));
  $('#syncBtn').onclick = () => syncNow(false);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  render();
})();
