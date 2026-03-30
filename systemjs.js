// Robust logo fallback — generate an SVG placeholder if all image URLs fail
function logoFallback(imgEl, initials, bgColor){
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='66' height='66'><circle cx='33' cy='33' r='33' fill='${bgColor}'/><text x='33' y='38' font-family='Inter,sans-serif' font-size='18' font-weight='700' fill='white' text-anchor='middle'>${initials}</text></svg>`;
  imgEl.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  imgEl.onerror = null;
}

/* ════════════════ MAIN APPLICATION JS ════════════════ */

/*
  JS 1 — STATE & HELPERS
*/
// ── MYSQL-BACKED STATE (replaces localStorage) ──────────────────────────────
// DB is now loaded from MySQL via api.php; it acts as an in-memory cache.
let DB          = [];
let adminCfg    = {id:'', password:'', name:'Administrator'};
let encoderCfg  = {id:'', password:'', name:'Encoder'};
let schoolAdminCfg = {id:'', dbId:0, name:'School Admin'}; // current school admin session
let isSchoolAdmin = false;

// ── API HELPER ────────────────────────────────────────────────────────────────
const API = 'api.php';
async function api(action, body={}, method='POST'){
  try{
    let url = API+'?action='+action;
    const opts = { headers:{'Content-Type':'application/json'} };
    if(method==='GET'){
      Object.keys(body).forEach(k=>url+='&'+k+'='+encodeURIComponent(body[k]));
      opts.method='GET';
    } else {
      opts.method='POST';
      opts.body=JSON.stringify({action,...body});
    }
    const r = await fetch(url, opts);
    return await r.json();
  } catch(e){ console.error('API error',e); return {ok:false,error:e.message}; }
}

// Load ALL personnel (active) from MySQL into local DB cache
async function loadDB(){
  const res = await api('get_personnel','GET');
  if(res.ok) DB = res.data || [];
}

// Load archived personnel into DB cache (merge — they stay separated by .archived flag)
async function loadArchivedDB(){
  const res = await api('get_personnel',{archived:1},'GET');
  if(res.ok){
    const ids = new Set((res.data||[]).map(e=>e.id));
    DB = DB.filter(e=>!e.archived);   // remove any stale archived copies
    DB = DB.concat(res.data||[]);
  }
}

// Load leave records for a specific employee into their DB entry
async function loadRecords(empId){
  const e = DB.find(x=>x.id===empId);
  if(!e) return;
  const res = await api('get_records',{employee_id:empId},'GET');
  if(res.ok) e.records = res.records || [];
}

// ── PERSIST ROW BALANCES ────────────────────────────────────────────────────
// Called after every render (ntSv, tSv, saveEditMo, confirmDeleteRow).
// Walks every record for the employee, computes its running balance values
// exactly as the render engine does, then POSTs the 8 columns for each
// row individually to api.php?action=save_row_balance.
async function persistRowBalances(empId) {
  const e = DB.find(x => x.id === empId);
  if (!e || !e.records || e.records.length === 0) return;

  const records = e.records;
  const firstConv = records.find(r => r._conversion);
  let curEra = firstConv ? firstConv.fromStatus : e.status;

  // Running balances carried across all rows (same logic as ntRow / tRow)
  let bV = 0, bS = 0, bal = 0;

  const updates = []; // collect { record_id, 8 values }

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r) continue;

    // ── Conversion marker: carry balance across era boundary ──
    if (r._conversion) {
      if (curEra === 'Teaching'   && r.toStatus === 'Non-Teaching') { bV = bal; bS = bal; }
      if (curEra === 'Non-Teaching' && r.toStatus === 'Teaching')   { bal = bV; }
      curEra = r.toStatus;
      continue;
    }

    const C    = classifyLeave(r.action || '');
    const days = (!C.isAcc && !C.isTransfer && !C.isDis && !C.isMon && !C.isMD && r.earned === 0)
                 ? calcDays(r) : 0;

    // FIX: use per-row earned values only (not cumulative).
    // These mirror exactly what ntRow / tRow display on screen.
    let rowAEarned = 0, rowAAbsWP = 0, rowAWOP = 0;
    let rowBEarned = 0, rowBAbsWP = 0, rowBWOP = 0;

    if (curEra === 'Teaching') {
      if (C.isTransfer) { rowAEarned = r.trV || 0; bal += rowAEarned; }
      else if (r.earned > 0 && !C.isMon && !C.isPer) { rowAEarned = r.earned; bal += rowAEarned; }
      else if (C.isMD)  { bal += r.monDisAmt || 0; rowAAbsWP = r.monDisAmt || 0; }
      else if (C.isMon) {
        const m = r.monAmount || 0;
        if (bal >= m) { rowAAbsWP = m; bal -= m; } else { rowAAbsWP = bal; rowAWOP = m - bal; bal = 0; }
      }
      else if (days > 0) {
        if (C.isSick) {
          if (bal >= days) { rowBAbsWP = days; bal -= days; } else { rowBAbsWP = bal; rowBWOP = days - bal; bal = 0; }
        } else if (C.isPer) {
          rowAWOP = days;
        } else if (C.isVacation) {
          if (bal >= days) { rowAAbsWP = days; bal -= days; } else { rowAAbsWP = bal; rowAWOP = days - bal; bal = 0; }
        } else if (C.isForce) {
          if (bal >= days) { rowAAbsWP = days; bal -= days; } else { rowAAbsWP = bal; rowAWOP = days - bal; bal = 0; }
        } else if (C.isTerminal) {
          if (bal >= days) { rowAAbsWP = days; rowBAbsWP = days; bal -= days; }
          else { rowAAbsWP = bal; rowAWOP = days - bal; rowBAbsWP = bal; rowBWOP = days - bal; bal = 0; }
        } else if (C.isSetB_noDeduct) {
          rowBAbsWP = days;
        } else {
          rowAAbsWP = days;
        }
      }
      // setA_earned mirrors exactly what tRow() shows in the Earned cell.
      // setB_earned is always 0 for Teaching (no Set B Earned column).
      // Balance: Sick/Maternity/Paternity → setB_balance; everything else → setA_balance.
      // Teaching uses the single `bal` variable — NOT bV/bS (those are Non-Teaching only).
      const isE = r.earned > 0;
      const showBalInSetB = (C.isSick || C.isSetB_noDeduct)
                          && !isE && !C.isDis && !C.isMon && !C.isMD && !C.isTerminal;
      if (!r._record_id) continue;
      updates.push({
        record_id:    r._record_id,
        employee_id:  empId,
        setA_earned:  +rowAEarned.toFixed(3),
        setA_abs_wp:  +(rowAAbsWP).toFixed(3),
        setA_balance: showBalInSetB ? 0 : +(bal).toFixed(3),
        setA_wop:     +(rowAWOP).toFixed(3),
        setB_earned:  0,
        setB_abs_wp:  +(rowBAbsWP).toFixed(3),
        setB_balance: showBalInSetB ? +(bal).toFixed(3) : 0,
        setB_wop:     +(rowBWOP).toFixed(3),
      });

    } else {
      // ── Non-Teaching ──
      if (C.isTransfer) {
        rowAEarned = r.trV || 0; rowBEarned = r.trS || 0;
        bV += rowAEarned; bS += rowBEarned;
      } else if (C.isAcc) {
        const v = (r.earned === 0 && !(r.action || '').toLowerCase().includes('service')) ? 1.25 : r.earned;
        rowAEarned = v; rowBEarned = v;
        bV += v; bS += v;
      } else if (r.earned > 0) {
        rowAEarned = r.earned; rowBEarned = r.earned;
        bV += r.earned; bS += r.earned;
      } else if (C.isMD) {
        bV += r.monDV || 0; bS += r.monDS || 0;
        rowAAbsWP = r.monDV || 0; rowBAbsWP = r.monDS || 0;
      } else if (C.isMon) {
        const mV = r.monV || 0, mS = r.monS || 0;
        if (bV >= mV) { rowAAbsWP = mV; bV -= mV; } else { rowAAbsWP = bV; rowAWOP = mV - bV; bV = 0; }
        if (bS >= mS) { rowBAbsWP = mS; bS -= mS; } else { rowBAbsWP = bS; rowBWOP = mS - bS; bS = 0; }
      } else if (C.isPer && days > 0) {
        rowAWOP = days;
      } else if (C.isVacation && days > 0) {
        if (bV >= days) { rowAAbsWP = days; bV -= days; } else { rowAAbsWP = bV; rowAWOP = days - bV; bV = 0; }
      } else if (C.isSick && days > 0) {
        if (bS >= days) { rowBAbsWP = days; bS -= days; } else { rowBAbsWP = bS; rowBWOP = days - bS; bS = 0; }
      } else if (C.isForce && days > 0) {
        if (bV >= days) { rowAAbsWP = days; bV -= days; } else { rowAAbsWP = bV; rowAWOP = days - bV; bV = 0; }
      } else if (C.isTerminal && days > 0) {
        if (bV >= days) { rowAAbsWP = days; bV -= days; } else { rowAAbsWP = bV; rowAWOP = days - bV; bV = 0; }
        if (bS >= days) { rowBAbsWP = days; bS -= days; } else { rowBAbsWP = bS; rowBWOP = days - bS; bS = 0; }
      } else if (C.isSetB_noDeduct && days > 0) {
        rowBAbsWP = days;
      } else if (C.isSetA_noDeduct && days > 0) {
        rowAAbsWP = days;
      } else if (days > 0) {
        rowAAbsWP = days;
      }

      // setA/setB earned mirror exactly what ntRow() shows — use computed rowAEarned/rowBEarned,
      // NOT raw r.earned (which would incorrectly write to earned rows on monetization/absence rows).
      if (!r._record_id) continue;
      updates.push({
        record_id:    r._record_id,
        employee_id:  empId,
        setA_earned:  +rowAEarned.toFixed(3),
        setA_abs_wp:  +(rowAAbsWP).toFixed(3),
        setA_balance: +(bV).toFixed(3),
        setA_wop:     +(rowAWOP).toFixed(3),
        setB_earned:  +rowBEarned.toFixed(3),
        setB_abs_wp:  +(rowBAbsWP).toFixed(3),
        setB_balance: +(bS).toFixed(3),
        setB_wop:     +(rowBWOP).toFixed(3),
      });
    }
  }

  // Fire all updates
  for (const u of updates) {
    await api('save_row_balance', u);
  }
}

// Load admin + encoder config from MySQL
async function loadAdminCfg(){
  try {
    const res = await api('get_admin_cfg');
    if (!res.ok) return;
    if (res.admin) {
      adminCfg.id   = res.admin.login_id || adminCfg.id;
      adminCfg.name = res.admin.name     || adminCfg.name;
    }
    if (res.encoder) {
      encoderCfg.id   = res.encoder.login_id || encoderCfg.id;
      encoderCfg.name = res.encoder.name     || encoderCfg.name;
    }
  } catch(e) { /* non-fatal */ }
}
let isAdmin     = false, isEncoder = false, curId = null, ntEI = -1, tEI = -1;

// ── SESSION PERSISTENCE ──
// Save login state to sessionStorage so refresh doesn't log out
function saveSession(page){
  sessionStorage.setItem('deped_session', JSON.stringify({
    isAdmin, isEncoder, isSchoolAdmin, curId, page: page||'',
    schoolAdminCfg: isSchoolAdmin ? schoolAdminCfg : undefined
  }));
}
function clearSession(){
  sessionStorage.removeItem('deped_session');
}
function restoreSession(){
  try{
    const s=JSON.parse(sessionStorage.getItem('deped_session')||'null');
    if(!s) return false;
    if(s.isSchoolAdmin){
      isSchoolAdmin=true; isAdmin=false; isEncoder=false;
      if(s.schoolAdminCfg) schoolAdminCfg=s.schoolAdminCfg;
      showScreen('s-app');
      document.querySelector('.topbar').style.display='';
      buildSASidebar();
      loadDB().then(()=>{ renderSAList(); goPage('sa'); saveSession('sa'); });
      return true;
    }
    if(s.isAdmin){
      isAdmin=true; isEncoder=s.isEncoder||false;
      loadAdminCfg();
      showScreen('s-app');
      document.querySelector('.topbar').style.display='';
      buildAdminSidebar();
      loadDB().then(()=>renderList());
      if(s.page&&s.page!=='list'&&$('p-'+s.page)){
        if(s.page==='archive'){sbGoPage('archive');}
        else if(s.page==='cards'){sbGoPage('cards');}
        else if((s.page==='nt'||s.page==='t')&&s.curId){
          curId=s.curId;
          const e=DB.find(x=>x.id===curId);
          if(e) openCard(curId);
          else goPage('list');
        } else { goPage('list'); }
      } else { goPage('list'); }
      return true;
    } else if(s.curId){
      const u=DB.find(e=>e.id===s.curId);
      if(u){
        isAdmin=false; isEncoder=false; curId=u.id;
        showScreen('s-app');
        document.querySelector('.topbar').style.display='none';
        hideSidebar();
        $('ntFrm').style.display='none';
        $('tFrm').style.display='none';
        goPage('user');
        loadRecords(curId).then(()=>openUserView(DB.find(x=>x.id===curId)||u));
        return true;
      }
    }
  }catch(e){}
  return false;
}

const $     = id => document.getElementById(id);
const fmt   = n  => parseFloat((n||0).toFixed(10)).toString();
const hz    = n  => (!n||n===0)?'':fmt(n);
const fmtD  = ds => {
  if(!ds) return '';
  // Handle both date strings (YYYY-MM-DD) and already-formatted mm/dd/yyyy
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(ds)) return ds; // already mm/dd/yyyy
  const d = new Date(ds + (ds.includes('T') ? '' : 'T00:00:00'));
  if(isNaN(d)) return ds;
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
};
// Convert mm/dd/yyyy → YYYY-MM-DD for internal storage
function toISODate(mmddyyyy){
  if(!mmddyyyy) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(mmddyyyy)) return mmddyyyy; // already ISO
  const parts=mmddyyyy.split('/');
  if(parts.length!==3) return mmddyyyy;
  const [mm,dd,yyyy]=parts;
  return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
}
// Auto-format date input: inserts slashes as user types
function fmtDateInput(inp, commit){
  let v=inp.value.replace(/\D/g,'');
  if(v.length>8)v=v.slice(0,8);
  if(v.length>=5) v=v.slice(0,2)+'/'+v.slice(2,4)+'/'+v.slice(4);
  else if(v.length>=3) v=v.slice(0,2)+'/'+v.slice(2);
  inp.value=v;
}
const sv    = () => {};  // no-op: saves are done via explicit API calls
const svEnc = () => {};  // handled by doSaveEncoder API call
document.addEventListener('keydown',function(e){
  const inp=document.activeElement;
  if(!inp||inp.type!=='number')return;
  const numpadMap={97:'0',98:'1',99:'2',100:'3',101:'4',102:'5',103:'6',104:'7',105:'8',96:'0',110:'.',109:'-'};
  const ch=numpadMap[e.keyCode];
  if(ch===undefined)return;
  e.preventDefault();
  const s=inp.selectionStart,en=inp.selectionEnd,cur=inp.value;
  inp.value=cur.slice(0,s)+ch+cur.slice(en);
  inp.selectionStart=inp.selectionEnd=s+1;
  inp.dispatchEvent(new Event('input',{bubbles:true}));
});
const svAdm = () => {};  // handled by doSaveAdmin API call

/* Purge any admin entry that leaked into DB from older versions */
function purgeAdminFromDB(){
  const before=DB.length;
  DB=DB.filter(e=>{
    const id=(e.id||'').toLowerCase();
    const sur=(e.surname||'').toLowerCase();
    return !(id===(adminCfg.id||'admin').toLowerCase()||sur==='administrator'||id==='admin001'||id==='admin'
           ||id===(encoderCfg.id||'encoder').toLowerCase());
  });
  if(DB.length!==before)sv();
}
purgeAdminFromDB();

/*
  JS 1b — SIDEBAR
*/
function openSidebar(){
  $('sidebar').classList.add('open');
  $('sbOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeSidebar(){
  $('sidebar').classList.remove('open');
  $('sbOverlay').classList.remove('open');
  document.body.style.overflow='';
}
function buildAdminSidebar(){
  const displayName = isEncoder ? (encoderCfg.name||'Encoder') : (adminCfg.name||'Administrator');
  const roleLabel   = isEncoder ? 'Encoder' : 'Admin · Edit Profile';
  $('sbToggleBtn').style.display='inline-flex';
  $('sbDivider').style.display='';
  $('sbUser').style.display='flex';
  $('sbAv').textContent=displayName[0].toUpperCase();
  $('sbName').textContent=displayName;
  $('sbUser').onclick = () => { isEncoder ? openEncoderProfile() : openAdminProfile(); closeSidebar(); };
  const roleEl=$('sbRole');
  if(roleEl) roleEl.textContent=roleLabel;
  $('sbNav').innerHTML=`
    <div class="sb-item active" id="sbItemList" onclick="sbGoPage('list')">
      <span class="sb-icon">👥</span><span>Personnel List</span>
    </div>
    <div class="sb-item" id="sbItemCards" onclick="sbGoPage('cards')">
      <span class="sb-icon">📋</span><span>Leave Cards</span>
    </div>
    <div class="sb-divider"></div>
    <div class="sb-item danger" onclick="closeSidebar();confirmLogout();">
      <span class="sb-icon">🔒</span><span>Logout</span>
    </div>`;
}

function buildSASidebar(){
  const displayName = schoolAdminCfg.name || 'School Admin';
  $('sbToggleBtn').style.display='inline-flex';
  $('sbDivider').style.display='';
  $('sbUser').style.display='flex';
  $('sbAv').textContent=displayName[0].toUpperCase();
  $('sbName').textContent=displayName;
  const roleEl=$('sbRole');
  if(roleEl) roleEl.textContent='School Admin · Edit Profile';
  $('sbUser').onclick = () => { openSAProfile(); closeSidebar(); };
  $('sbNav').innerHTML=`
    <div class="sb-item active" id="sbItemSa" onclick="sbGoPage('sa')">
      <span class="sb-icon">🏫</span><span>Personnel Management</span>
    </div>
    <div class="sb-divider"></div>
    <div class="sb-item danger" onclick="closeSidebar();confirmLogout();">
      <span class="sb-icon">🔒</span><span>Logout</span>
    </div>`;
}
function hideSidebar(){
  $('sbToggleBtn').style.display='none';
  $('sbDivider').style.display='none';
  $('sbUser').style.display='none';
  $('sbNav').innerHTML='';
  closeSidebar();
}
function sbGoPage(pg){
  closeSidebar();
  document.querySelectorAll('.sb-item[id^="sbItem"]').forEach(el=>el.classList.remove('active'));
  const active=$('sbItem'+pg.charAt(0).toUpperCase()+pg.slice(1));
  if(active) active.classList.add('active');
  if(pg==='archive') renderArchive();
  if(pg==='cards') renderCardsSearch();
  if(pg==='sa') renderSAList();
  goPage(pg);
  saveSession(pg);
}
/*
  JS 2 — SCREEN / PAGE ROUTING
*/
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>{s.classList.remove('active');s.style.display='';});
  $(id).classList.add('active');
}
function goPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  $('p-'+id).classList.add('on');
  // sidebar handles nav active state
  window.scrollTo(0,0);
}

/*
  JS 3 — LOGIN & LOGOUT
*/
function doLogin(){
  const id=$('lID').value.trim(), pw=$('lPw').value;
  const lErr=$('lErr');
  lErr.style.display='none';
  // Basic empty-field check before hitting the server
  if(!id||!pw){ lErr.textContent='Please enter your email and password.'; lErr.style.display='block'; return; }
  const btn=document.querySelector('.lbtn');
  if(btn){btn.disabled=true;btn.textContent='Signing in…';}
  api('login',{id,password:pw}).then(res=>{
    if(btn){btn.disabled=false;btn.textContent='Login';}
    if(!res.ok){
      lErr.textContent = res.error || 'Incorrect email or password. Please try again.';
      lErr.style.display='block';
      return;
    }
    if(res.role==='admin'||res.role==='encoder'){
      isAdmin=true; isEncoder=(res.role==='encoder'); isSchoolAdmin=false;
      adminCfg.name=(!isEncoder)?res.name:adminCfg.name;
      encoderCfg.name=(isEncoder)?res.name:encoderCfg.name;
      if(res.role==='admin')  { adminCfg.id=res.login_id; }
      else                    { encoderCfg.id=res.login_id; }
      showScreen('s-app');
      document.querySelector('.topbar').style.display='';
      buildAdminSidebar();
      loadDB().then(()=>{ renderList(); goPage('list'); saveSession('list'); });
    } else if(res.role==='school_admin'){
      isSchoolAdmin=true; isAdmin=false; isEncoder=false;
      schoolAdminCfg={id:res.login_id, dbId:res.db_id||0, name:res.name};
      showScreen('s-app');
      document.querySelector('.topbar').style.display='';
      buildSASidebar();
      loadDB().then(()=>{ renderSAList(); goPage('sa'); saveSession('sa'); });
    } else if(res.role==='employee'){
      // Block inactive accounts — server already checks but double-check client-side
      if(res.account_status==='inactive'){
        lErr.textContent='Your account is inactive. Please contact the administrator.';
        lErr.style.display='block';
        return;
      }
      isAdmin=false; isEncoder=false; curId=res.employee_id;
      loadDB().then(async ()=>{
        const u=DB.find(e=>e.id===curId);
        if(!u){ lErr.textContent='Account not found. Please contact the administrator.'; lErr.style.display='block'; return; }
        // Block if inactive (from DB)
        if((u.account_status||'active')==='inactive'){
          lErr.textContent='Your account is inactive. Please contact the administrator.';
          lErr.style.display='block';
          return;
        }
        await loadRecords(curId);
        showScreen('s-app');
        document.querySelector('.topbar').style.display='none';
        hideSidebar();
        $('ntFrm').style.display='none'; $('tFrm').style.display='none';
        document.querySelectorAll('[id^="ntOldEra"],[id^="tOldEra"],[id^="uOldEra"]').forEach(el=>el.remove());
        $('ntTbl').innerHTML=''; $('tTbl').innerHTML='';
        goPage('user'); openUserView(u); saveSession('user');
      });
    }
  }).catch(()=>{ if(btn){btn.disabled=false;btn.textContent='Login';} lErr.textContent='Connection error. Please try again.'; lErr.style.display='block'; });
}
function confirmLogout(){ $('logoutMo').classList.add('open'); }
function doLogout(){
  isAdmin=false; isEncoder=false; isSchoolAdmin=false; curId=null; $('lID').value=''; $('lPw').value='';
  document.querySelectorAll('[id^="ntOldEra"],[id^="tOldEra"],[id^="uOldEra"]').forEach(el=>el.remove());
  hideSidebar();
  clearSession();
  document.querySelector('.topbar').style.display='';
  closeMo('logoutMo'); showScreen('s-login');
}

/*
  JS 4 — EYE TOGGLE
*/
function toggleEye(inputId,btn){
  const inp=$(inputId); if(!inp) return;
  const h=inp.type==='password'; inp.type=h?'text':'password';
  btn.textContent=h?'🙈':'👁';
}

/*
  JS 5 — PERSONNEL LIST
  Search now matches: surname, given name, suffix, AND employee ID.
*/
function renderStats(){
  const now=new Date();
  const curMonth=now.getMonth(); // 0-11
  const curYear=now.getFullYear();
  const monthStr=`${curYear}-${String(curMonth+1).padStart(2,'0')}`;

  const active=DB.filter(e=>!e.archived);
  const arch=DB.filter(e=>e.archived).length;

  // Compute update status for current month — based on when admin last saved the card
  function isUpdatedThisMonth(emp){
    if(!emp.lastEditedAt) return false;
    const dt=new Date(emp.lastEditedAt);
    return dt.getFullYear()===curYear&&dt.getMonth()===curMonth;
  }

  const updated=active.filter(e=>isUpdatedThisMonth(e)).length;
  const notUpdated=active.length-updated;
  const monthLabel=now.toLocaleString('en-US',{month:'long',year:'numeric'});

  $('statsRow').innerHTML=`
    <div class="stat-box"><div class="stat-icon si-g">👥</div><div><div class="stat-val">${active.length}</div><div class="stat-lbl">Active Personnel</div></div></div>
    <div class="stat-box"><div class="stat-icon si-b">📚</div><div><div class="stat-val">${active.filter(e=>e.status==='Teaching').length}</div><div class="stat-lbl">Teaching</div></div></div>
    <div class="stat-box"><div class="stat-icon si-a">🏢</div><div><div class="stat-val">${active.filter(e=>e.status==='Non-Teaching').length}</div><div class="stat-lbl">Non-Teaching</div></div></div>
    <div class="stat-box" style="cursor:pointer;border-color:var(--g3);" onclick="openCardStatusMo()">
      <div class="stat-icon" style="background:#d1fae5;">✅</div>
      <div><div class="stat-val" style="color:#065f46;">${updated}</div><div class="stat-lbl">Updated (${monthLabel})</div></div>
    </div>
    <div class="stat-box" style="cursor:pointer;border-color:#e53e3e;" onclick="openCardStatusMo()">
      <div class="stat-icon" style="background:#fee2e2;">⏳</div>
      <div><div class="stat-val" style="color:#c53030;">${notUpdated}</div><div class="stat-lbl">Not Yet Updated</div></div>
    </div>
    ${arch>0?`<div class="stat-box"><div class="stat-icon" style="background:#edf2f7;">🗄</div><div><div class="stat-val" style="color:#4a5568;">${arch}</div><div class="stat-lbl">Archived</div></div></div>`:''}`;
}

function openCardStatusMo(){
  const now=new Date();
  const curMonth=now.getMonth();
  const curYear=now.getFullYear();
  const monthLabel=now.toLocaleString('en-US',{month:'long',year:'numeric'});
  $('cardStatusMonth').textContent=monthLabel;

  function isUpdated(emp){
    if(!emp.lastEditedAt) return false;
    const dt=new Date(emp.lastEditedAt);
    return dt.getFullYear()===curYear&&dt.getMonth()===curMonth;
  }
  const active=DB.filter(e=>!e.archived).sort((a,b)=>(a.surname||'').localeCompare(b.surname||''));
  const upd=active.filter(e=>isUpdated(e));
  const nupd=active.filter(e=>!isUpdated(e));

  $('cardStatusBody').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div style="font-size:11px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;">✅ Updated (${upd.length})</div>
        ${upd.length===0?`<div style="font-size:11.5px;color:var(--mu);font-style:italic;">None yet</div>`
          :upd.map(e=>`<div style="padding:6px 10px;background:#d1fae5;border-radius:6px;margin-bottom:5px;font-size:11.5px;font-weight:600;color:#065f46;">${(e.surname||'').toUpperCase()}, ${e.given||''} <span style="font-size:9.5px;opacity:.7;">(${e.status})</span></div>`).join('')}
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:#c53030;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;">⏳ Not Yet Updated (${nupd.length})</div>
        ${nupd.length===0?`<div style="font-size:11.5px;color:var(--mu);font-style:italic;">All cards updated!</div>`
          :nupd.map(e=>`<div style="padding:6px 10px;background:#fee2e2;border-radius:6px;margin-bottom:5px;font-size:11.5px;font-weight:600;color:#9b1c1c;">${(e.surname||'').toUpperCase()}, ${e.given||''} <span style="font-size:9.5px;opacity:.7;">(${e.status})</span></div>`).join('')}
      </div>
    </div>`;
  $('cardStatusMo').classList.add('open');
}

/* ══════════════════════════════════════
   LEAVE VALIDATION (before save)
   - Force/Mandatory: max 5 days, once a year
   - Special Leave for Women (Magna Carta): max 60 days/year
   - NT Set A earned: max 15 days/year accrual
   - NT Set B earned: max 15 days/year accrual
══════════════════════════════════════ */
function getRecordYear(r){
  const d=r.from||r.to||'';
  if(!d)return null;
  return new Date(d+'T00:00:00').getFullYear();
}

function validateLeaveEntry(empRecords, newRec, editIdx){
  // editIdx = -1 for new, or the index being replaced
  const al=(newRec.action||'').toLowerCase();
  const year=getRecordYear(newRec);
  if(!year)return null; // no date, skip validation

  // Build effective record list (exclude the record being replaced)
  const existing=empRecords.filter((r,i)=>{
    if(r._conversion)return false;
    if(editIdx>=0&&i===editIdx)return false;
    return true;
  });

  // 1. Force/Mandatory Leave — max 5 days, once a year
  const isForce=(al.includes('force')||al.includes('mandatory'))&&!al.includes('disapproved');
  if(isForce){
    const forceDays=newRec.forceAmount>0?newRec.forceAmount:calcDays(newRec);
    if(forceDays>5){
      return `⚠️ Force/Mandatory Leave cannot exceed 5 days per year. You entered ${forceDays} day(s).`;
    }
    const existingForce=existing.filter(r=>{
      const ra=(r.action||'').toLowerCase();
      if(!(ra.includes('force')||ra.includes('mandatory'))||ra.includes('disapproved'))return false;
      return getRecordYear(r)===year;
    });
    if(existingForce.length>0){
      return `⚠️ Force/Mandatory Leave is only allowed ONCE per year (${year}). A Force Leave entry already exists for this year.`;
    }
  }

  // 2. Special Leave Benefits for Women (Magna Carta) — max 60 days/year
  if(al.includes('magna carta')||al.includes('special leave benefit')){
    const newDays=calcDays(newRec);
    const existingDays=existing
      .filter(r=>{
        const ra=(r.action||'').toLowerCase();
        return (ra.includes('magna carta')||ra.includes('special leave benefit'))&&getRecordYear(r)===year;
      })
      .reduce((sum,r)=>sum+calcDays(r),0);
    const total=existingDays+newDays;
    if(total>60){
      return `⚠️ Special Leave Benefits for Women (Magna Carta) cannot exceed 60 days per year. Currently used: ${existingDays} day(s), adding: ${newDays} day(s) = ${total} day(s) total.`;
    }
  }

  // 3. NT monthly accrual cap — Set A and Set B each max 15 days/year earned
  const isEarned=newRec.earned>0;
  const isNTEmp=DB.find(x=>x.id===curId)?.status==='Non-Teaching';
  if(isEarned&&isNTEmp){
    const earnedA=newRec.earned; // NT: Set A = Set B (same earned value both sides)
    const existingEarned=existing
      .filter(r=>r.earned>0&&getRecordYear(r)===year)
      .reduce((sum,r)=>sum+r.earned,0);
    const totalEarned=existingEarned+earnedA;
    if(totalEarned>15){
      return `⚠️ Non-Teaching leave accrual cannot exceed 15 days per year per Set. Currently earned this year: ${existingEarned.toFixed(3)}, adding: ${earnedA.toFixed(3)} = ${totalEarned.toFixed(3)} days total. Max is 15 days.`;
    }
  }

  return null; // OK
}
// ── ARCHIVE FUNCTIONS ────────────────────────────────────────────
let _archiveTargetId=null;

// toggleArchiveView removed — archive is now its own page

function renderArchive(){
  const archived=DB.filter(e=>e.archived);
  // Update archive stats
  const asr=$('archiveStatsRow');
  if(asr){
    const ret=archived.filter(e=>e.archiveReason==='Retired').length;
    const dec=archived.filter(e=>e.archiveReason==='Deceased').length;
    const res=archived.filter(e=>e.archiveReason==='Resigned').length;
    const oth=archived.filter(e=>!['Retired','Deceased','Resigned'].includes(e.archiveReason)).length;
    asr.innerHTML=`
      <div class="stat-box"><div class="stat-icon" style="background:#edf2f7;font-size:20px;">🗄</div><div><div class="stat-val" style="color:#4a5568;">${archived.length}</div><div class="stat-lbl">Total Archived</div></div></div>
      <div class="stat-box"><div class="stat-icon" style="background:#fff5f5;font-size:20px;">🎖</div><div><div class="stat-val" style="color:#c53030;">${ret}</div><div class="stat-lbl">Retired</div></div></div>
      <div class="stat-box"><div class="stat-icon" style="background:#f0fff4;font-size:20px;">🕊</div><div><div class="stat-val" style="color:#276749;">${dec}</div><div class="stat-lbl">Deceased</div></div></div>`;
  }
  const qEl=$('archiveQ');
  const q=(qEl?qEl.value||'':'').toLowerCase();
  const rows=archived
    .filter(e=>{
      const full=`${e.id||''} ${e.surname||''} ${e.given||''} ${e.pos||''} ${e.archiveReason||''}`.toLowerCase();
      return !q||full.includes(q);
    })
    .sort((a,b)=>(a.surname||'').localeCompare(b.surname||''));
  const tbl=$('archiveTbl'); if(!tbl) return;
  tbl.innerHTML=rows.length===0
    ? `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--mu);font-style:italic;">No archived personnel found.</td></tr>`
    : rows.map(e=>{
        const isT=e.status==='Teaching';
        const rKey=(e.archiveReason||'').toLowerCase();
        const reasonColor=rKey.includes('retir')?'#744210':rKey.includes('deceas')?'#276749':rKey.includes('resign')?'#1a365d':'#4a5568';
        const reasonBg=rKey.includes('retir')?'#fefcbf':rKey.includes('deceas')?'#f0fff4':rKey.includes('resign')?'#ebf8ff':'#edf2f7';
        return`<tr style="opacity:.9;">
          <td style="text-align:left;padding-left:10px"><b style="font-family:'JetBrains Mono',monospace;font-size:11px">${e.id}</b></td>
          <td style="text-align:left;font-weight:600;padding-left:10px">${(e.surname||'').toUpperCase()}, ${e.given||''} ${e.suffix||''}</td>
          <td><span class="badge ${isT?'bt':'bnt'}">${e.status}</span></td>
          <td style="text-align:left;padding-left:8px">${(e.pos||'').toUpperCase()}</td>
          <td style="text-align:left;padding-left:8px">${(e.school||'').toUpperCase()}</td>
          <td style="text-align:center;"><span style="font-size:10px;padding:3px 10px;border-radius:20px;font-weight:600;background:${reasonBg};color:${reasonColor};">${e.archiveReason||'Archived'}</span></td>
          <td class="no-print" style="white-space:nowrap;">
            <button class="btn b-pri b-sm" onclick="openArchivedCard('${e.id}')">📂 View</button>
            <button class="btn b-sm" style="background:#276749;color:white;" onclick="promptUnarchive('${e.id}')">♻️ Restore</button>
          </td></tr>`;
      }).join('');
}

function promptArchive(id){
  const e=DB.find(x=>x.id===id);if(!e)return;
  _archiveTargetId=id;
  $('archiveMoName').textContent=`${(e.surname||'').toUpperCase()}, ${e.given||''} ${e.suffix||''}`.trim();
  $('archiveReason').value='';
  $('archiveMo').classList.add('open');
}

function confirmArchive(){
  const e=DB.find(x=>x.id===_archiveTargetId);if(!e)return;
  const reason=$('archiveReason').value;
  api('archive',{employee_id:e.id,reason}).then(res=>{
    if(!res.ok){alert('Archive failed: '+(res.error||'Unknown error'));return;}
    e.archived=true; e.archiveReason=reason;
    closeMo('archiveMo'); _archiveTargetId=null; renderList();
  });
}

function promptUnarchive(id){
  const e=DB.find(x=>x.id===id);if(!e)return;
  _archiveTargetId=id;
  $('unarchiveMoName').textContent=`${(e.surname||'').toUpperCase()}, ${e.given||''} ${e.suffix||''}`.trim();
  $('unarchiveMo').classList.add('open');
}

function confirmUnarchive(){
  const e=DB.find(x=>x.id===_archiveTargetId);if(!e)return;
  api('unarchive',{employee_id:e.id}).then(res=>{
    if(!res.ok){alert('Restore failed: '+(res.error||'Unknown error'));return;}
    e.archived=false; delete e.archiveReason;
    closeMo('unarchiveMo'); _archiveTargetId=null; renderList();
    if($('p-archive').classList.contains('on')) renderArchive();
  });
}
// ─────────────────────────────────────────────────────────────────

function populateFilterDropdowns(){
  const positions=[...new Set(DB.map(e=>(e.pos||'').trim().toUpperCase()).filter(Boolean))].sort();
  const schools=[...new Set(DB.map(e=>(e.school||'').trim().toUpperCase()).filter(Boolean))].sort();
  const fPos=$('fPos'), fSch=$('fSch');
  if(fPos){
    const cur=fPos.value;
    fPos.innerHTML='<option value="">All Positions</option>'+positions.map(p=>`<option value="${p}">${p}</option>`).join('');
    if(positions.includes(cur)) fPos.value=cur;
  }
  if(fSch){
    const cur=fSch.value;
    fSch.innerHTML='<option value="">All Schools/Offices</option>'+schools.map(s=>`<option value="${s}">${s}</option>`).join('');
    if(schools.includes(cur)) fSch.value=cur;
  }
}
function clearListFilters(){
  ['fCat','fPos','fSch','fCard','fAcct'].forEach(id=>{const el=$(id);if(el)el.value='';});
  $('srchQ').value='';
  renderList();
}
function renderList(){
  populateFilterDropdowns();
  renderStats();
  const now=new Date();
  const curMonth=now.getMonth();
  const curYear=now.getFullYear();

  function isUpdatedThisMonth(emp){
    if(!emp.lastEditedAt) return false;
    const dt=new Date(emp.lastEditedAt);
    return dt.getFullYear()===curYear&&dt.getMonth()===curMonth;
  }

  const q=($('srchQ').value||'').toLowerCase();
  const fCat=(($('fCat')||{}).value||'');
  const fPos=(($('fPos')||{}).value||'');
  const fSch=(($('fSch')||{}).value||'');
  const fCard=(($('fCard')||{}).value||'');
  const fAcct=(($('fAcct')||{}).value||'');

  const rows=DB
    .filter(e=>{
      if(fAcct==='active'  && e.account_status==='inactive') return false;
      if(fAcct==='inactive'&& e.account_status!=='inactive') return false;
      const nm=`${e.surname||''} ${e.given||''} ${e.suffix||''}`.toLowerCase();
      if(q && !`${e.id||''} ${nm} ${e.pos||''}`.toLowerCase().includes(q)) return false;
      if(fCat && e.status!==fCat) return false;
      if(fPos && (e.pos||'').trim().toUpperCase()!==fPos) return false;
      if(fSch && (e.school||'').trim().toUpperCase()!==fSch) return false;
      const upd=isUpdatedThisMonth(e);
      if(fCard==='updated'&&!upd) return false;
      if(fCard==='pending'&&upd) return false;
      return true;
    })
    .sort((a,b)=>(a.surname||'').localeCompare(b.surname||''));

  $('pTbl').innerHTML=rows.map(e=>{
    const oi=DB.findIndex(x=>x.id===e.id), isT=e.status==='Teaching';
    const upd=isUpdatedThisMonth(e);
    const updBadge=`<span style="font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:${upd?'#d1fae5':'#fee2e2'};color:${upd?'#065f46':'#9b1c1c'};">${upd?'✅ Updated':'⏳ Pending'}</span>`;
    const isInactive=(e.account_status==='inactive');
    const acctBadge=isInactive
      ? `<span style="font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:#fee2e2;color:#9b1c1c;">🔴 Inactive</span>`
      : `<span style="font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:#d1fae5;color:#065f46;">🟢 Active</span>`;
    return`<tr${isInactive?' style="opacity:.6;"':''}>
      <td style="text-align:center;"><b style="font-family:'JetBrains Mono',monospace;font-size:11px">${e.id}</b></td>
      <td style="text-align:left;font-weight:600;padding-left:10px">${(e.surname||'').toUpperCase()}, ${e.given||''} ${e.suffix||''}</td>
      <td style="text-align:center;"><span class="badge ${isT?'bt':'bnt'}">${e.status}</span></td>
      <td style="text-align:center;">${(e.pos||'').toUpperCase()}</td>
      <td style="text-align:center;">${(e.school||'').toUpperCase()}</td>
      <td style="text-align:center;">${updBadge}</td>
      <td style="text-align:center;">${acctBadge}</td>
      <td class="no-print" style="text-align:center;white-space:nowrap;">
        <button class="btn b-amb" style="height:34px;padding:0 18px;font-size:12px;" onclick="editPI(${oi})">✏ Edit</button>
      </td></tr>`;
  }).join('');
}
/*
  JS — LEAVE CARDS PAGE
*/
let cardsActiveId=null;

function renderCardsSearch(){
  const now=new Date();
  const curMonth=now.getMonth();
  const curYear=now.getFullYear();
  const monthLabel=now.toLocaleString('en-US',{month:'short',year:'numeric'});

  function isUpdatedThisMonth(emp){
    if(!emp.lastEditedAt) return false;
    const dt=new Date(emp.lastEditedAt);
    return dt.getFullYear()===curYear&&dt.getMonth()===curMonth;
  }

  const q=($('cardsQ').value||'').toLowerCase();
  const list=$('cardsEmployeeList');
  if(!list) return;
  const active=DB.filter(e=>!e.archived);
  const matches=q
    ? active.filter(e=>`${e.id||''} ${e.surname||''} ${e.given||''} ${e.suffix||''} ${e.pos||''}`.toLowerCase().includes(q))
    : active;
  const sorted=[...matches].sort((a,b)=>(a.surname||'').localeCompare(b.surname||''));
  if(sorted.length===0){
    list.innerHTML=`<div style="padding:16px 4px;color:var(--mu);font-style:italic;font-size:13px;">No employees found${q?' for "'+$('cardsQ').value+'"':''}.</div>`;
    return;
  }
  list.innerHTML=`<div style="display:flex;flex-wrap:wrap;gap:8px;">`+
    sorted.map(e=>{
      const isT=e.status==='Teaching';
      const isActive=e.id===cardsActiveId;
      const upd=isUpdatedThisMonth(e);
      return`<button onclick="openCardInPage('${e.id}')" style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px;border:1.5px solid ${isActive?'var(--g2)':'var(--br)'};background:${isActive?'var(--g2)':'var(--cd)'};cursor:pointer;font-family:Inter,sans-serif;font-size:12px;font-weight:500;transition:all .15s;">
        <span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;background:${isT?'#ddeeff':'var(--g4)'};color:${isT?'var(--nb)':'var(--g1)'};">${e.status}</span>
        <span style="font-weight:700;color:${isActive?'white':'var(--cha)'};">${(e.surname||'').toUpperCase()}, ${e.given||''} ${e.suffix||''}</span>
        <span style="font-size:10px;color:${isActive?'rgba(255,255,255,.7)':'var(--mu)'};font-family:'JetBrains Mono',monospace;">${e.id}</span>
        <span style="font-size:9px;padding:2px 7px;border-radius:10px;font-weight:700;background:${upd?'#d1fae5':'#fee2e2'};color:${upd?'#065f46':'#9b1c1c'};">${upd?'✅':'⏳'}</span>
      </button>`;
    }).join('')+`</div>`;
}

function openCardInPage(id){
  cardsActiveId=id;
  // Set "from cards" flag so back button returns to leave cards page
  _fromCards=true;
  openCard(id);
}
let _fromCards=false;

let _fromArchive=false;
function backFromCard(){
  document.querySelectorAll('[id^="ntOldEra"],[id^="tOldEra"],[id^="uOldEra"]').forEach(el=>el.remove());
  ['ntTblCard','tTblCard'].forEach(id=>{const el=$(id);if(el)el.classList.remove('era-new-section');});
  const oldBanner=$('archivedBanner');if(oldBanner)oldBanner.remove();
  document.querySelectorAll('.archived-view').forEach(el=>el.classList.remove('archived-view'));
  document.querySelectorAll('.archived-view').forEach(el=>el.classList.remove('archived-view'));
  // Restore entry forms for next normal open
  if($('ntFrm'))$('ntFrm').style.display='none';
  if($('tFrm'))$('tFrm').style.display='none';
  document.querySelectorAll('.sb-item[id^="sbItem"]').forEach(el=>el.classList.remove('active'));
  if(_fromArchive){
    _fromArchive=false;
    if($('sbItemArchive')) $('sbItemArchive').classList.add('active');
    renderArchive(); goPage('archive');
  } else if(_fromCards){
    _fromCards=false;
    if($('sbItemCards')) $('sbItemCards').classList.add('active');
    renderCardsSearch(); goPage('cards');
  } else {
    if($('sbItemList')) $('sbItemList').classList.add('active');
    goPage('list'); renderList();
  }
}
function backToList(){
  _fromCards=false;
  document.querySelectorAll('[id^="ntOldEra"],[id^="tOldEra"],[id^="uOldEra"]').forEach(el=>el.remove());
  ['ntTblCard','tTblCard'].forEach(id=>{const el=$(id);if(el)el.classList.remove('era-new-section');});
  document.querySelectorAll('.sb-item[id^="sbItem"]').forEach(el=>el.classList.remove('active'));
  if($('sbItemList')) $('sbItemList').classList.add('active');
  goPage('list'); renderList();
}
function openArchivedCard(id){
  _fromArchive=true;
  _fromCards=false;
  const e=DB.find(x=>x.id===id); if(!e) return; curId=id;
  document.querySelectorAll('[id^="ntOldEra"],[id^="tOldEra"],[id^="uOldEra"]').forEach(el=>el.remove());
  if(e.status==='Teaching'){
    $('tProf').innerHTML=bProf(e);
    $('tFrm').style.display='none'; // read-only — no entry form
    tClr();renderT(id);goPage('t');
  } else {
    $('ntProf').innerHTML=bProf(e);
    $('ntFrm').style.display='none'; // read-only — no entry form
    ntClr();renderNT(id);goPage('nt');
  }
  // Show archived banner and mark page as archived (hides Action column header)
  const banner=document.createElement('div');
  banner.id='archivedBanner';
  banner.className='no-print';
  banner.style.cssText='background:linear-gradient(90deg,#2d3748,#4a5568);color:white;padding:10px 18px;border-radius:8px;margin-bottom:14px;display:flex;align-items:center;gap:10px;font-size:13px;';
  banner.innerHTML=`<span style="font-size:18px;">🗄</span><span><b>Archived Employee</b> — Reason: <b>${e.archiveReason||'Archived'}</b>. Leave card is read-only. Restore the employee to make edits.</span>`;
  const page=$(e.status==='Teaching'?'p-t':'p-nt');
  const firstChild=page.firstElementChild;
  page.insertBefore(banner, firstChild);
  page.classList.add('archived-view');
}
function openCard(id){
  // Ensure records are loaded from MySQL before rendering
  const _emp = DB.find(x=>x.id===id);
  if(_emp && (!_emp.records || _emp.records.length===0)){
    loadRecords(id).then(()=>_openCardRender(id));
    return;
  }
  _openCardRender(id);
}
function _openCardRender(id){
  const e=DB.find(x=>x.id===id); if(!e) return; curId=id;
  if(!isAdmin){openUserView(e);return;}
  // If archived, open as read-only
  if(e.archived){openArchivedCard(id);return;}
  // Clean up any stale era cards and banners
  document.querySelectorAll('[id^="ntOldEra"],[id^="tOldEra"]').forEach(el=>el.remove());
  const oldBanner=$('archivedBanner');if(oldBanner)oldBanner.remove();
  if(e.status==='Teaching'){
    $('tProf').innerHTML=bProf(e);
    $('tFrm').style.display='block';
    tClr();renderT(id);goPage('t');
    saveSession('t');
  } else {
    $('ntProf').innerHTML=bProf(e);
    $('ntFrm').style.display='block';
    ntClr();renderNT(id);goPage('nt');
    saveSession('nt');
  }
}
function openUserView(e){
  // Always refresh from DB
  const fresh=DB.find(x=>x.id===e.id);
  if(fresh) e=fresh;

  // Set profile and header
  $('uProf').innerHTML=bProf(e);
  const uCardHdr=$('uCardHdr');
  if(uCardHdr){
    if(e.status==='Teaching') uCardHdr.textContent='📋 Teaching Personnel Leave Record (Service Credits)';
    else uCardHdr.textContent='📋 Non-Teaching Personnel Leave Record';
  }

  // Switch to user page first
  goPage('user');

  // Re-use the exact same render engine as admin (renderNT / renderT)
  // by temporarily pointing curId at this employee, rendering,
  // then copying the result into uTbl (stripping edit buttons).
  const savedId=curId;
  curId=e.id;

  // Clean up stale era cards
  document.querySelectorAll('[id^="ntOldEra"],[id^="tOldEra"],[id^="uOldEra"]').forEach(el=>el.remove());

  const isTeaching=e.status==='Teaching';
  if(isTeaching) renderT(e.id); else renderNT(e.id);

  // Copy main table content → uTbl, strip edit/action buttons
  const srcTbl=$(isTeaching?'tTbl':'ntTbl');
  const dst=$('uTbl');
  if(srcTbl&&dst){
    dst.innerHTML=srcTbl.innerHTML;
    dst.querySelectorAll('.no-print').forEach(el=>el.remove());
  }

  // Copy ALL old era wrappers (ntOldEra, ntOldEra_1, ntOldEra_2, ...)
  // They are inserted before tTblCard/ntTblCard in the admin page
  const eraPrefix=isTeaching?'tOldEra':'ntOldEra';
  const uTableCard=$('uTbl').closest('.card');
  // Collect all era wrappers for this card type
  const allEraWrappers=[...document.querySelectorAll('[id^="'+eraPrefix+'"]')];
  allEraWrappers.forEach((oldWrap, wi)=>{
    oldWrap.querySelectorAll('.no-print').forEach(el=>el.remove());
    const uOld=document.createElement('div');
    uOld.id='uOldEra'+(wi>0?'_'+wi:'');
    uOld.className='era-wrapper';
    uOld.innerHTML=oldWrap.innerHTML;
    // Expand all eras so employee can see full history
    uOld.querySelectorAll('.era-old-toggle').forEach(t=>t.classList.add('open'));
    uOld.querySelectorAll('.era-old-body').forEach(b=>b.classList.add('open'));
    if(uTableCard) uTableCard.parentNode.insertBefore(uOld, uTableCard);
    oldWrap.remove();
  });

  // Restore curId and clean up admin tables
  curId=savedId;
  $('ntTbl').innerHTML=''; $('tTbl').innerHTML='';
  document.querySelectorAll('[id^="ntOldEra"],[id^="tOldEra"]').forEach(el=>el.remove());
}
function bProf(e){
  const uc=v=>v?(v+'').toUpperCase():'—';
  const dt=v=>v?fmtD(v):'—';
  const fi=(l,v,s=1)=>`<div class="pi" ${s>1?`style="grid-column:span ${s}"`:''}><label>${l}</label><span>${uc(v)}</span></div>`;
  const fd=(l,v,s=1)=>`<div class="pi" ${s>1?`style="grid-column:span ${s}"`:''}><label>${l}</label><span>${dt(v)}</span></div>`;
  return fi('Surname',e.surname)+fi('Given Name',e.given)+fi('Suffix',e.suffix)+fi('Maternal Surname',e.maternal)+
    fi('Sex',e.sex)+fi('Civil Status',e.civil)+fd('Date of Birth',e.dob)+fi('Place of Birth',e.pob)+
    fi('Present Address',e.addr,2)+fi('Name of Spouse',e.spouse,2)+
    fi('Educational Qualification',e.edu,2)+fi('C.S. Eligibility: Kind of Exam',e.elig,2)+
    fi('Rating',e.rating)+fi('TIN Number',e.tin)+fi('Place of Exam',e.pexam)+fd('Date of Exam',e.dexam)+
    `<div class="pi"><label>Employee Number</label><span><b style="font-family:'JetBrains Mono',monospace">${e.id||'—'}</b></span></div>`+
    fd('Date of Original Appointment',e.appt)+fi('Position',e.pos)+fi('School / Office',e.school,2);
}

/*
  JS 6 — ADMIN PROFILE MODAL
*/
function updateAdminChip(){
  const n = isEncoder ? (encoderCfg.name||'Encoder') : (adminCfg.name||'Administrator');
  $('sbAv').textContent=n.charAt(0).toUpperCase();
  $('sbName').textContent=n;
}
function openAdminProfile(){
  loadAdminCfg().then(()=>{
    $('apName').value=adminCfg.name||'';
    $('apID').value=adminCfg.id||'';
    $('apPw').value='';$('apPw2').value='';
    $('apErr').style.display='none';
    // Encoder section — always shown so admin can manage it
    const encSec=$('apEncSection');
    if(encSec){
      $('apEncName').value=encoderCfg.name||'';
      $('apEncID').value=encoderCfg.id||'';
      $('apEncPw').value='';
      // Hide encoder section from encoder themselves (they use encoderMo)
      encSec.style.display=isEncoder?'none':'';
    }
    // School Admin section — only for true admin
    const saSec=$('apSASection');
    if(saSec) saSec.style.display=isEncoder?'none':'';
    if(!isEncoder){
      closeSAInlineForm();
      loadAndRenderSAAccounts();
    }
    $('adminMo').classList.add('open');
  });
}
function saveAdminProfile(){
  const name=$('apName').value.trim(),newID=$('apID').value.trim(),pw1=$('apPw').value,pw2=$('apPw2').value;
  $('apErr').style.display='none';
  if(!name){showErr('apErr','Display name cannot be empty.');return;}
  if(!newID){showErr('apErr','Login ID cannot be empty.');return;}
  if(!newID.endsWith('@deped.gov.ph')){showErr('apErr','Login ID must use @deped.gov.ph domain (e.g. admin@deped.gov.ph).');return;}
  if(pw1||pw2){if(pw1!==pw2){showErr('apErr','Passwords do not match.');return;}if(pw1.length<4){showErr('apErr','Min 4 characters.');return;}adminCfg.password=pw1;}
  adminCfg.name=name;adminCfg.id=newID;
  if(pw1) adminCfg.password=pw1;
  const encName=$('apEncName').value.trim();
  const encID=$('apEncID').value.trim();
  const encPw=$('apEncPw').value;
  if(encName) encoderCfg.name=encName;
  if(encID){
    if(!encID.endsWith('@deped.gov.ph')){showErr('apErr','Encoder Login ID must use @deped.gov.ph domain.');return;}
    encoderCfg.id=encID;
  }
  if(encPw&&encPw.length>=4) encoderCfg.password=encPw;
  api('save_admin',{
    name,login_id:newID,...(pw1?{password:pw1}:{}),
    ...(encName?{enc_name:encName}:{}),
    ...(encID?{enc_login_id:encID}:{}),
    ...(encPw&&encPw.length>=4?{enc_password:encPw}:{})
  }).then(res=>{
    if(!res.ok){showErr('apErr','Save failed: '+(res.error||'Unknown error'));return;}
    purgeAdminFromDB();updateAdminChip();closeMo('adminMo');
  });
}
// Encoder profile — can only change display name, NOT username/password
function openEncoderProfile(){
  $('encProfName').value=encoderCfg.name||'';
  $('encProfErr').style.display='none';
  $('encoderMo').classList.add('open');
}
function saveEncoderProfile(){
  const name=$('encProfName').value.trim();
  $('encProfErr').style.display='none';
  if(!name){$('encProfErr').textContent='Display name cannot be empty.';$('encProfErr').style.display='block';return;}
  encoderCfg.name=name;
  api('save_encoder',{name}).then(res=>{
    if(!res.ok){$('encProfErr').textContent='Save failed.';$('encProfErr').style.display='block';return;}
    updateAdminChip();closeMo('encoderMo');
  });
}

/* ══════════════════════════════════════
   SCHOOL ADMIN — Account Management (Admin only)
══════════════════════════════════════ */
let _saAccounts = []; // cached list of school admin accounts

async function loadAndRenderSAAccounts(){
  const res = await api('get_school_admins');
  if(!res.ok) return;
  _saAccounts = res.school_admins || [];
  renderSAAccounts();
}

function renderSAAccounts(){
  const el=$('saAccountsList'); if(!el) return;
  if(_saAccounts.length===0){
    el.innerHTML=`<p style="font-size:11.5px;color:#7c3aed;font-style:italic;padding:4px 0 8px;">No school admin accounts yet. Add one below.</p>`;
    return;
  }
  el.innerHTML=_saAccounts.map(sa=>`
    <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:white;border:1px solid #ddd6fe;border-radius:8px;margin-bottom:7px;">
      <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);color:white;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0;">${(sa.name||'S')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:700;color:#5b21b6;">${sa.name||''}</div>
        <div style="font-size:10.5px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sa.login_id||''}</div>
      </div>
      <button class="btn b-sm" style="background:#7c3aed;color:white;flex-shrink:0;" onclick="openSAInlineForm(${sa.id})">✏ Edit</button>
      <button class="btn b-sm b-red" style="flex-shrink:0;" onclick="deleteSAAccount(${sa.id},'${(sa.name||'').replace(/'/g,"\\'")}')">🗑</button>
    </div>`).join('');
}

// Open the inline form inside the admin modal — 0 = new, id = edit existing
function openSAInlineForm(dbId){
  const form=$('saInlineForm'); if(!form) return;
  const sa = dbId>0 ? _saAccounts.find(x=>x.id===dbId) : null;
  $('saInlineDbId').value = dbId;
  $('saInlineTitle').textContent = dbId>0 ? `✏️ Edit: ${sa?sa.name:''}` : '➕ New School Admin';
  $('saInlineName').value  = sa ? sa.name||''     : '';
  $('saInlineEmail').value = sa ? sa.login_id||'' : '';
  $('saInlinePw').value    = '';
  $('saInlinePwLabel').innerHTML = dbId>0
    ? 'New Password <span style="color:var(--mu);font-size:10px;">(blank = keep current)</span>'
    : 'Password <span style="color:#e53e3e;font-size:10px;">*</span>';
  $('saInlineErr').style.display='none';
  form.style.display='block';
  const addBtn=$('saAddBtn'); if(addBtn) addBtn.style.display='none';
  $('saInlineName').focus();
}

function closeSAInlineForm(){
  const form=$('saInlineForm'); if(form) form.style.display='none';
  const addBtn=$('saAddBtn'); if(addBtn) addBtn.style.display='';
}

function saveSAInline(){
  const dbId   = parseInt($('saInlineDbId').value)||0;
  const name   = $('saInlineName').value.trim();
  const loginId= $('saInlineEmail').value.trim().toLowerCase();
  const pw     = $('saInlinePw').value;
  const errEl  = $('saInlineErr');
  errEl.style.display='none';

  if(!name)   { errEl.textContent='Display name is required.';       errEl.style.display='block'; return; }
  if(!loginId){ errEl.textContent='Login email is required.';        errEl.style.display='block'; return; }
  if(!loginId.endsWith('@deped.gov.ph')){ errEl.textContent='Email must use @deped.gov.ph domain.'; errEl.style.display='block'; return; }
  if(dbId===0&&!pw){ errEl.textContent='Password is required for new accounts.'; errEl.style.display='block'; return; }

  api('save_school_admin',{sa_id:dbId, name, login_id:loginId, ...(pw?{password:pw}:{})}).then(res=>{
    if(!res.ok){ errEl.textContent=res.error||'Save failed.'; errEl.style.display='block'; return; }
    closeSAInlineForm();
    loadAndRenderSAAccounts();
  });
}

function deleteSAAccount(dbId, name){
  if(!confirm(`Delete school admin account for "${name}"?\nThis cannot be undone.`)) return;
  api('delete_school_admin',{sa_id:dbId}).then(res=>{
    if(!res.ok){alert('Delete failed: '+(res.error||'Unknown error'));return;}
    // If the inline form was open for this record, close it
    if(parseInt(($('saInlineDbId')||{}).value||0)===dbId) closeSAInlineForm();
    loadAndRenderSAAccounts();
  });
}

// ── keep backward-compat stubs for old modal references (now unused) ──
function openAddSAModal(){ openSAInlineForm(0); }
function openEditSAModal(id){ openSAInlineForm(id); }
function saveSAAccount(){ saveSAInline(); }

/* ══════════════════════════════════════
   SCHOOL ADMIN — Self Profile
══════════════════════════════════════ */
function openSAProfile(){
  $('saProfName').value=schoolAdminCfg.name||'';
  $('saProfErr').style.display='none';
  $('saProfMo').classList.add('open');
}

function saveSAProfile(){
  const name=$('saProfName').value.trim();
  const errEl=$('saProfErr');
  errEl.style.display='none';
  if(!name){errEl.textContent='Display name cannot be empty.';errEl.style.display='block';return;}
  api('save_school_admin',{sa_id:schoolAdminCfg.dbId,name,login_id:schoolAdminCfg.id}).then(res=>{
    if(!res.ok){errEl.textContent='Save failed: '+(res.error||'');errEl.style.display='block';return;}
    schoolAdminCfg.name=name;
    $('sbAv').textContent=name[0].toUpperCase();
    $('sbName').textContent=name;
    saveSession('sa');
    closeMo('saProfMo');
  });
}

/* ══════════════════════════════════════
   SCHOOL ADMIN — Personnel List Dashboard
══════════════════════════════════════ */
function clearSAFilters(){
  ['saCat','saAcct'].forEach(id=>{const el=$(id);if(el)el.value='';});
  const q=$('saSrchQ');if(q)q.value='';
  renderSAList();
}

function renderSAStats(){
  const active=DB.filter(e=>!e.archived);
  const el=$('saStatsRow'); if(!el) return;
  el.innerHTML=`
    <div class="stat-box"><div class="stat-icon si-g">👥</div><div><div class="stat-val">${active.length}</div><div class="stat-lbl">Total Personnel</div></div></div>
    <div class="stat-box"><div class="stat-icon si-b">📚</div><div><div class="stat-val">${active.filter(e=>e.status==='Teaching').length}</div><div class="stat-lbl">Teaching</div></div></div>
    <div class="stat-box"><div class="stat-icon si-a">🏢</div><div><div class="stat-val">${active.filter(e=>e.status==='Non-Teaching').length}</div><div class="stat-lbl">Non-Teaching</div></div></div>`;
}

function renderSAList(){
  renderSAStats();
  const q=(($('saSrchQ')||{}).value||'').toLowerCase();
  const fCat=(($('saCat')||{}).value||'');
  const fAcct=(($('saAcct')||{}).value||'');
  const rows=DB
    .filter(e=>{
      if(fAcct==='active'  && e.account_status==='inactive') return false;
      if(fAcct==='inactive'&& e.account_status!=='inactive') return false;
      if(fCat && e.status!==fCat) return false;
      const nm=`${e.surname||''} ${e.given||''} ${e.suffix||''}`.toLowerCase();
      if(q && !`${e.id||''} ${nm} ${e.pos||''}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a,b)=>(a.surname||'').localeCompare(b.surname||''));

  const tbl=$('saTbl'); if(!tbl) return;
  tbl.innerHTML=rows.length===0
    ? `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--mu);font-style:italic;">No personnel found.</td></tr>`
    : rows.map((e,ri)=>{
        const oi=DB.findIndex(x=>x.id===e.id);
        const isT=e.status==='Teaching';
        const isInactive=(e.account_status==='inactive');
        const acctBadge=isInactive
          ? `<span style="font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:#fee2e2;color:#9b1c1c;">🔴 Inactive</span>`
          : `<span style="font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:#d1fae5;color:#065f46;">🟢 Active</span>`;
        return`<tr${isInactive?' style="opacity:.6;"':''}>
          <td style="text-align:center;"><b style="font-family:'JetBrains Mono',monospace;font-size:11px">${e.id}</b></td>
          <td style="text-align:left;font-weight:600;padding-left:10px">${(e.surname||'').toUpperCase()}, ${e.given||''} ${e.suffix||''}</td>
          <td style="text-align:center;"><span class="badge ${isT?'bt':'bnt'}">${e.status}</span></td>
          <td style="text-align:center;">${(e.pos||'').toUpperCase()}</td>
          <td style="text-align:center;">${(e.school||'').toUpperCase()}</td>
          <td style="text-align:center;">${acctBadge}</td>
          <td class="no-print" style="text-align:center;">
            <button class="btn b-amb" style="height:34px;padding:0 18px;font-size:12px;" onclick="editPI(${oi})">✏ Edit</button>
          </td></tr>`;
      }).join('');
}
function showErr(id,msg){$(id).textContent=msg;$(id).style.display='block';}

/*
  JS 7 — SHARED LEAVE BALANCE LOGIC
  ─────────────────────────────────
  LEAVE TYPE CLASSIFICATION (updated):
  ─────────────────────────────────
  isAcc      : Monthly Accrual / Service Credits → adds to balance
  isMon      : Monetization → deducts both Col A & B (NT) or single balance (T)
  isMD       : Monetization (disapproved) → adds back
  isDis      : Force Leave (disapproved), other (disapproved) → no change
  isSick     : Sick Leave → deducts Col B balance (or single balance for T)
  isForce    : Mandatory/Force Leave → Col A, Abs W/P, NO deduction
  isPer      : Personal Leave → Abs W/O P Col A, no deduction
  isTerminal : Terminal Leave → both Col A and Col B Abs W/P, no deduction
  isSetB_noDeduct: Maternity, Paternity → Col B Abs W/P, no deduction
  isSetA_noDeduct: Solo Parent, Wellness, SPL, Rehab, Study, Magna Carta,
                   VAWC, CTO → Col A Abs W/P, no deduction
  isVacation : Vacation → Col A, deducts balance
*/
let _delEraConvIdx=-1;
function confirmDeleteEra(convIdx){
  _delEraConvIdx=convIdx;
  $('delEraEmail').value=''; $('delEraPw').value='';
  $('delEraErr').style.display='none';
  $('deleteEraMo').classList.add('open');
}
function doDeleteEra(){
  const email=$('delEraEmail').value.trim().toLowerCase();
  const pw=$('delEraPw').value;
  const adminOk=email===(adminCfg.id||'').toLowerCase()&&pw===adminCfg.password;
  const encoderOk=email===(encoderCfg.id||'').toLowerCase()&&pw===encoderCfg.password;
  if(!adminOk&&!encoderOk){
    $('delEraErr').textContent='Incorrect credentials. Please try again.';
    $('delEraErr').style.display='block';
    return;
  }
  deleteConversionEra(_delEraConvIdx);
  closeMo('deleteEraMo');
  _delEraConvIdx=-1;
}
function deleteConversionEra(convIdx){
  const e=DB.find(x=>x.id===curId); if(!e||!e.records) return;
  const records=e.records;
  const conv=records[convIdx];
  if(!conv||!conv._conversion) return;

  // Find the end of this era's records (next _conversion or end of array)
  let eraEnd=records.length;
  for(let i=convIdx+1;i<records.length;i++){
    if(records[i]._conversion){eraEnd=i;break;}
  }

  // Only block if this era has genuinely filled entries
  const eraRecs=records.slice(convIdx+1, eraEnd).filter(r=>!r._conversion && !isEmptyRecord(r));
  if(eraRecs.length>0){alert('Cannot delete an era that has entries. Remove all entries first.');return;}

  // Find the previous conversion (if any) to bridge fromStatus
  let prevConv=null;
  for(let i=convIdx-1;i>=0;i--){
    if(records[i]._conversion){prevConv=records[i];break;}
  }

  // Bridge: update the next conversion's fromStatus to skip over the deleted era
  if(eraEnd<records.length && records[eraEnd] && records[eraEnd]._conversion){
    // The next era should now come from whatever preceded this deleted era
    records[eraEnd].fromStatus = prevConv ? prevConv.toStatus : conv.fromStatus;
  }

  // Remove the conversion marker AND all blank placeholder rows in this era
  records.splice(convIdx, eraEnd-convIdx);

  // IMPORTANT: do NOT change e.status
  sv();
  if(e.status==='Teaching') renderT(curId); else renderNT(curId);
}

function isEmptyRecord(r){
  if(r._conversion) return false;
  return !r.action && !r.so && !r.prd && !r.from && !r.to && !r.spec
    && !(r.earned>0) && !(r.forceAmount>0) && !(r.monAmount>0) && !(r.monDisAmt>0)
    && !(r.monV>0) && !(r.monS>0);
}
function deleteRecord(idx){
  const e=DB.find(x=>x.id===curId); if(!e||!e.records) return;
  const r=e.records[idx];
  if(!r||!isEmptyRecord(r)) return; // safety: only delete truly empty rows
  e.records.splice(idx,1);
  sv();
  // Re-render the right card
  if(e.status==='Teaching') renderT(curId); else renderNT(curId);
}
/* ══════════════════════════════
   DATE SORT + ROW MANAGEMENT
═══════════════════════════════ */
function recordSortKey(r){
  if(r._conversion) return null;
  // Use stored from date (always ISO internally)
  let d = r.from || r.to || '';
  if(d){
    if(/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // ISO
    // mm/dd/yyyy → YYYY-MM-DD
    const parts = d.split('/');
    if(parts.length===3 && parts[2].length===4)
      return `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
  }
  // Fall back to prd field only if no from/to date
  const prd = (r.prd||'').trim();
  if(prd){
    if(/^\d{4}$/.test(prd)) return `${prd}-01-01`; // year-only e.g. "2023"
    const yearMatch = prd.match(/\b(19\d{2}|20\d{2})\b/g);
    const year = yearMatch ? yearMatch[yearMatch.length-1] : null;
    if(year){
      const monthMatch = prd.match(/(?:^|[,\s])(\d{1,2})[\/\-]/);
      const month = monthMatch ? monthMatch[1].padStart(2,'0') : '01';
      const dayMatch = prd.match(/(?:^|[,\s])\d{1,2}[\/\-](\d{1,2})/);
      const day = dayMatch ? dayMatch[1].padStart(2,'0') : '01';
      return `${year}-${month}-${day}`;
    }
  }
  return null; // no date — do not move this record
}
function sortRecordsByDate(records){
  // Within each era segment, sort ONLY records that have a parseable date.
  // Records with no date stay exactly where they are.
  const convIdxs=[];
  records.forEach((r,i)=>{if(r._conversion)convIdxs.push(i);});
  const segStarts=[0,...convIdxs.map(i=>i+1)];
  const segEnds=[...convIdxs,records.length];

  segStarts.forEach((start,si)=>{
    const end=segEnds[si];

    // Separate dated and undated records within this segment, keeping original positions
    const datedPositions=[]; // indices (relative to records[]) that have a date
    const undatedPositions=[]; // indices that have no date
    for(let i=start;i<end;i++){
      if(recordSortKey(records[i])!==null) datedPositions.push(i);
      else undatedPositions.push(i);
    }
    if(datedPositions.length<2) return; // nothing to sort

    // Extract the dated records and sort them oldest → newest
    const datedRecs=datedPositions.map(i=>records[i]);
    datedRecs.sort((a,b)=>{
      const ka=recordSortKey(a), kb=recordSortKey(b);
      return ka.localeCompare(kb);
    });

    // Put sorted dated records back into their original positions
    // (undated records remain untouched at their own positions)
    datedPositions.forEach((pos,i)=>{ records[pos]=datedRecs[i]; });
  });
}

// Close any open row menu
function closeAllRowMenus(){
  document.querySelectorAll('.row-menu-dd.open').forEach(m=>m.classList.remove('open'));
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.row-menu-wrap'))closeAllRowMenus();
});

function openRowMenu(btn, idx, type){
  closeAllRowMenus();
  const dd=btn.nextElementSibling;
  if(!dd)return;
  const rect=btn.getBoundingClientRect();
  const menuH=100; // estimated dropdown height
  const spaceBelow=window.innerHeight-rect.bottom;
  // Open upward if not enough space below
  if(spaceBelow<menuH+8){
    dd.style.top='';
    dd.style.bottom=(window.innerHeight-rect.top+4)+'px';
  } else {
    dd.style.bottom='';
    dd.style.top=(rect.bottom+4)+'px';
  }
  dd.style.left=Math.min(rect.left, window.innerWidth-170)+'px';
  dd.classList.add('open');
}

function addRowBelow(idx, type){
  closeAllRowMenus();
  const e=DB.find(x=>x.id===curId);if(!e||!e.records)return;
  const emptyRow={so:'',prd:'',from:'',to:'',spec:'',action:'',earned:0,
    forceAmount:0,monV:0,monS:0,monDV:0,monDS:0,monAmount:0,monDisAmt:0,trV:0,trS:0};
  e.records.splice(idx+1,0,emptyRow);
  sv();
  if(type==='t')renderT(curId);else renderNT(curId);
}

function deleteAnyRow(idx, type){
  closeAllRowMenus();
  const e=DB.find(x=>x.id===curId);if(!e||!e.records)return;
  const r=e.records[idx];
  if(!r||r._conversion)return;
  if(!confirm('Delete this row? This cannot be undone.'))return;
  const recId=e.records[idx]._record_id||null;
  e.records.splice(idx,1);
  if(recId) api('delete_record',{employee_id:curId,record_id:recId});
  if(type==='t')renderT(curId);else renderNT(curId);
}

let _delRowIdx=-1, _delRowType='';
function promptDeleteRow(idx, type){
  closeAllRowMenus();
  _delRowIdx=idx; _delRowType=type;
  $('delRowEmail').value=''; $('delRowPw').value='';
  $('delRowErr').style.display='none';
  $('deleteRowMo').classList.add('open');
}
function confirmDeleteRow(){
  const email=$('delRowEmail').value.trim().toLowerCase();
  const pw=$('delRowPw').value;
  const adminOk=email===(adminCfg.id||'').toLowerCase()&&pw===adminCfg.password;
  const encoderOk=email===(encoderCfg.id||'').toLowerCase()&&pw===encoderCfg.password;
  if(!adminOk&&!encoderOk){
    $('delRowErr').textContent='Incorrect credentials. Please try again.';
    $('delRowErr').style.display='block';
    return;
  }
  const e=DB.find(x=>x.id===curId);
  if(e&&e.records&&_delRowIdx>=0&&_delRowIdx<e.records.length){
    const r=e.records[_delRowIdx];
    if(r&&!r._conversion){
      const recId=r._record_id||null;
      e.records.splice(_delRowIdx,1);
      e.lastEditedAt=new Date().toISOString();
      if(recId) api('delete_record',{employee_id:curId,record_id:recId});
    }
  }
  closeMo('deleteRowMo');
  if(_delRowType==='t')renderT(curId);else renderNT(curId);
  persistRowBalances(curId);
  _delRowIdx=-1; _delRowType='';
}

function rowMenuHTML(idx, type, isEmpty){
  return `<td class="no-print" style="text-align:center;padding:0 4px;">
    <div class="row-menu-wrap">
      <button class="row-menu-btn" onclick="event.stopPropagation();openRowMenu(this,${idx},'${type}')" title="Row actions">⋮</button>
      <div class="row-menu-dd">
        <button onclick="closeAllRowMenus();openEditMo('${type}',${idx})">✏️ Edit Row</button>
        <button onclick="addRowBelow(${idx},'${type}')">➕ Add Row Below</button>
        <div class="menu-div"></div>
        <button class="danger" onclick="promptDeleteRow(${idx},'${type}')">🗑️ Delete Row</button>
      </div>
    </div>
  </td>`;
}

function classifyLeave(act){
  const a=act.toLowerCase();
  return {
    isAcc:   a.includes('accrual')||a.includes('service credit'),
    isMon:   a.includes('monetization')&&!a.includes('disapproved'),
    isMD:    a.includes('monetization')&&a.includes('disapproved'),
    isDis:   a.includes('(disapproved)')&&!(a.includes('monetization')&&a.includes('disapproved')),
    isSick:  a.includes('sick'),
    // Force/Mandatory → now Set A
    isForce: (a.includes('force')||a.includes('mandatory'))&&!a.includes('(disapproved)'),
    isPer:   a.includes('personal'),
    isTransfer: a.includes('from denr'),
    // Terminal Leave → both Set A and Set B
    isTerminal: a.includes('terminal'),
    // Set B no-deduct: maternity, paternity only
    isSetB_noDeduct: a.includes('maternity')||a.includes('paternity'),
    // Set A no-deduct: solo parent, wellness, spl, rehabilitation, study, magna carta, vawc, cto
    isSetA_noDeduct: a.includes('solo parent')||a.includes('wellness')||
                     a.includes('special privilege')||a.includes('spl')||
                     a.includes('rehabilitation')||a.includes('study')||
                     a.includes('magna carta')||a.includes('vawc')||
                     a.includes('cto')||a.includes('compensatory'),
    isVacation: a.includes('vacation')&&!a.includes('(disapproved)'),
  };
}
function calcDays(r){
  const a=(r.action||'').toLowerCase();
  const isForceAction=(a.includes('force')||a.includes('mandatory'))&&!a.includes('(disapproved)');
  if(isForceAction&&r.forceAmount>0) return r.forceAmount;
  if(r.from&&r.to){
    // Count only weekdays (Mon–Fri), excluding Sat & Sun
    let count=0;
    const start=new Date(r.from+'T00:00:00');
    const end=new Date(r.to+'T00:00:00');
    if(end<start) return 0; // reversed dates guard
    for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
      const day=d.getDay(); // 0=Sun,6=Sat
      if(day!==0&&day!==6) count++;
    }
    return count;
  }
  return 0;
}

/*
  JS 8 — NON-TEACHING LEAVE
*/
function ntNC(v){
  const vl=v.toLowerCase(),m=vl.includes('monetization')&&!vl.includes('disapproved'),md=vl.includes('monetization')&&vl.includes('disapproved'),tr=vl.includes('from denr');
  $('ntMF').style.display=m?'block':'none';$('ntMDF').style.display=md?'block':'none';$('ntTrF').style.display=tr?'block':'none';
}
function ntClr(){
  ['nSO','nPrd','nAct','nActNote','nFr','nTo','nErn','nForce','nMV','nMS','nMDV','nMDS','nTrV','nTrS'].forEach(id=>$(id).value='');
  ['nFrPick','nToPick'].forEach(id=>{if($(id)){$(id).value='';$(id).min='';}});
  $('ntMF').style.display='none';$('ntMDF').style.display='none';$('ntTrF').style.display='none';
  ntEI=-1;$('ntSvBtn').innerText='💾 Save Entry';
}
function ntSv(){
  const e=DB.find(x=>x.id===curId);
  const baseAv=$('nAct').value.trim(), noteV=$('nActNote').value.trim();
  const av = baseAv && noteV ? `${baseAv}, ${noteV}` : (baseAv||noteV);
  const al=av.toLowerCase();
  const m=al.includes('monetization')&&!al.includes('disapproved'),md=al.includes('monetization')&&al.includes('disapproved');
  const isTr=al.includes('from denr');
  const d={so:$('nSO').value,prd:$('nPrd').value,from:toISODate($('nFr').value),to:toISODate($('nTo').value),
    spec:'',action:av,earned:parseFloat($('nErn').value)||0,
    monV:m?parseFloat($('nMV').value)||0:0, monS:m?parseFloat($('nMS').value)||0:0,
    monDV:md?parseFloat($('nMDV').value)||0:0, monDS:md?parseFloat($('nMDS').value)||0:0,
    forceAmount:(al.includes('force')||al.includes('mandatory'))?(parseFloat($('nForce').value)||0):0,
    trV:isTr?parseFloat($('nTrV').value)||0:0, trS:isTr?parseFloat($('nTrS').value)||0:0,
    monAmount:0,monDisAmt:0};
  // Reversed date guard
  if(d.from&&d.to&&d.from>d.to){alert('⚠️ "Date From" cannot be later than "Date To". Please correct the date range.');return;}
  if(!e.records)e.records=[];
  const valErr=validateLeaveEntry(e.records,d,ntEI);
  if(valErr){alert(valErr);return;}
  const isEdit=(ntEI>-1);
  const existingId=isEdit?(e.records[ntEI]._record_id||null):null;
  if(isEdit){e.records[ntEI]=d;}else{e.records.push(d);}
  sortRecordsByDate(e.records);
  e.lastEditedAt=new Date().toISOString();
  const savePromise = isEdit&&existingId
    ? api('update_record',{employee_id:curId,record_id:existingId,record:d})
    : api('save_record',{employee_id:curId,record:d});
  savePromise.then(res=>{
    if(!res.ok){alert('Save failed: '+(res.error||'Unknown error'));return;}
    if(!isEdit&&res.record_id) d._record_id=res.record_id;
    ntClr(); renderNT(curId);
    persistRowBalances(curId);
  });
}
function ntEditR(i){ openEditMo('nt',i); }
// ── Universal Edit Modal ────────────────────────────────────────
let _editType='',_editIdx=-1;
function eRNC(v){
  const vl=v.toLowerCase();
  const m=vl.includes('monetization')&&!vl.includes('disapproved');
  const md=vl.includes('monetization')&&vl.includes('disapproved');
  const tr=vl.includes('from denr');
  $('eRMF').style.display=m?'block':'none';
  $('eRMDF').style.display=md?'block':'none';
  $('eRTrF').style.display=tr?'block':'none';
}
function openEditMo(type,i){
  const e=DB.find(x=>x.id===curId);if(!e)return;
  const r=e.records[i];if(!r||r._conversion)return;
  _editType=type;_editIdx=i;  const knownActions=['Vacation Leave',
    'Mandatory/Force Leave','Sick Leave','Personal Leave','Compensatory Time Off (CTO)',
    'Maternity Leave','Paternity Leave','Special Privilege Leave (SPL)','Solo Parent Leave',
    'Study Leave','Rehabilitation Leave','Wellness Leave',
    'Special Leave Benefits for Women (Magna Carta)',
    'Violence Against Women and Children (VAWC) Leave','Terminal Leave',
    'Monetization','Monetization (disapproved)','Force Leave (disapproved)',
    'From DENR Region 12'];
  let baseA=r.action||'',noteA='';
  for(const ka of knownActions){
    if(baseA.startsWith(ka)){noteA=baseA.slice(ka.length).replace(/^,\s*/,'');baseA=ka;break;}
  }
  $('eRSO').value=r.so||'';$('eRPrd').value=r.prd||'';
  $('eRFr').value=fmtD(r.from||'');$('eRTo').value=fmtD(r.to||'');
  syncDatePicker('eRFr','eRFrPick'); syncDatePicker('eRTo','eRToPick');
  // Enforce min date on To picker based on current From value
  const frISO=toISODate($('eRFr').value);
  if(frISO && $('eRToPick')) $('eRToPick').min=frISO;
  $('eRAct').value=baseA;$('eRActNote').value=noteA;
  $('eRErn').value=r.earned||'';$('eRForce').value=r.forceAmount||'';
  $('eRMV').value=r.monV||'';$('eRMS').value=r.monS||'';
  $('eRMDV').value=r.monDV||'';$('eRMDS').value=r.monDS||'';
  $('eRMon').value=r.monAmount||'';$('eRMonDis').value=r.monDisAmt||'';
  $('eRTrV').value=r.trV||'';$('eRTrS').value=r.trS||'';
  eRNC(baseA);
  $('editRecMo').classList.add('open');
}
function saveEditMo(){
  const e=DB.find(x=>x.id===curId);if(!e||_editIdx<0)return;
  const baseAv=$('eRAct').value.trim(),noteV=$('eRActNote').value.trim();
  const av=baseAv&&noteV?`${baseAv}, ${noteV}`:(baseAv||noteV);
  const al=av.toLowerCase();
  const m=al.includes('monetization')&&!al.includes('disapproved');
  const md=al.includes('monetization')&&al.includes('disapproved');
  const isTr=al.includes('from denr');
  const newRec={
    so:$('eRSO').value,prd:$('eRPrd').value,
    from:toISODate($('eRFr').value),to:toISODate($('eRTo').value),
    spec:e.records[_editIdx].spec||'',action:av,
    earned:parseFloat($('eRErn').value)||0,
    forceAmount:(av.toLowerCase().includes('force')||av.toLowerCase().includes('mandatory'))?(parseFloat($('eRForce').value)||0):0,
    monV:m?parseFloat($('eRMV').value)||0:0,
    monS:m?parseFloat($('eRMS').value)||0:0,
    monDV:md?parseFloat($('eRMDV').value)||0:0,
    monDS:md?parseFloat($('eRMDS').value)||0:0,
    monAmount:m?parseFloat($('eRMon').value)||0:0,
    monDisAmt:md?parseFloat($('eRMonDis').value)||0:0,
    trV:isTr?parseFloat($('eRTrV').value)||0:0,
    trS:isTr?parseFloat($('eRTrS').value)||0:0
  };
  const valErrE=validateLeaveEntry(e.records,newRec,_editIdx);
  if(valErrE){alert(valErrE);return;}
  // Reversed date guard
  if(newRec.from&&newRec.to&&newRec.from>newRec.to){alert('⚠️ "Date From" cannot be later than "Date To". Please correct the date range.');return;}
  const recId=e.records[_editIdx]._record_id||null;
  e.records[_editIdx]=newRec;
  if(recId) newRec._record_id=recId;
  e.lastEditedAt=new Date().toISOString();
  sortRecordsByDate(e.records);
  const saveP=recId
    ? api('update_record',{employee_id:curId,record_id:recId,record:newRec})
    : api('save_record',{employee_id:curId,record:newRec});
  saveP.then(res=>{
    if(!res.ok){alert('Save failed: '+(res.error||'Unknown error'));return;}
    closeMo('editRecMo');
    if(_editType==='t')renderT(curId);else renderNT(curId);
    persistRowBalances(curId);
    _editType='';_editIdx=-1;
  });
}
// ────────────────────────────────────────────────────────────────

// Sync text date input → date picker (mm/dd/yyyy → YYYY-MM-DD)
// If this is a "From" picker, also update the paired "To" picker's min date.
function syncDatePicker(textId, pickId){
  const txt=$(textId).value;
  const iso=toISODate(txt);
  if(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)){
    $(pickId).value=iso;
    // If this is a From picker, set the min date on the corresponding To picker
    _applyFromMinToTo(textId, iso);
  }
}
// Sync date picker → text input (YYYY-MM-DD → mm/dd/yyyy)
// Also enforces that the To date cannot be earlier than the From date.
function syncFromPicker(pickId, textId){
  const iso=$(pickId).value;
  if(!iso) return;
  // If this is a To picker, enforce min = From date
  const minVal=$(pickId).min||'';
  if(minVal && iso < minVal){
    alert('⚠️ "Date To" cannot be earlier than "Date From". Please select a valid date.');
    $(pickId).value=minVal; // reset to minimum allowed
    $(textId).value=fmtD(minVal);
    return;
  }
  $(textId).value=fmtD(iso);
  // If this is a From picker, propagate min to matching To picker
  _applyFromMinToTo(textId, iso);
}
// Internal helper: given a From text-field id and an ISO date,
// find the corresponding To picker and set its min attribute.
function _applyFromMinToTo(fromTextId, isoDate){
  const pairs={
    'nFr':'nToPick',   // NT form: From → To picker
    'tFr':'tToPick',   // T  form: From → To picker
    'eRFr':'eRToPick', // Edit modal: From → To picker
  };
  const toPickId=pairs[fromTextId];
  if(toPickId && $(toPickId)){
    $(toPickId).min=isoDate;
    // If current To value is before new From, clear it
    const curTo=$(toPickId).value;
    if(curTo && curTo<isoDate){
      $(toPickId).value='';
      // Also clear the text input
      const toTextPairs={'nToPick':'nTo','tToPick':'tTo','eRToPick':'eRTo'};
      const toTextId=toTextPairs[toPickId];
      if(toTextId && $(toTextId)) $(toTextId).value='';
    }
  }
}
// Also sync picker values when openEditMo sets the text fields
function getLastBalanceNT(records, convIdx){
  // Walk records up to (not including) convIdx and compute final bV/bS
  let bV=0,bS=0;
  const firstConvStatus = records.filter(r=>r._conversion).length>0
    ? records.filter(r=>r._conversion)[0].fromStatus : 'Non-Teaching';
  let era=firstConvStatus;
  for(let i=0;i<convIdx;i++){
    const r=records[i];
    if(r._conversion){era=r.toStatus;continue;}
    if(era==='Teaching'){
      // single balance mode
      const C2=classifyLeave(r.action||'');
      const isE2=r.earned>0;
      if(C2.isTransfer){bV+=r.trV||0;bS+=r.trV||0;}
      else if(isE2){bV+=r.earned;bS+=r.earned;}
      else if(C2.isMD){bV+=r.monDisAmt||0;bS+=r.monDisAmt||0;}
      else if(C2.isMon){const m2=r.monAmount||0;if(bV>=m2){bV-=m2;bS-=m2;}else{bV=0;bS=0;}}
      else{
        const d2=calcDays(r);
        if(d2>0&&C2.isSick){if(bV>=d2){bV-=d2;bS-=d2;}else{bV=0;bS=0;}}
        else if(d2>0&&C2.isForce){if(bV>=d2){bV-=d2;bS-=d2;}else{bV=0;bS=0;}}
        else if(d2>0&&C2.isTerminal){if(bV>=d2){bV-=d2;bS-=d2;}else{bV=0;bS=0;}}
        else if(d2>0&&C2.isVacation){if(bV>=d2){bV-=d2;bS-=d2;}else{bV=0;bS=0;}}
      }
    } else {
      const C2=classifyLeave(r.action||'');
      let eV=0,eS=0;
      if(C2.isTransfer){eV=r.trV||0;eS=r.trS||0;}
      else if(C2.isAcc){const v=(r.earned===0&&!(r.action||'').toLowerCase().includes('service'))?1.25:r.earned;eV=v;eS=v;}
      else if(r.earned>0){eV=r.earned;eS=r.earned;}
      bV+=eV;bS+=eS;
      const d2=(!C2.isAcc&&!C2.isTransfer&&!C2.isDis&&!C2.isMon&&!C2.isMD&&r.earned===0)?calcDays(r):0;
      if(C2.isMD){bV+=r.monDV||0;bS+=r.monDS||0;}
      else if(C2.isMon){const mV2=r.monV||0,mS2=r.monS||0;if(bV>=mV2){bV-=mV2;}else{bV=0;}if(bS>=mS2){bS-=mS2;}else{bS=0;}}
      else if(C2.isSick&&d2>0){if(bS>=d2){bS-=d2;}else{bS=0;}}
      else if(C2.isForce&&d2>0){if(bV>=d2){bV-=d2;}else{bV=0;}}
      else if(C2.isTerminal&&d2>0){if(bV>=d2){bV-=d2;}else{bV=0;}if(bS>=d2){bS-=d2;}else{bS=0;}}
      else if(C2.isVacation&&d2>0){if(bV>=d2){bV-=d2;}else{bV=0;}}
    }
  }
  return {bV,bS};
}
/*
  SHARED MULTI-ERA RENDER ENGINE
  Handles unlimited conversions. Each era becomes a collapsible section.
  The latest era is always the live editable form.
*/
function eraTableHTML(rows, ed, fwdHtml=''){
  const actionTh = ed ? '<th rowspan="2" class="no-print">Action</th>' : '';
  return `<table style="width:100%;border-collapse:collapse;font-size:11.5px;table-layout:auto;">
    <thead>
      <tr>
        <th rowspan="2">SO #</th>
        <th rowspan="2" style="min-width:90px">Period</th>
        <th colspan="4" class="tha">Study / Vacation / Force Personal / Special Leave</th>
        <th colspan="4" class="thb">Sick / Maternity / Paternity Leave</th>
        <th rowspan="2" style="min-width:120px">Remarks / Nature of Action</th>
        ${actionTh}
      </tr>
      <tr>
        <th class="ths">Earned</th><th class="ths">Abs W/P</th><th class="ths">Balance</th><th class="ths">W/O P</th>
        <th class="ths">Earned</th><th class="ths">Abs W/P</th><th class="ths">Balance</th><th class="ths">W/O P</th>
      </tr>
    </thead>
    <tbody>${fwdHtml}${rows.join('')}</tbody>
  </table>`;
}
function fwdRowHTML(conv, bV, bS, status){
  // Always use live-computed bV/bS — ignore stale conv.fwdBV/fwdBS
  const convDate=fmtD(conv.date||new Date().toISOString().split('T')[0]);
  const remarks=`Converted: ${conv.fromStatus} → ${conv.toStatus}`+(conv.lastAction?` / ${conv.lastAction}`:'');
  if(status==='Teaching'){
    return `<tr class="era-fwd-row">
      <td>—</td><td style="text-align:left;padding-left:5px;line-height:1.5"><span style="font-style:italic;font-weight:700">Balance Forwarded</span><br><span style="font-size:9px;color:var(--au);font-weight:600">(${convDate})</span></td>
      <td class="nc"></td><td class="nc"></td><td class="bc" style="color:var(--au);font-weight:700">${fmt(bV)}</td><td class="nc"></td>
      <td class="nc"></td><td class="nc"></td><td class="bc" style="color:var(--au);font-weight:700">${fmt(bS)}</td><td class="nc"></td>
      <td style="font-style:italic;font-size:10px;color:var(--au);text-align:left;padding-left:5px;">${remarks}</td></tr>`;
  }
  return `<tr class="era-fwd-row">
    <td>—</td><td style="text-align:left;padding-left:5px;line-height:1.5"><span style="font-style:italic;font-weight:700">Balance Forwarded</span><br><span style="font-size:9px;color:var(--au);font-weight:600">(${convDate})</span></td>
    <td class="nc"></td><td class="nc"></td><td class="bc" style="color:var(--au);font-weight:700">${fmt(bV)}</td><td class="nc"></td>
    <td class="nc"></td><td class="nc"></td><td class="nc"></td><td class="nc"></td>
    <td style="font-style:italic;font-size:10px;color:var(--au);text-align:left;padding-left:5px;">${remarks}</td>
    <td class="no-print"></td></tr>`;
}

// Compute exact balance at end of records[0..end-1] using the real row renderers.
// Walks records, uses ntRow/tRow callbacks to capture live balance — guaranteed to
// match exactly what is displayed on the last row of the previous era.
function getBalanceAt(records, end){
  const firstConv=records.find(r=>r._conversion);
  let era=firstConv ? firstConv.fromStatus : 'Teaching';
  let bV=0,bS=0,bal=0;
  for(let i=0;i<end;i++){
    const r=records[i];
    if(!r||r._conversion){
      if(r&&r._conversion){
        // carry balance across era boundary
        if(era==='Teaching'&&r.toStatus==='Non-Teaching'){bV=bal;bS=bal;}
        else if(era==='Non-Teaching'&&r.toStatus==='Teaching'){bal=bV;}
        era=r.toStatus;
      }
      continue;
    }
    if(era==='Teaching'){
      tRow(r,false,{b:bal},nb=>{bal=nb;bV=nb;bS=nb;});
    } else {
      ntRow(r,false,{bV,bS},(nV,nS)=>{bV=nV;bS=nS;});
    }
  }
  return {bV,bS};
}

// Universal multi-era render: works for both NT and T cards
function renderEras(cardType, empId){
  const resolvedId = empId !== undefined ? empId : curId;
  const isNT = cardType==='nt';
  const tblId = isNT?'ntTbl':'tTbl';
  const tblCardId = isNT?'ntTblCard':'tTblCard';
  const oldEraId = isNT?'ntOldEra':'tOldEra';
  const tblCard=$(tblCardId);

  const e=DB.find(x=>x.id===resolvedId);
  if(!e){ $(tblId).innerHTML=''; return; }

  const records=e.records||[];
  // Always sort on render so existing data with manual dates displays in correct order
  sortRecordsByDate(records);
  const convIdxs=[];
  records.forEach((r,i)=>{if(r._conversion)convIdxs.push(i);});

  // Remove any existing old-era wrappers
  document.querySelectorAll('['+'id^="'+oldEraId+'"]').forEach(el=>el.remove());
  tblCard.classList.remove('era-new-section');

  if(convIdxs.length===0){
    // No conversions — simple render
    let bV=0,bS=0,bal=0;
    const rows=records.map((r,i)=>{
      if(isNT) return ntRow(r,isAdmin,{bV,bS},(nV,nS)=>{bV=nV;bS=nS;},i);
      return tRow(r,isAdmin,{b:bal},nb=>{bal=nb;},i);
    });
    $(tblId).innerHTML=buildChunks(rows);
    return;
  }

  // ── MULTI-ERA: split records into segments by conversion points ──
  // segments[i] = { status, records (slice), conv (the conversion record that ENDS this era, if any) }
  const segments=[];
  let segStart=0;
  let curEraStatus=records[convIdxs[0]]?records[convIdxs[0]].fromStatus:(isNT?'Non-Teaching':'Teaching');
  for(let ci=0;ci<convIdxs.length;ci++){
    const cIdx=convIdxs[ci];
    const conv=records[cIdx];
    segments.push({
      status: curEraStatus,
      recs: records.slice(segStart, cIdx),
      startIdx: segStart,
      conv: conv,
      convIdx: cIdx
    });
    curEraStatus=conv.toStatus;
    segStart=cIdx+1;
  }
  // Last (current) segment — no trailing conversion
  segments.push({
    status: curEraStatus,
    recs: records.slice(segStart),
    startIdx: segStart,
    conv: null,
    convIdx: -1
  });

  const lastSeg=segments[segments.length-1];
  const pastSegs=segments.slice(0,-1);

  // Track running balance — after each segment renders, capture exact last balance
  // That exact number becomes Balance Forwarded for the NEXT era
  let endBV=0, endBS=0;

  // ── Render each past segment as a collapsible card ──
  pastSegs.forEach((seg, si)=>{
    // Balance Forwarded for this era = end balance of the PREVIOUS era
    // Era 1 (si=0) has no previous era — no fwdRow
    // Era 2+ (si>=1) gets a fwdRow showing endBV/endBS from the previous segment
    const prevConv=si>0?pastSegs[si-1].conv:null;
    const segFwdHtml=prevConv
      ? fwdRowHTML(prevConv, endBV, endBS, seg.status)
      : '';

    let bV=0, bS=0, bal=0;
    const rows=seg.recs.map((r,ri)=>{
      const idx=seg.startIdx+ri;
      if(seg.status==='Teaching') return tRow(r,isAdmin,{b:bal},nb=>{bal=nb;},idx);
      return ntRow(r,isAdmin,{bV,bS},(nV,nS)=>{bV=nV;bS=nS;},idx);
    }).filter(Boolean);

    // Capture the exact last balance shown on the last row of this era
    if(seg.status==='Teaching'){endBV=bal;endBS=bal;}
    else{endBV=bV;endBS=bS;}

    // Build the table HTML with fwdRow prepended (for eras 2+)
    const tblHTML=eraTableHTML(rows, isAdmin, segFwdHtml);
    const wrapId=oldEraId+(si>0?'_'+si:'');
    let wrap=$(wrapId);
    if(!wrap){
      wrap=document.createElement('div');
      wrap.id=wrapId;
      wrap.className='era-wrapper';
      tblCard.parentNode.insertBefore(wrap, tblCard);
    }
    const realRecs=seg.recs.filter(r=>!r._conversion && !isEmptyRecord(r));
    const eraIsEmpty=realRecs.length===0;
    const delEraBtn=isAdmin&&eraIsEmpty
      ? `<button class="btn b-red b-sm no-print" style="margin-left:12px;" onclick="event.stopPropagation();confirmDeleteEra(${seg.convIdx})">🗑 Delete Empty Era</button>`
      : '';
    wrap.innerHTML=`
      <div class="era-old-toggle" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
        <span class="era-arrow">▼</span>
        <span>📁 ${seg.status} Leave Record — Era ${si+1} (${seg.recs.length} entr${seg.recs.length===1?'y':'ies'})</span>
        ${delEraBtn}
        <span style="margin-left:auto;font-size:10px;font-weight:400;color:var(--mu)">Click to expand / collapse</span>
      </div>
      <div class="era-old-body">
        <div class="card" style="padding:0;margin:0;"><div class="tw">${tblHTML}</div></div>
      </div>`;
  });

  // ── Render current (latest) era into the main table ──
  tblCard.classList.add('era-new-section');
  // Only show Balance Forwarded if there are actual past eras before this one
  const lastConvRecord=pastSegs.length>0
    ? records.slice(0,lastSeg.startIdx).reverse().find(r=>r._conversion)
    : null;
  const fwdHtml=lastConvRecord
    ? fwdRowHTML(lastConvRecord, endBV, endBS, lastSeg.status)
    : '';

  let bV=0,bS=0,bal=0;
  const latestRows=lastSeg.recs.map((r,ri)=>{
    const idx=lastSeg.startIdx+ri;
    if(lastSeg.status==='Teaching') return tRow(r,isAdmin,{b:bal},nb=>{bal=nb;},idx);
    return ntRow(r,isAdmin,{bV,bS},(nV,nS)=>{bV=nV;bS=nS;},idx);
  }).filter(Boolean);

  // If latest era is empty and there are past eras, show delete button
  const lastConvIdx=pastSegs.length>0?pastSegs[pastSegs.length-1].convIdx:-1;
  const latestEraHasRealRecs=lastSeg.recs.filter(r=>!r._conversion&&!isEmptyRecord(r)).length>0;
  const latestEraEmpty=isAdmin&&!latestEraHasRealRecs&&lastConvIdx>=0;
  const delLatestBtn=latestEraEmpty
    ? `<tr class="no-print"><td colspan="12" style="padding:8px 12px;background:#fff5f5;border:1px dashed #fca5a5;">
        <button class="btn b-red b-sm" onclick="confirmDeleteEra(${lastConvIdx})">🗑 Delete Empty Era</button>
        <span style="font-size:11px;color:#9b1c1c;margin-left:8px;">This era has no entries. Delete to remove it.</span>
       </td></tr>`
    : '';
  $(tblId).innerHTML=fwdHtml+latestRows.join('')+delLatestBtn;
}

function renderNT(empId){ renderEras('nt', empId); }
function renderT(empId){ renderEras('t', empId); }
function ntRow(r,ed,st,setBs,idx){
  let bV=st.bV,bS=st.bS;
  const C=classifyLeave(r.action||'');
  const isAL=(r.action||'').toLowerCase().match(/leave|off|carta|accrual|credit|cto|wellness/);
  let eV=0,eS=0;
  if(C.isTransfer){eV=r.trV||0;eS=r.trS||0;bV+=eV;bS+=eS;}
  else if(C.isAcc){const v=(r.earned===0&&!(r.action||'').toLowerCase().includes('service'))?1.25:r.earned;eV=v;eS=v;bV+=eV;bS+=eS;}
  else if(r.earned>0){eV=r.earned;eS=r.earned;bV+=eV;bS+=eS;}
  let aV=0,aS=0,wV=0,wS=0;
  const days=(!C.isAcc&&!C.isTransfer&&!C.isDis&&!C.isMon&&!C.isMD&&r.earned===0)?calcDays(r):0;
  if(C.isDis){/* no change */}
  else if(C.isMD){bV+=r.monDV||0;bS+=r.monDS||0;aV=r.monDV||0;aS=r.monDS||0;}
  else if(C.isMon){
    const mV=r.monV||0,mS=r.monS||0;
    if(bV>=mV){aV=mV;bV-=mV;}else{aV=Math.max(0,bV);wV=mV-aV;bV=0;}
    if(bS>=mS){aS=mS;bS-=mS;}else{aS=Math.max(0,bS);wS=mS-aS;bS=0;}
  }
  else if(C.isPer&&days>0){wV=days;/* no balance change */}
  else if(C.isVacation&&days>0){
    if(bV>=days){aV=days;bV-=days;}else{aV=Math.max(0,bV);wV=days-aV;bV=0;}
  }
  else if(C.isSick&&days>0){
    if(bS>=days){aS=days;bS-=days;}else{aS=Math.max(0,bS);wS=days-aS;bS=0;}
  }
  else if(C.isForce&&days>0){
    // Force/Mandatory Leave → Set A (Col A), deducts from vacation balance
    if(bV>=days){aV=days;bV-=days;}else{aV=Math.max(0,bV);wV=days-aV;bV=0;}
  }
  else if(C.isTerminal&&days>0){
    // Terminal leave → deducts from both Set A and Set B balances
    if(bV>=days){aV=days;bV-=days;}else{aV=Math.max(0,bV);wV=days-aV;bV=0;}
    if(bS>=days){aS=days;bS-=days;}else{aS=Math.max(0,bS);wS=days-aS;bS=0;}
  }
  else if(C.isSetB_noDeduct&&days>0){aS=days;/* no deduction */}
  else if(C.isSetA_noDeduct&&days>0){aV=days;/* no deduction */}
  else if(days>0){
    // Unknown leave type → show in Set A Abs W/P, no deduction
    aV=days;
  }
  if(typeof setBs==='function')setBs(bV,bS);
  const dd=r.spec||(r.from?`${fmtD(r.from)} – ${fmtD(r.to)}`:'');
  const prdDisplay = r.prd + (dd ? `<br><span class="prd-date">${dd}</span>` : '');
  const isEmpty=isEmptyRecord(r);
  const ac=C.isDis?'rdc':(C.isMon||C.isMD?'puc':'');
  const actionCell=ed?rowMenuHTML(idx,'nt',isEmpty):'';
  return`<tr${isEmpty?' style="background:#fff5f5;"':''}><td>${r.so}</td><td class="period-cell">${prdDisplay}</td>
    <td class="nc">${hz(eV)}</td><td class="nc">${hz(aV)}</td><td class="bc">${fmt(bV)}</td><td class="nc">${hz(wV)}</td>
    <td class="nc">${hz(eS)}</td><td class="nc">${hz(aS)}</td><td class="bc">${fmt(bS)}</td><td class="nc">${hz(wS)}</td>
    <td class="${ac} remarks-cell">${r.action}</td>
    ${actionCell}</tr>`;
}

/*
  JS 9 — TEACHING LEAVE (single balance)
*/
function tNC(v){
  const vl=v.toLowerCase(),m=vl.includes('monetization')&&!vl.includes('disapproved'),md=vl.includes('monetization')&&vl.includes('disapproved'),tr=vl.includes('from denr');
  $('tMF').style.display=m?'block':'none';$('tMDF').style.display=md?'block':'none';$('tTrF').style.display=tr?'block':'none';
}
function tClr(){
  ['tSO','tPrd','tAct','tActNote','tFr','tTo','tErn','tForce','tMon','tMonDis','tTrBal'].forEach(id=>$(id).value='');
  ['tFrPick','tToPick'].forEach(id=>{if($(id)){$(id).value='';$(id).min='';}});
  $('tMF').style.display='none';$('tMDF').style.display='none';$('tTrF').style.display='none';
  tEI=-1;$('tSvBtn').innerText='💾 Save Entry';
}
function tSv(){
  const e=DB.find(x=>x.id===curId);
  const baseAv=$('tAct').value.trim(), noteV=$('tActNote').value.trim();
  const av = baseAv && noteV ? `${baseAv}, ${noteV}` : (baseAv||noteV);
  const al=av.toLowerCase();
  const m=al.includes('monetization')&&!al.includes('disapproved'),md=al.includes('monetization')&&al.includes('disapproved');
  const isTr=al.includes('from denr');
  const d={so:$('tSO').value,prd:$('tPrd').value,from:toISODate($('tFr').value),to:toISODate($('tTo').value),
    spec:'',action:av,earned:parseFloat($('tErn').value)||0,
    monAmount:m?parseFloat($('tMon').value)||0:0,
    monDisAmt:md?parseFloat($('tMonDis').value)||0:0,
    forceAmount:(al.includes('force')||al.includes('mandatory'))?(parseFloat($('tForce').value)||0):0,
    trV:isTr?parseFloat($('tTrBal').value)||0:0, trS:0,
    monV:0,monS:0,monDV:0,monDS:0};
  // Reversed date guard
  if(d.from&&d.to&&d.from>d.to){alert('⚠️ "From" date cannot be later than "To" date. Please correct the date range.');return;}
  if(!e.records)e.records=[];
  const valErrT=validateLeaveEntry(e.records,d,tEI);
  if(valErrT){alert(valErrT);return;}
  const isEditT=(tEI>-1);
  const existingIdT=isEditT?(e.records[tEI]._record_id||null):null;
  if(isEditT){e.records[tEI]=d;}else{e.records.push(d);}
  sortRecordsByDate(e.records);
  e.lastEditedAt=new Date().toISOString();
  const savePromiseT = isEditT&&existingIdT
    ? api('update_record',{employee_id:curId,record_id:existingIdT,record:d})
    : api('save_record',{employee_id:curId,record:d});
  savePromiseT.then(res=>{
    if(!res.ok){alert('Save failed: '+(res.error||'Unknown error'));return;}
    if(!isEditT&&res.record_id) d._record_id=res.record_id;
    tClr(); renderT(curId);
    persistRowBalances(curId);
  });
}
function tEditR(i){ openEditMo('t',i); }
function getLastBalanceT(records, convIdx){
  let rBV=0,rBS=0,rBal=0;
  let rEra=records.filter(r=>r._conversion).length>0
    ? records.filter(r=>r._conversion)[0].fromStatus : 'Teaching';
  for(let i=0;i<convIdx;i++){
    const r=records[i];
    if(r._conversion){rEra=r.toStatus;continue;}
    if(rEra==='Non-Teaching'){
      ntRow(r,false,{bV:rBV,bS:rBS},(nV,nS)=>{rBV=nV;rBS=nS;});
    } else {
      tRow(r,false,{b:rBal},nb=>{rBal=nb;rBV=nb;rBS=nb;});
    }
  }
  return {bV:rBV,bS:rBS};
}

function tRow(r,ed,st,setBal,idx){
  let bal=st.b;
  const C=classifyLeave(r.action||'');
  const isE=r.earned>0;
  let aV=0,aS=0,wV=0,wS=0;
  if(C.isTransfer){bal+=r.trV||0;}
  else if(isE){bal+=r.earned;}
  else if(C.isMD){bal+=r.monDisAmt||0;aV=r.monDisAmt||0;}
  else if(C.isMon){const m=r.monAmount||0;if(bal>=m){aV=m;bal-=m;}else{aV=Math.max(0,bal);wV=m-aV;bal=0;}}
  else if(C.isDis){}
  else{
    const days=calcDays(r);
    if(days>0){
      if(C.isSick||C.isForce||C.isTerminal){
        // Sick → Set B (deduct). Force → Set A (deduct). Terminal → both (deduct).
        if(C.isSick){
          if(bal>=days){aS=days;bal-=days;}else{aS=bal;wS=days-bal;bal=0;}
        } else if(C.isForce){
          // Force/Mandatory → Set A, deducts balance
          if(bal>=days){aV=days;bal-=days;}else{aV=Math.max(0,bal);wV=days-aV;bal=0;}
        } else if(C.isTerminal){
          // Terminal → both Set A and Set B, deducts balance
          if(bal>=days){aV=days;aS=days;bal-=days;}else{aV=Math.max(0,bal);aS=aV;wV=days-aV;wS=wV;bal=0;}
        }
      } else if(C.isPer){
        wV=days;// without pay, no deduction
      } else if(C.isVacation){
        // Vacation: deduct from balance (Set A). Overflow goes to W/O Pay.
        if(bal>=days){aV=days;bal-=days;}else{aV=Math.max(0,bal);wV=days-aV;bal=0;}
      } else if(C.isSetB_noDeduct){
        aS=days;// Set B, no deduction (maternity)
      } else {
        aV=days;// Set A, no deduction (everything else)
      }
    }
  }
  if(typeof setBal==='function')setBal(bal);
  const dd=r.spec||(r.from?`${fmtD(r.from)} – ${fmtD(r.to)}`:'');
  const prdDisplay = r.prd + (dd ? `<br><span class="prd-date">${dd}</span>` : '');
  const isEmpty=isEmptyRecord(r);
  const ac=C.isDis?'rdc':(C.isMon||C.isMD?'puc':'');
  const isSetBLeave=(C.isSick||C.isSetB_noDeduct)&&!isE&&!C.isDis&&!C.isMon&&!C.isMD&&!C.isTerminal;
  const actionCell=ed?rowMenuHTML(idx,'t',isEmpty):'';
  return`<tr${isEmpty?' style="background:#fff5f5;"':''}><td>${r.so}</td><td class="period-cell">${prdDisplay}</td>
    <td class="nc">${C.isTransfer?fmt(r.trV||0):(!C.isMon&&!C.isPer&&isE)?fmt(r.earned):''}</td>
    <td class="nc">${hz(aV)}</td><td class="bc">${isSetBLeave?'':fmt(bal)}</td><td class="nc">${hz(wV)}</td>
    <td class="nc">${''}</td>
    <td class="nc">${hz(aS)}</td><td class="bc">${isSetBLeave?fmt(bal):''}</td><td class="nc">${hz(wS)}</td>
    <td class="${ac} remarks-cell" style="text-align:left;padding-left:4px">${r.action}</td>
    ${actionCell}</tr>`;
}

/*
  buildChunks — 30 rows per <tbody> for print pagination.
*/
function buildChunks(rows){
  if(!rows.length) return '';
  const CHUNK=30;let html='';
  for(let i=0;i<rows.length;i+=CHUNK){
    const slice=rows.slice(i,i+CHUNK);
    const isLast=i+CHUNK>=rows.length;
    html+=`<tbody class="print-chunk${isLast?'':' print-chunk-break'}">${slice.join('')}</tbody>`;
  }
  return html;
}

/*
  JS 10 — REGISTER/EDIT MODAL
*/
function openAdd(){$('regMo').querySelectorAll('input').forEach(i=>i.value='');$('eIdx').value='-1';$('eOrigStatus').value='';$('rStat').value='Teaching';$('rSex').value='';$('rCiv').value='';$('rAcctStatus').value='active';$('regMo').classList.add('open');}
function closeMo(id){
  $(id).classList.remove('open');
  // Clear To-picker min constraint when closing date-bearing modals
  if(id==='editRecMo'){
    if($('eRToPick')) $('eRToPick').min='';
    if($('eRFrPick')) $('eRFrPick').value='';
    if($('eRToPick')) $('eRToPick').value='';
  }
  // Close SA inline form when admin modal closes
  if(id==='adminMo') closeSAInlineForm();
}
function editPI(i){
  const e=DB[i];
  const map={rID:'id',rEmail:'email',rPw:'password',rSur:'surname',rGiv:'given',rSuf:'suffix',rMat:'maternal',rDOB:'dob',rPOB:'pob',rAdd:'addr',rSpo:'spouse',rEdu:'edu',rElig:'elig',rRat:'rating',rTin:'tin',rPEx:'pexam',rDEx:'dexam',rApp:'appt',rPos:'pos',rSch:'school'};
  $('eIdx').value=i;Object.entries(map).forEach(([fid,key])=>$(fid).value=e[key]||'');
  $('rSex').value=e.sex||'';$('rCiv').value=e.civil||'';$('rStat').value=e.status||'Teaching';
  $('rAcctStatus').value=e.account_status||'active';
  $('eOrigStatus').value=e.status||'Teaching'; // snapshot status at open time
  $('regMo').classList.add('open');
}
function saveEmp(){
  const i=parseInt($('eIdx').value);
  const newId=$('rID').value.trim();
  const newEmail=$('rEmail').value.trim().toLowerCase();
  const newPw=$('rPw').value;
  const newSur=$('rSur').value.trim();
  const newGiv=$('rGiv').value.trim();
  const newSex=$('rSex').value.trim();
  const newStat=$('rStat').value.trim();
  const newDob=$('rDOB').value.trim();
  const newAddr=$('rAdd').value.trim();
  const newPos=$('rPos').value.trim();
  const newSch=$('rSch').value.trim();

  // ── Required field validation ──
  if(!newId){ alert('⚠️ Employee ID is required.'); return; }
  if(!/^\d{8}$/.test(newId)){ alert('⚠️ Invalid Employee ID — must be exactly 8 numbers.'); return; }
  if(!newEmail){ alert('⚠️ Email address is required.'); return; }
  if(!newEmail.endsWith('@deped.gov.ph')){ alert('⚠️ Invalid email — must use @deped.gov.ph (e.g. juan@deped.gov.ph).'); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)){ alert('⚠️ Please enter a valid email address (e.g. juan@deped.gov.ph).'); return; }
  if(!newSur){ alert('⚠️ Surname is required.'); return; }
  if(!newGiv){ alert('⚠️ Given name is required.'); return; }
  if(!newSex){ alert('⚠️ Sex is required.'); return; }
  if(!newStat){ alert('⚠️ Category (Teaching/Non-Teaching) is required.'); return; }
  if(!newDob){ alert('⚠️ Date of Birth is required.'); return; }
  if(!newAddr){ alert('⚠️ Present Address is required.'); return; }
  if(!newPos){ alert('⚠️ Position / Designation is required.'); return; }
  if(!newSch){ alert('⚠️ School / Office Assignment is required.'); return; }
  if(i===-1 && !newPw){ alert('⚠️ Password is required for new employees.'); return; }

  // ── Duplicate Employee ID check ──
  const dupIdIdx=DB.findIndex(x=>x.id===newId);
  if(dupIdIdx>-1 && dupIdIdx!==i){ alert('⚠️ Employee ID "'+newId+'" is already in use. Please use a unique ID.'); return; }

  // ── Duplicate Email check ──
  const dupEmailIdx=DB.findIndex(x=>(x.email||'').toLowerCase()===newEmail);
  if(dupEmailIdx>-1 && dupEmailIdx!==i){ alert('⚠️ Email "'+newEmail+'" is already registered to another employee. Each employee must have a unique email.'); return; }

  const newStatus=$('rStat').value.trim();
  const newAcctStatus=$('rAcctStatus').value||'active';
  const existing = i>-1 ? DB[i] : null;
  const existingRecords = existing ? (existing.records||[]) : [];
  const oldStatus = existing ? (existing.status||'') : '';
  const origStatus = $('eOrigStatus').value || oldStatus;
  const wasConverted = i>-1 && origStatus && origStatus !== newStatus;

  // Build new employee object
  const e={
    id:newId, email:newEmail, password:newPw||existing?.password||'',
    surname:$('rSur').value.trim(), given:$('rGiv').value.trim(), suffix:$('rSuf').value.trim(),
    maternal:$('rMat').value.trim(), sex:$('rSex').value, civil:$('rCiv').value,
    dob:$('rDOB').value, pob:$('rPOB').value.trim(), addr:$('rAdd').value.trim(),
    spouse:$('rSpo').value.trim(), edu:$('rEdu').value.trim(), elig:$('rElig').value.trim(),
    rating:$('rRat').value.trim(), tin:$('rTin').value.trim(), pexam:$('rPEx').value.trim(), dexam:$('rDEx').value,
    appt:$('rApp').value, status:newStatus, account_status:newAcctStatus, pos:$('rPos').value.trim(),
    school:$('rSch').value.trim(), records:existingRecords,
    conversionLog: existing?(existing.conversionLog||[]):[],
    archived: existing?.archived||false,
    archiveReason: existing?.archiveReason||''
  };

  // Inject conversion marker only for a genuine new category change
  if(wasConverted){
    const today=new Date().toISOString().split('T')[0];
    const lastReal=[...existingRecords].reverse().find(r=>!r._conversion);
    const lastAction=lastReal?lastReal.action:'';
    const tmpIdx=existingRecords.length;
    let cBV=0,cBS=0;
    if(origStatus==='Non-Teaching'){const res=getLastBalanceNT(existingRecords,tmpIdx);cBV=res.bV;cBS=res.bS;}
    else{const res=getLastBalanceT(existingRecords,tmpIdx);cBV=res.bV;cBS=res.bS;}
    const conversionNote={
      _conversion:true,
      fromStatus:origStatus, toStatus:newStatus,
      date:today, lastAction,
      fwdBV:cBV, fwdBS:cBS,
      so:'—', prd:'',
      from:'', to:'', spec:'',
      action:`[Category Change] ${origStatus} → ${newStatus} (${fmtD(today)})`,
      earned:0, forceAmount:0,
      monV:0, monS:0, monDV:0, monDS:0, monAmount:0, monDisAmt:0
    };
    e.records=[...existingRecords, conversionNote];
    e.conversionLog.push({from:origStatus, to:newStatus, date:today, pos:e.pos});
  }

  const payload={...e};
  if(wasConverted){
    const today=new Date().toISOString().split('T')[0];
    payload.conversionEntry={from:origStatus,to:newStatus,date:today,pos:e.pos};
    payload.records=e.records;
  }
  api('save_employee',payload).then(res=>{
    if(!res.ok){alert('Save failed: '+(res.error||'Unknown error'));return;}
    if(i>-1) DB[i]=e; else DB.push(e);
    closeMo('regMo');
    if(isSchoolAdmin){
      renderSAList();
      return;
    }
    if(wasConverted){
      showConversionToast(e.given||e.surname||'Employee', origStatus, newStatus);
      renderList();
      setTimeout(()=>openCard(e.id),350);
    } else {
      renderList();
      if(curId&&curId===e.id){
        const ntOn=$('p-nt').classList.contains('on');
        const tOn=$('p-t').classList.contains('on');
        if(ntOn)$('ntProf').innerHTML=bProf(e);
        else if(tOn)$('tProf').innerHTML=bProf(e);
      }
    }
  });
}

function showConversionToast(name, from, to){
  let toast=$('convToast');
  if(!toast){
    toast=document.createElement('div');
    toast.id='convToast';
    toast.style.cssText=`position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
      background:var(--g1);color:white;padding:12px 24px;border-radius:10px;
      font-size:12.5px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.25);
      border-left:4px solid var(--au);white-space:nowrap;transition:opacity .4s;`;
    document.body.appendChild(toast);
  }
  toast.textContent=`✅ ${name} converted: ${from} → ${to}. New leave card opened with balance forwarded.`;
  toast.style.opacity='1';
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{toast.style.opacity='0';},4000);
}
function doPrint(pg){
  const e=DB.find(x=>x.id===curId);

  // Build compact employee info for repeating print header
  if(e){
    const name=`${(e.surname||'').toUpperCase()}, ${e.given||''} ${e.suffix||''}`.trim();
    // Pre-load logo for print header
    const logoUrl='https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2019/11/korlogo.jpg';
    $('printPageHeader').innerHTML=
      `<div style="display:flex;align-items:center;gap:10px;">
        <img src="${logoUrl}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid #1a5c42;" onerror="this.style.display='none'">
        <div style="flex:1;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:700;font-size:8.5px;color:#123d2c;">REPUBLIC OF THE PHILIPPINES · DEPARTMENT OF EDUCATION · SDO CITY OF KORONADAL — REGION XII</span>
            <span style="font-size:7.5px;color:#6b7a8d;">Printed: ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})}</span>
          </div>
          <div style="margin-top:3px;display:flex;gap:20px;flex-wrap:wrap;font-size:8.5px;">
            <span><b>Name:</b> ${name}</span>
            <span><b>ID:</b> ${e.id||''}</span>
            <span><b>Position:</b> ${e.pos||''}</span>
            <span><b>School/Office:</b> ${e.school||''}</span>
            <span><b>Category:</b> ${e.status||''}</span>
          </div>
        </div>
      </div>`;
  }

  // Inject page number footer divs after each print chunk (outside the table)
  const chunks=document.querySelectorAll('#p-'+pg+' .print-chunk-break, #p-'+pg+' .print-chunk:not(.print-chunk-break)');
  const total=chunks.length;
  chunks.forEach((chunk,idx)=>{
    chunk.querySelectorAll('.injected-page-num').forEach(el=>el.remove());
    const pgDiv=document.createElement('div');
    pgDiv.className='injected-page-num';
    pgDiv.style.cssText='text-align:right;font-size:7.5px;color:#888;padding:2px 4px 0;font-style:italic;font-family:Inter,sans-serif;';
    pgDiv.textContent='Page '+(idx+1)+' of '+total;
    chunk.parentNode.insertBefore(pgDiv,chunk.nextSibling);
  });

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('printing','on'));
  const target=$('p-'+pg);
  target.classList.add('printing','on');
  setTimeout(()=>{
    window.print();
    setTimeout(()=>{
      document.querySelectorAll('.injected-page-num').forEach(el=>el.remove());
      $('printPageHeader').innerHTML='';
      target.classList.remove('printing');
      target.classList.add('on');
    },900);
  },180);
}

/*
  JS 11 — PDF DOWNLOAD
  Captures live print layout. Fully restores DOM after. New form on new page.
*/
async function downloadPDF(type){
  const pg=type;
  const e=DB.find(x=>x.id===curId);if(!e)return;
  const pageW_mm=215.9,pageH_mm=330.2,margin_mm=8,usable_mm=pageW_mm-(margin_mm*2);
  const name=`${(e.surname||'').toUpperCase()}, ${e.given||''} ${e.suffix||''}`.trim();
  const printHeader=$('printPageHeader');

  // 1. Build header — pre-load DepEd logo as data URL so html2canvas can embed it
  async function getLogoDataURL(){
    // Use an Image element + canvas to convert cross-origin image to data URL
    async function imgToDataURL(url){
      return new Promise(resolve=>{
        const img=new Image();
        img.crossOrigin='anonymous';
        img.onload=()=>{
          try{
            const c=document.createElement('canvas');
            c.width=img.naturalWidth||80;c.height=img.naturalHeight||80;
            c.getContext('2d').drawImage(img,0,0);
            resolve(c.toDataURL('image/png'));
          }catch(e){resolve(null);}
        };
        img.onerror=()=>resolve(null);
        img.src=url+'?_cb='+Date.now();
      });
    }
    // DepEd official / Wikimedia sources (CORS-friendly)
    const urls=[
      'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/DepEd.svg/180px-DepEd.svg.png',
      'https://www.deped.gov.ph/wp-content/uploads/2019/01/DepEd_seal_2017.png',
      'https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2019/11/korlogo.jpg',
      'https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2020/05/korlogo2.jpg'
    ];
    for(const url of urls){
      try{
        const d=await imgToDataURL(url);
        if(d&&d.length>500) return d;
      }catch(e){}
    }
    // Final fallback: DepEd-styled SVG seal (always works, no network needed)
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
      <defs><radialGradient id="bg" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#1e7050"/><stop offset="100%" stop-color="#0d2e1f"/></radialGradient></defs>
      <circle cx="60" cy="60" r="59" fill="url(#bg)"/>
      <circle cx="60" cy="60" r="54" fill="none" stroke="#b07d2c" stroke-width="2"/>
      <circle cx="60" cy="60" r="50" fill="none" stroke="#f0d28a" stroke-width="0.8" stroke-dasharray="3,2"/>
      <text x="60" y="30" font-family="Arial,sans-serif" font-size="7.5" font-weight="700" fill="#f0d28a" text-anchor="middle" letter-spacing="0.8">REPUBLIC OF THE PHILIPPINES</text>
      <text x="60" y="42" font-family="Arial,sans-serif" font-size="7" fill="#fdf5e6" text-anchor="middle" letter-spacing="0.5">DEPARTMENT OF EDUCATION</text>
      <text x="60" y="68" font-family="Arial,sans-serif" font-size="22" font-weight="900" fill="#f0d28a" text-anchor="middle">DepEd</text>
      <text x="60" y="82" font-family="Arial,sans-serif" font-size="7" fill="#fdf5e6" text-anchor="middle">SDO CITY OF KORONADAL</text>
      <text x="60" y="93" font-family="Arial,sans-serif" font-size="6.5" fill="#c8e6d6" text-anchor="middle">REGION XII</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  }
  const logoDataURL=await getLogoDataURL();
  printHeader.innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;padding:4px 0;">
      <img src="${logoDataURL}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid #1a5c42;">
      <div style="flex:1;">
        <div style="font-weight:700;font-size:8px;color:#123d2c;letter-spacing:.3px;">REPUBLIC OF THE PHILIPPINES · DEPARTMENT OF EDUCATION · SDO CITY OF KORONADAL — REGION XII</div>
        <div style="margin-top:3px;display:flex;gap:16px;flex-wrap:wrap;font-size:8px;">
          <span><b>Name:</b> ${name}</span>
          <span><b>ID:</b> ${e.id||''}</span>
          <span><b>TIN:</b> ${e.tin||''}</span>
          <span><b>Position:</b> ${e.pos||''}</span>
          <span><b>School/Office:</b> ${e.school||''}</span>
          <span><b>Category:</b> ${e.status||''}</span>
        </div>
      </div>
    </div>`;

  // 2. Inject page numbers
  const chunks=document.querySelectorAll('#p-'+pg+' .print-chunk-break, #p-'+pg+' .print-chunk:not(.print-chunk-break)');
  const total=chunks.length;
  chunks.forEach((chunk,idx)=>{
  });

  // 3. Activate printing mode
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('printing','on'));
  const target=$('p-'+pg);
  target.classList.add('printing','on');

  // 4. Snapshot + apply temporary styles
  const topbar=document.querySelector('.topbar');
  const savedTopbar=topbar?topbar.style.display:'';
  if(topbar)topbar.style.display='none';

  const savedHdrStyle=printHeader.getAttribute('style')||'';
  printHeader.style.cssText='display:block!important;background:white;border-bottom:2px solid #1a5c42;padding:8px 12px 6px;font-size:11px;color:#1e2530;line-height:1.6;margin-bottom:6px;position:relative;top:auto;left:auto;right:auto;z-index:auto;';

  const twEls=[...target.querySelectorAll('.tw')];
  const twSaved=twEls.map(el=>({ov:el.style.overflow,mh:el.style.maxHeight}));
  twEls.forEach(el=>{el.style.overflow='visible';el.style.maxHeight='none';});

  const eraBodyEls=[...target.querySelectorAll('.era-old-body')];
  const eraBodySaved=eraBodyEls.map(el=>el.style.display);
  eraBodyEls.forEach(el=>{el.style.display='block';});

  const eraTogEls=[...target.querySelectorAll('.era-old-toggle')];
  const eraTogSaved=eraTogEls.map(el=>el.style.display);
  eraTogEls.forEach(el=>{el.style.display='none';});

  const noPrints=[...target.querySelectorAll('.no-print')];
  const noPrintsSaved=noPrints.map(el=>el.style.display);
  noPrints.forEach(el=>el.style.setProperty('display','none','important'));

  await new Promise(r=>setTimeout(r,200));

  async function captureSlices(el){
    const canvas=await html2canvas(el,{scale:2,useCORS:true,logging:false,backgroundColor:'#ffffff',scrollX:0,scrollY:-window.scrollY,windowWidth:document.documentElement.scrollWidth});
    const imgW=usable_mm,imgH=(canvas.height/canvas.width)*imgW;
    const slices=[];let srcY=0;
    while(srcY<canvas.height-2){
      const rH=imgH-((srcY/canvas.height)*imgH);
      const sH=Math.min(pageH_mm-(margin_mm*2),rH);
      const sPx=Math.ceil((sH/imgH)*canvas.height);
      const sc=document.createElement('canvas');
      sc.width=canvas.width;sc.height=Math.max(1,sPx);
      sc.getContext('2d').drawImage(canvas,0,srcY,canvas.width,sPx,0,0,canvas.width,sPx);
      slices.push({d:sc.toDataURL('image/jpeg',0.95),h:sH});
      srcY+=sPx;
    }
    return slices;
  }

  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:[pageW_mm,pageH_mm]});
  const allSlices=[];

  try{
    // Helper: build a capture wrapper with header + content nodes
    async function buildPage(...nodes){
      const wrap=document.createElement('div');
      wrap.style.cssText='position:fixed;top:0;left:-9999px;background:white;z-index:-1;width:'+target.offsetWidth+'px;';
      const hc=printHeader.cloneNode(true);
      hc.style.cssText='display:block;background:white;border-bottom:2px solid #1a5c42;padding:8px 12px 6px;font-size:11px;color:#1e2530;line-height:1.6;margin-bottom:6px;';
      wrap.appendChild(hc);
      nodes.forEach(el=>{
        if(!el) return;
        const c=el.cloneNode(true);
        c.style.display='block';
        c.querySelectorAll('.no-print').forEach(x=>x.remove());
        c.querySelectorAll('.tw').forEach(x=>{x.style.overflow='visible';x.style.maxHeight='none';});
        c.querySelectorAll('.era-old-body').forEach(x=>x.style.display='block');
        c.querySelectorAll('.era-old-toggle').forEach(x=>x.style.display='none');
        wrap.appendChild(c);
      });
      document.body.appendChild(wrap);
      await new Promise(r=>setTimeout(r,150));
      const slices=await captureSlices(wrap);
      document.body.removeChild(wrap);
      return slices;
    }

    // Collect sections
    const profileCard=target.querySelector('.card:not([id$="Frm"]):not(#ntFrm):not(#tFrm)');
    const eraWrappers=[...target.querySelectorAll('.era-wrapper')];
    const mainTableCard=target.querySelector('.era-new-section')||
      [...target.querySelectorAll('.card')].find(c=>c.querySelector('tbody[id$="Tbl"]'));

    if(eraWrappers.length===0){
      // No conversions — single page, everything together
      allSlices.push(...await captureSlices(target));
    } else {
      // Page 1: profile + Era 1 (first era wrapper)
      allSlices.push(...await buildPage(profileCard, eraWrappers[0]));
      // Middle pages: each remaining past era alone
      for(let wi=1;wi<eraWrappers.length;wi++){
        allSlices.push(...await buildPage(eraWrappers[wi]));
      }
      // Last page: latest/current era (main table card) — no profile repeated
      if(mainTableCard){
        allSlices.push(...await buildPage(mainTableCard));
      }
    }

    allSlices.forEach((sl,idx)=>{
      if(idx>0)pdf.addPage();
      pdf.addImage(sl.d,'JPEG',margin_mm,margin_mm,usable_mm,sl.h);
      pdf.setFontSize(7);pdf.setTextColor(136,136,136);
      pdf.text('Page '+(idx+1)+' of '+allSlices.length,pageW_mm-margin_mm,pageH_mm-3,{align:'right'});
      pdf.setTextColor(0,0,0);
    });
    pdf.save(`${(e.surname||'emp').replace(/\s+/g,'_')}_${(e.given||'').replace(/\s+/g,'_')}_leavecard.pdf`.toLowerCase());
  }catch(err){alert('PDF generation failed: '+err.message);}
  finally{
    document.querySelectorAll('.injected-page-num').forEach(el=>el.remove());
    printHeader.setAttribute('style',savedHdrStyle);printHeader.innerHTML='';
    if(topbar)topbar.style.display=savedTopbar;
    twEls.forEach((el,i)=>{el.style.overflow=twSaved[i].ov;el.style.maxHeight=twSaved[i].mh;});
    eraBodyEls.forEach((el,i)=>{el.style.display=eraBodySaved[i];});
    eraTogEls.forEach((el,i)=>{el.style.display=eraTogSaved[i];});
    noPrints.forEach((el,i)=>{if(noPrintsSaved[i])el.style.display=noPrintsSaved[i];else el.style.removeProperty('display');});
    target.classList.remove('printing');target.classList.add('on');
  }
}
// Restore session on page load
if(!restoreSession()){
  // No saved session — show login screen (already active by default)
}updates.push