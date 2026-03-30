<?php
// SDO Koronadal — Leave Management System
// index.php — Main entry point
session_start();
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SDO Koronadal — Leave Management System</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<link rel="stylesheet" href="style.css">
<style>
/* ── Integrated date picker (📅 icon inside textbox) ── */
.date-wrap{position:relative;display:flex;align-items:center;}
.date-wrap .date-text{width:100%;padding-right:36px!important;box-sizing:border-box;}
/* The 📅 button is purely decorative — the real click target is the invisible date input on top */
.date-wrap .date-cal-btn{position:absolute;right:0;top:0;width:36px;height:100%;background:none;border:none;pointer-events:none;font-size:15px;display:flex;align-items:center;justify-content:center;color:var(--mu);border-radius:0 7px 7px 0;}
/* Invisible native date input covers the button area exactly and opens picker on click */
.date-wrap .date-pick-hidden{position:absolute;right:0;top:0;width:36px;height:100%;opacity:0;cursor:pointer;border:none;padding:0;margin:0;font-size:0;background:transparent;-webkit-appearance:none;appearance:none;z-index:2;}
/* Make the calendar icon glow when hovering over the invisible input */
.date-wrap:has(.date-pick-hidden:hover) .date-cal-btn{color:var(--g2);}
</style>
</head>
<body>

<!-- ════════════════════════════════════════
  SCREEN 1 — LOGIN
════════════════════════════════════════ -->
<div id="s-login" class="screen active">
  <div class="lw">
    <div class="split">
      <div class="sl">
        <div class="l-logos">
          <img id="logo2"
               src="https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2019/11/korlogo.jpg"
               onerror="this.onerror=null;this.src='https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2020/05/korlogo2.jpg';this.onerror=function(){logoFallback(this,'SDO','#b07d2c');};" alt="SDO Koronadal" style="width:72px;height:72px;">
        </div>
        <div class="l-tag">DepEd Region XII</div>
        <h1>Employee Records &amp; HR Management System</h1>
        <p>SDO City of Koronadal — empowering learners, inspiring excellence.</p>
        <div class="l-rule"></div>
        <small>Secure · Accurate · Efficient</small>
      </div>
      <div class="sr">
        <div class="lfw">
          <h2>Welcome Back</h2>
          <p class="lsub">Sign in to access your records</p>
          <div class="lf">
            <label>Email Address</label>
            <div class="lfi"><input type="email" id="lID" placeholder="Enter your email" autocomplete="off"></div>
          </div>
          <div class="lf">
            <label>Password</label>
            <div class="lfi">
              <input type="password" id="lPw" placeholder="Enter your password" onkeydown="if(event.key==='Enter')doLogin()">
              <button class="leye" onclick="toggleEye('lPw',this)">👁</button>
            </div>
          </div>
          <button class="lbtn" onclick="doLogin()">Login</button>
          <p id="lErr" class="lerr"></p>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ════════════════════════════════════════
  SCREEN 2 — APP DASHBOARD
════════════════════════════════════════ -->
<div id="s-app" class="screen">

  <!-- SIDEBAR OVERLAY -->
  <div id="sbOverlay" class="sb-overlay" onclick="closeSidebar()"></div>

  <!-- SIDEBAR DRAWER -->
  <div id="sidebar" class="sidebar">
    <div class="sb-head">
      <img class="sb-logo"
        src="https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2019/11/korlogo.jpg"
        onerror="this.onerror=null;this.src='https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2020/05/korlogo2.jpg';this.onerror=function(){logoFallback(this,'SDO','#1a5c42');};" alt="SDO">
      <div class="sb-brand">
        <div class="sb-brand-title">SDO City of Koronadal</div>
        <div class="sb-brand-sub">DepEd Region XII · Leave Management</div>
      </div>
      <button class="sb-close" onclick="closeSidebar()">✕</button>
    </div>
    <!-- Admin user chip -->
    <div id="sbUser" class="sb-user" style="display:none;">
      <div class="sb-av" id="sbAv">A</div>
      <div><div class="sb-uname" id="sbName">Administrator</div><div class="sb-urole" id="sbRole">Admin · Edit Profile</div></div>
    </div>
    <nav class="sb-nav" id="sbNav">
      <!-- Admin nav items injected by JS -->
    </nav>
  </div>

  <div class="topbar no-print">
    <div class="tb-in">
      <div class="tb-brand">
        <button id="sbToggleBtn" class="sb-toggle" onclick="openSidebar()" style="display:none;" title="Menu">☰</button>
        <div class="tb-divider" id="sbDivider" style="display:none;"></div>
        <img class="tb-logo"
          src="https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2019/11/korlogo.jpg"
          onerror="this.onerror=null;this.src='https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2020/05/korlogo2.jpg';this.onerror=function(){logoFallback(this,'SDO','#1a5c42');};" alt="SDO">
        <div class="tb-divider"></div>
        <div class="tb-text">
          <div class="tb-title">SDO City of Koronadal — DepEd Region XII</div>
          <div class="tb-sub">Employee Records &amp; Leave Management System</div>
        </div>
      </div>
      <div class="tb-nav">
        <button id="topbarLogout" class="nb out" onclick="confirmLogout()" style="display:none;">🔒 Logout</button>
      </div>
    </div>
  </div>

  <div class="ca">

    <!-- PAGE: Personnel List -->
    <div id="p-list" class="page">
      <div class="stats-row no-print" id="statsRow"></div>
      <div class="card">
        <div class="ch grn">👥 Personnel Registry</div>
        <div class="toolbar no-print">
          <div class="toolbar-left">
            <button class="btn b-grn" onclick="openAdd()">➕ Register New Personnel</button>
            <div class="srch">
              <span class="sri">🔍</span>
              <input type="text" id="srchQ" placeholder="Search name or ID…" oninput="renderList()">
            </div>
          </div>
          <div class="toolbar-filters" id="toolbarFilters">
            <select id="fCat" class="tb-filter" onchange="renderList()">
              <option value="">All Categories</option>
              <option value="Teaching">Teaching</option>
              <option value="Non-Teaching">Non-Teaching</option>
            </select>
            <select id="fPos" class="tb-filter" onchange="renderList()">
              <option value="">All Positions</option>
            </select>
            <select id="fSch" class="tb-filter" onchange="renderList()">
              <option value="">All Schools/Offices</option>
            </select>
            <select id="fCard" class="tb-filter" onchange="renderList()">
              <option value="">All Card Status</option>
              <option value="updated">✅ Updated</option>
              <option value="pending">⏳ Pending</option>
            </select>
            <select id="fAcct" class="tb-filter" onchange="renderList()">
              <option value="">All Accounts</option>
              <option value="active">🟢 Active</option>
              <option value="inactive">🔴 Inactive</option>
            </select>
            <button class="tb-filter-clear no-print" onclick="clearListFilters()">✕ Clear</button>
          </div>
        </div>
        <div class="tw" style="max-height:none;">
          <table style="border-collapse:collapse;">
            <thead>
              <!-- Row 1: column labels (bigger, centered) -->
              <tr>
                <th style="height:44px;width:9%;font-size:12px;text-align:center;">Employee ID</th>
                <th style="width:20%;font-size:12px;text-align:center;">Full Name</th>
                <th style="width:9%;font-size:12px;text-align:center;">Category</th>
                <th style="width:14%;font-size:12px;text-align:center;">Position</th>
                <th style="width:16%;font-size:12px;text-align:center;">School / Office</th>
                <th style="width:9%;font-size:12px;text-align:center;">Card Status</th>
                <th style="width:9%;font-size:12px;text-align:center;">Account</th>
                <th class="no-print" style="width:14%;font-size:12px;text-align:center;">Action</th>
              </tr>

            </thead>
            <tbody id="pTbl"></tbody>
          </table>
        </div>
      </div>

    </div>

    <!-- PAGE: Archive REMOVED — status is now managed via Employee Registration modal -->

    <!-- PAGE: School Admin Dashboard -->
    <div id="p-sa" class="page">
      <div class="stats-row no-print" id="saStatsRow"></div>
      <div class="card">
        <div class="ch" style="background:linear-gradient(90deg,#1e3a6e,#2d5a9e);color:white;">🏫 School Admin — Personnel Management</div>
        <div class="toolbar no-print">
          <div class="toolbar-left">
            <button class="btn b-grn" onclick="openAdd()">➕ Register New Personnel</button>
            <div class="srch">
              <span class="sri">🔍</span>
              <input type="text" id="saSrchQ" placeholder="Search name or ID…" oninput="renderSAList()">
            </div>
          </div>
          <div class="toolbar-filters">
            <select id="saCat" class="tb-filter" onchange="renderSAList()">
              <option value="">All Categories</option>
              <option value="Teaching">Teaching</option>
              <option value="Non-Teaching">Non-Teaching</option>
            </select>
            <select id="saAcct" class="tb-filter" onchange="renderSAList()">
              <option value="">All Accounts</option>
              <option value="active">🟢 Active</option>
              <option value="inactive">🔴 Inactive</option>
            </select>
            <button class="tb-filter-clear no-print" onclick="clearSAFilters()">✕ Clear</button>
          </div>
        </div>
        <div class="tw" style="max-height:none;">
          <table style="border-collapse:collapse;">
            <thead>
              <tr>
                <th style="height:44px;width:10%;font-size:12px;text-align:center;">Employee ID</th>
                <th style="width:22%;font-size:12px;text-align:center;">Full Name</th>
                <th style="width:10%;font-size:12px;text-align:center;">Category</th>
                <th style="width:16%;font-size:12px;text-align:center;">Position</th>
                <th style="width:18%;font-size:12px;text-align:center;">School / Office</th>
                <th style="width:10%;font-size:12px;text-align:center;">Account</th>
                <th class="no-print" style="width:14%;font-size:12px;text-align:center;">Action</th>
              </tr>
            </thead>
            <tbody id="saTbl"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div id="p-cards" class="page">
      <div class="card">
        <div class="ch grn">📋 Leave Cards</div>
        <div class="toolbar no-print">
          <span style="font-size:12px;color:var(--mu);font-weight:500;">Click an employee to open their leave card.</span>
          <div class="srch">
            <span class="sri">🔍</span>
            <input type="text" id="cardsQ" placeholder="Search name or ID…" oninput="renderCardsSearch()">
          </div>
        </div>
        <div id="cardsEmployeeList" style="padding:12px 16px 8px;"></div>
      </div>
    </div>

    <!-- PAGE: Non-Teaching Card -->
    <div id="p-nt" class="page">
      <div class="no-print" style="display:flex;justify-content:space-between;margin-bottom:18px;gap:10px;flex-wrap:wrap;">
        <button class="btn b-slt" onclick="backFromCard()">⬅ Back</button>
        <div style="display:flex;gap:10px;">
          <button class="btn b-pdf" onclick="downloadPDF('nt')">⬇ Download PDF</button>
          <button class="btn b-prn" onclick="doPrint('nt')">🖨 Print</button>
        </div>
      </div>
      <div class="card" id="ntCard">
        <div class="ch grn center">📋 Non-Teaching Personnel Leave Record</div>
        <div class="cb"><div id="ntProf" class="pg"></div></div>
      </div>
      <div class="card no-print" id="ntFrm">
        <div class="ch amber">✏ Leave Entry Form</div>
        <div class="cb">
          <div class="ig" style="margin-bottom:14px;">
            <div class="f"><label>Special Order #</label><input type="text" id="nSO"></div>
            <div class="f"><label>Period Covered</label><input type="text" id="nPrd"></div>
            <div class="f">
              <label>Date From</label>
              <div class="date-wrap">
                <input type="text" id="nFr" placeholder="mm/dd/yyyy" maxlength="10" oninput="fmtDateInput(this);syncDatePicker('nFr','nFrPick')" onkeydown="if(event.key==='Tab'||event.key==='Enter')fmtDateInput(this,true)" class="date-text">
                <input type="date" id="nFrPick" class="date-pick-hidden" onchange="syncFromPicker('nFrPick','nFr')">
                <button type="button" class="date-cal-btn" tabindex="-1">📅</button>
              </div>
            </div>
            <div class="f">
              <label>Date To</label>
              <div class="date-wrap">
                <input type="text" id="nTo" placeholder="mm/dd/yyyy" maxlength="10" oninput="fmtDateInput(this);syncDatePicker('nTo','nToPick')" onkeydown="if(event.key==='Enter')ntSv()" class="date-text">
                <input type="date" id="nToPick" class="date-pick-hidden" onchange="syncFromPicker('nToPick','nTo')">
                <button type="button" class="date-cal-btn" tabindex="-1">📅</button>
              </div>
            </div>
            <div class="f">
              <label>Nature of Action</label>
              <input list="ntLL" id="nAct" placeholder="Select or type…" oninput="ntNC(this.value)" autocomplete="off">
              <datalist id="ntLL">
                <option value="Vacation Leave">
                <option value="Mandatory/Force Leave"><option value="Sick Leave">
                <option value="Personal Leave"><option value="Compensatory Time Off (CTO)">
                <option value="Maternity Leave"><option value="Paternity Leave">
                <option value="Special Privilege Leave (SPL)"><option value="Solo Parent Leave">
                <option value="Study Leave"><option value="Rehabilitation Leave">
                <option value="Wellness Leave">
                <option value="Special Leave Benefits for Women (Magna Carta)">
                <option value="Violence Against Women and Children (VAWC) Leave">
                <option value="Terminal Leave"><option value="Monetization">
                <option value="Monetization (disapproved)"><option value="Force Leave (disapproved)">
                <option value="From DENR Region 12">
              </datalist>
            </div>
            <div class="f"><label>Additional Note</label><input type="text" id="nActNote" placeholder="e.g. per CSC MC No. 14"></div>
            <div class="f"><label>Value Earned</label><input type="number" id="nErn" step="0.001"></div>
            <div class="f"><label>Force Leave Number</label><input type="number" id="nForce" step="1" onkeydown="if(event.key==='Enter')ntSv()"></div>
          </div>
          <div id="ntMF" style="display:none;margin-bottom:14px;">
            <div class="sdiv">💰 Monetization — Deduct Amounts</div>
            <div class="ig">
              <div class="f hl"><label>Amount (Vacation/Study Col)</label><input type="number" id="nMV" step="0.001"></div>
              <div class="f hl"><label>Amount (Sick/Force Col)</label><input type="number" id="nMS" step="0.001"></div>
            </div>
          </div>
          <div id="ntMDF" style="display:none;margin-bottom:14px;">
            <div class="sdiv">🔄 Monetization (Disapproved) — Add Back</div>
            <div class="ig">
              <div class="f hl"><label>Add-Back (Vacation Col)</label><input type="number" id="nMDV" step="0.001"></div>
              <div class="f hl"><label>Add-Back (Sick Col)</label><input type="number" id="nMDS" step="0.001"></div>
            </div>
          </div>
          <div id="ntTrF" style="display:none;margin-bottom:14px;">
            <div class="sdiv">🔁 Transfer Balance — Initial Credits from Other Organization</div>
            <div class="ig">
              <div class="f hl"><label>Vacation Col Balance</label><input type="number" id="nTrV" step="0.001"></div>
              <div class="f hl"><label>Sick Col Balance</label><input type="number" id="nTrS" step="0.001"></div>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
            <button class="btn b-slt" onclick="ntClr()">✕ Clear</button>
            <button class="btn b-pri" id="ntSvBtn" onclick="ntSv()">💾 Save Entry</button>
          </div>
        </div>
      </div>
      <div class="card" style="padding:0;" id="ntTblCard">
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th rowspan="2">SO #</th>
                <th rowspan="2" style="min-width:90px">Period</th>
                <th colspan="4" class="tha">Study / Vacation / Force Personal / Special Leave</th>
                <th colspan="4" class="thb">Sick / Maternity / Paternity Leave</th>
                <th rowspan="2" style="min-width:120px">Remarks / Nature of Action</th>
                <th rowspan="2" class="no-print">Action</th>
              </tr>
              <tr>
                <th class="ths">Earned</th><th class="ths">Abs W/P</th><th class="ths">Balance</th><th class="ths">W/O P</th>
                <th class="ths">Earned</th><th class="ths">Abs W/P</th><th class="ths">Balance</th><th class="ths">W/O P</th>
              </tr>
            </thead>
            <tbody id="ntTbl"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PAGE: Teaching Card -->
    <div id="p-t" class="page">
      <div class="no-print" style="display:flex;justify-content:space-between;margin-bottom:18px;gap:10px;flex-wrap:wrap;">
        <button class="btn b-slt" onclick="backFromCard()">⬅ Back</button>
        <div style="display:flex;gap:10px;">
          <button class="btn b-pdf" onclick="downloadPDF('t')">⬇ Download PDF</button>
          <button class="btn b-prn" onclick="doPrint('t')">🖨 Print</button>
        </div>
      </div>
      <div class="card" id="tCard">
        <div class="ch grn center">📋 Teaching Personnel Leave Record (Service Credits)</div>
        <div class="cb"><div id="tProf" class="pg"></div></div>
      </div>
      <div class="card no-print" id="tFrm">
        <div class="ch amber">✏ Leave Entry Form</div>
        <div class="cb">
          <div class="ig" style="margin-bottom:14px;">
            <div class="f"><label>SO #</label><input type="text" id="tSO"></div>
            <div class="f"><label>Period</label><input type="text" id="tPrd"></div>
            <div class="f">
              <label>From</label>
              <div class="date-wrap">
                <input type="text" id="tFr" placeholder="mm/dd/yyyy" maxlength="10" oninput="fmtDateInput(this);syncDatePicker('tFr','tFrPick')" onkeydown="if(event.key==='Tab'||event.key==='Enter')fmtDateInput(this,true)" class="date-text">
                <input type="date" id="tFrPick" class="date-pick-hidden" onchange="syncFromPicker('tFrPick','tFr')">
                <button type="button" class="date-cal-btn" tabindex="-1">📅</button>
              </div>
            </div>
            <div class="f">
              <label>To</label>
              <div class="date-wrap">
                <input type="text" id="tTo" placeholder="mm/dd/yyyy" maxlength="10" oninput="fmtDateInput(this);syncDatePicker('tTo','tToPick')" onkeydown="if(event.key==='Enter')tSv()" class="date-text">
                <input type="date" id="tToPick" class="date-pick-hidden" onchange="syncFromPicker('tToPick','tTo')">
                <button type="button" class="date-cal-btn" tabindex="-1">📅</button>
              </div>
            </div>
            <div class="f">
              <label>Nature of Action</label>
              <input list="tLL" id="tAct" placeholder="Select or type…" oninput="tNC(this.value)" autocomplete="off">
              <datalist id="tLL">
                <option value="Vacation Leave">
                <option value="Mandatory/Force Leave"><option value="Sick Leave">
                <option value="Personal Leave"><option value="Compensatory Time Off (CTO)">
                <option value="Maternity Leave"><option value="Paternity Leave">
                <option value="Special Privilege Leave (SPL)"><option value="Solo Parent Leave">
                <option value="Study Leave"><option value="Rehabilitation Leave">
                <option value="Wellness Leave">
                <option value="Special Leave Benefits for Women (Magna Carta)">
                <option value="Violence Against Women and Children (VAWC) Leave">
                <option value="Terminal Leave"><option value="Monetization">
                <option value="Monetization (disapproved)"><option value="Force Leave (disapproved)">
                <option value="From DENR Region 12">
              </datalist>
            </div>
            <div class="f"><label>Additional Note</label><input type="text" id="tActNote" placeholder="e.g. per CSC MC No. 14"></div>
            <div class="f"><label>Earned</label><input type="number" id="tErn" step="0.001"></div>
            <div class="f"><label>Force Leave Number</label><input type="number" id="tForce" step="1" onkeydown="if(event.key==='Enter')tSv()"></div>
          </div>
          <div id="tMF" style="display:none;margin-bottom:14px;">
            <div class="sdiv">💰 Monetization — Amount to Deduct</div>
            <div class="ig"><div class="f hl"><label>Amount to Deduct</label><input type="number" id="tMon" step="0.001"></div></div>
          </div>
          <div id="tMDF" style="display:none;margin-bottom:14px;">
            <div class="sdiv">🔄 Monetization (Disapproved) — Add Back</div>
            <div class="ig"><div class="f hl"><label>Amount to Add Back</label><input type="number" id="tMonDis" step="0.001"></div></div>
          </div>
          <div id="tTrF" style="display:none;margin-bottom:14px;">
            <div class="sdiv">🔁 Transfer Balance — Initial Credits from Other Organization</div>
            <div class="ig"><div class="f hl"><label>Balance to Transfer In</label><input type="number" id="tTrBal" step="0.001"></div></div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
            <button class="btn b-slt" onclick="tClr()">✕ Clear</button>
            <button class="btn b-pri" id="tSvBtn" onclick="tSv()">💾 Save Entry</button>
          </div>
        </div>
      </div>
      <div class="card" style="padding:0;" id="tTblCard">
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th rowspan="2">SO #</th>
                <th rowspan="2" style="min-width:90px">Period</th>
                <th colspan="4" class="tha">Study / Vacation / Force Personal / Special Leave</th>
                <th colspan="4" class="thb">Sick / Maternity / Paternity Leave</th>
                <th rowspan="2" style="min-width:120px">Remarks / Nature of Action</th>
                <th rowspan="2" class="no-print">Action</th>
              </tr>
              <tr>
                <th class="ths">Earned</th><th class="ths">Abs W/P</th><th class="ths">Balance</th><th class="ths">W/O P</th>
                <th class="ths">Earned</th><th class="ths">Abs W/P</th><th class="ths">Balance</th><th class="ths">W/O P</th>
              </tr>
            </thead>
            <tbody id="tTbl"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PAGE: Employee read-only -->
    <div id="p-user" class="page">
      <div class="user-action-bar no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:10px;flex-wrap:wrap;">
        <button class="nb out" onclick="confirmLogout()" style="height:40px;padding:0 18px;font-size:12px;font-weight:600;">🔒 Logout</button>
        <div style="display:flex;gap:10px;">
          <button class="btn b-pdf" onclick="downloadPDF('user')">⬇ Download PDF</button>
          <button class="btn b-prn" onclick="doPrint('user')">🖨 Print</button>
        </div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;gap:14px;padding:12px 20px 10px;border-bottom:2px solid var(--g2);background:linear-gradient(90deg,var(--g0),var(--g1));">
          <img src="https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2019/11/korlogo.jpg"
            onerror="this.onerror=null;this.src='https://lrmdskorcitydiv.wordpress.com/wp-content/uploads/2020/05/korlogo2.jpg';this.onerror=function(){logoFallback(this,'SDO','#1a5c42');};"
            alt="SDO" style="width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.3);flex-shrink:0;">
          <div style="flex:1;text-align:center;">
            <div style="font-size:9px;font-weight:600;color:rgba(255,255,255,.7);letter-spacing:1.5px;text-transform:uppercase;">Republic of the Philippines · Department of Education</div>
            <div style="font-size:13px;font-weight:700;color:white;letter-spacing:.3px;margin-top:2px;">SDO City of Koronadal — Region XII</div>
            <div style="font-size:9px;color:rgba(255,255,255,.55);margin-top:1px;letter-spacing:.5px;">Employee Leave Record</div>
          </div>
        </div>
        <div class="ch grn center" id="uCardHdr">📋 My Leave Card</div>
        <div class="cb"><div id="uProf" class="pg"></div></div>
      </div>
      <div class="card" style="padding:0;">
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th rowspan="2">SO #</th><th rowspan="2" style="min-width:90px">Period / Dates</th>
                <th colspan="4" class="tha" id="uGA">Study / Vacation / Force Personal / Special Leave</th>
                <th colspan="4" class="thb">Sick / Maternity / Paternity Leave</th>
                <th rowspan="2" style="min-width:130px">Remarks / Nature of Action</th>
              </tr>
              <tr>
                <th class="ths">Earned</th><th class="ths">Abs W/P</th><th class="ths">Balance</th><th class="ths">W/O P</th>
                <th class="ths">Earned</th><th class="ths">Abs W/P</th><th class="ths">Balance</th><th class="ths">W/O P</th>
              </tr>
            </thead>
            <tbody id="uTbl"></tbody>
          </table>
        </div>
      </div>
    </div>

  </div>
</div>

<!-- MODAL A — Register/Edit Personnel -->
<div id="regMo" class="mo">
  <div class="mb">
    <div class="mh"><h3>Personnel Registration &amp; Update</h3><button class="btn b-slt b-sm" onclick="closeMo('regMo')">✕ Close</button></div>
    <div class="md">
      <input type="hidden" id="eIdx" value="-1">
      <input type="hidden" id="eOrigStatus" value="">
      <div class="sdiv">Account Credentials</div>
      <div class="ig" style="margin-bottom:18px;">
        <div class="f"><label>Employee ID <span style="color:#e53e3e;font-size:10px;">(8 digits)</span></label><input type="text" id="rID" maxlength="8" placeholder="e.g. 20240001" oninput="this.value=this.value.replace(/\D/g,'').slice(0,8)"></div>
        <div class="f"><label>Email Address <span style="color:#e53e3e;font-size:10px;">(@deped.gov.ph)</span></label><input type="email" id="rEmail" placeholder="e.g. juan@deped.gov.ph" oninput="enforceDepedEmail(this)"></div>
        <div class="f"><label>Password</label><div class="ew"><input type="password" id="rPw"><button class="eye-btn" onclick="toggleEye('rPw',this)">👁</button></div></div>
      </div>
      <div class="sdiv">Personal Information</div>
      <div class="ig" style="margin-bottom:18px;">
        <div class="f"><label>Surname</label><input type="text" id="rSur"></div>
        <div class="f"><label>Given Name</label><input type="text" id="rGiv"></div>
        <div class="f"><label>Suffix (Jr/III)</label><input type="text" id="rSuf"></div>
        <div class="f"><label>Maternal Surname</label><input type="text" id="rMat"></div>
        <div class="f"><label>Sex</label>
  <input list="sexList" id="rSex" placeholder="Select or type…" class="f-input" style="height:var(--H);padding:0 12px;border:1.5px solid var(--br);border-radius:7px;font-size:12px;width:100%;background:white;color:var(--cha);font-family:Inter,sans-serif;">
  <datalist id="sexList"><option value="Male"><option value="Female"></datalist>
</div>
        <div class="f"><label>Civil Status</label>
  <input list="civList" id="rCiv" placeholder="Select or type…" style="height:var(--H);padding:0 12px;border:1.5px solid var(--br);border-radius:7px;font-size:12px;width:100%;background:white;color:var(--cha);font-family:Inter,sans-serif;">
  <datalist id="civList"><option value="Single"><option value="Married"><option value="Widowed"><option value="Solo Parent"><option value="Separated"><option value="Annulled"></datalist>
</div>
        <div class="f"><label>Date of Birth</label><input type="date" id="rDOB"></div>
        <div class="f"><label>Place of Birth</label><input type="text" id="rPOB"></div>
        <div class="f" style="grid-column:span 2"><label>Present Address</label><input type="text" id="rAdd"></div>
        <div class="f" style="grid-column:span 2"><label>Name of Spouse</label><input type="text" id="rSpo"></div>
      </div>
      <div class="sdiv">Educational &amp; Civil Service</div>
      <div class="ig" style="margin-bottom:18px;">
        <div class="f" style="grid-column:span 2"><label>Educational Qualification</label><input type="text" id="rEdu"></div>
        <div class="f" style="grid-column:span 2"><label>C.S. Eligibility (Kind of Exam)</label><input type="text" id="rElig"></div>
        <div class="f"><label>Rating</label><input type="text" id="rRat"></div>
        <div class="f"><label>TIN Number</label><input type="text" id="rTin" placeholder="e.g. 123-456-789"></div>
        <div class="f"><label>Place of Exam</label><input type="text" id="rPEx"></div>
        <div class="f"><label>Date of Exam</label><input type="date" id="rDEx"></div>
        <div class="f"><label>Date of Original Appointment</label><input type="date" id="rApp"></div>
      </div>
      <div class="sdiv">Employment Details</div>
      <div class="ig">
        <div class="f"><label>Category</label>
  <input list="statList" id="rStat" placeholder="Select or type…" style="height:var(--H);padding:0 12px;border:1.5px solid var(--br);border-radius:7px;font-size:12px;width:100%;background:white;color:var(--cha);font-family:Inter,sans-serif;">
  <datalist id="statList"><option value="Teaching"><option value="Non-Teaching"></datalist>
</div>
        <div class="f"><label>Account Status</label>
  <select id="rAcctStatus" style="height:var(--H);padding:0 12px;border:1.5px solid var(--br);border-radius:7px;font-size:12px;width:100%;background:white;color:var(--cha);font-family:Inter,sans-serif;">
    <option value="active">Active</option>
    <option value="inactive">Inactive</option>
  </select>
</div>
        <div class="f"><label>Position / Designation</label><input type="text" id="rPos"></div>
        <div class="f" style="grid-column:span 2"><label>School / Office Assignment</label><input type="text" id="rSch"></div>
      </div>
    </div>
    <div class="mf"><button class="btn b-slt" onclick="closeMo('regMo')">Cancel</button><button class="btn b-grn" onclick="saveEmp()">💾 Save Record</button></div>
  </div>
</div>

<!-- MODAL B — Admin Profile -->
<div id="adminMo" class="mo">
  <div class="mb" style="max-width:560px;">
    <div class="mh"><h3>⚙️ Admin Profile &amp; Account Settings</h3><button class="btn b-slt b-sm" onclick="closeMo('adminMo')">✕</button></div>
    <div class="md" style="padding:18px 24px 10px;">

      <!-- ── SECTION 1: ADMIN ── -->
      <div class="acct-section" style="border:1.5px solid #1a5c42;border-radius:10px;padding:16px;margin-bottom:16px;background:linear-gradient(135deg,#f0fff4,#e6ffed);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--g1),var(--g2));display:flex;align-items:center;justify-content:center;font-size:15px;">👑</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--g1);">Administrator Account</div>
            <div style="font-size:10px;color:var(--mu);">Full system access — leave cards, personnel, settings</div>
          </div>
        </div>
        <div class="ig" style="row-gap:10px;">
          <div class="f" style="grid-column:span 2"><label>Display Name</label><input type="text" id="apName" placeholder="e.g. SDO Administrator"></div>
          <div class="f" style="grid-column:span 2"><label>Login Email <span style="color:#e53e3e;font-size:10px;">(@deped.gov.ph)</span></label><input type="email" id="apID" placeholder="admin@deped.gov.ph" oninput="enforceDepedEmail(this)"></div>
          <div class="f"><label>New Password <span style="color:var(--mu);font-size:10px;">(blank = keep)</span></label><div class="ew"><input type="password" id="apPw" placeholder="New password"><button class="eye-btn" onclick="toggleEye('apPw',this)">👁</button></div></div>
          <div class="f"><label>Confirm Password</label><div class="ew"><input type="password" id="apPw2" placeholder="Repeat password"><button class="eye-btn" onclick="toggleEye('apPw2',this)">👁</button></div></div>
        </div>
        <p id="apErr" style="color:var(--rd);font-size:11px;display:none;margin-top:8px;"></p>
      </div>

      <!-- ── SECTION 2: ENCODER ── -->
      <div id="apEncSection" class="acct-section" style="border:1.5px solid var(--nb);border-radius:10px;padding:16px;margin-bottom:16px;background:linear-gradient(135deg,#eff6ff,#dbeafe);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#1e3a6e,#2d5a9e);display:flex;align-items:center;justify-content:center;font-size:15px;">✏️</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#1e3a6e;">Encoder Account</div>
            <div style="font-size:10px;color:var(--mu);">Can edit leave cards and personnel records</div>
          </div>
        </div>
        <div class="ig" style="row-gap:10px;">
          <div class="f" style="grid-column:span 2"><label>Display Name</label><input type="text" id="apEncName" placeholder="e.g. Records Encoder"></div>
          <div class="f" style="grid-column:span 2"><label>Login Email <span style="color:#e53e3e;font-size:10px;">(@deped.gov.ph)</span></label><input type="email" id="apEncID" placeholder="encoder@deped.gov.ph" oninput="enforceDepedEmail(this)"></div>
          <div class="f" style="grid-column:span 2"><label>New Password <span style="color:var(--mu);font-size:10px;">(blank = keep)</span></label><div class="ew"><input type="password" id="apEncPw" placeholder="New encoder password"><button class="eye-btn" onclick="toggleEye('apEncPw',this)">👁</button></div></div>
        </div>
      </div>

      <!-- ── SECTION 3: SCHOOL ADMIN ── -->
      <div id="apSASection" class="acct-section" style="border:1.5px solid #7c3aed;border-radius:10px;padding:16px;margin-bottom:4px;background:linear-gradient(135deg,#faf5ff,#ede9fe);display:none;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);display:flex;align-items:center;justify-content:center;font-size:15px;">🏫</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#5b21b6;">School Admin Accounts</div>
            <div style="font-size:10px;color:var(--mu);">Can register &amp; edit personnel only — no leave card access</div>
          </div>
        </div>
        <!-- List of existing school admin accounts -->
        <div id="saAccountsList" style="margin-bottom:12px;"></div>
        <!-- Inline form to add/edit a school admin -->
        <div id="saInlineForm" style="background:white;border:1.5px dashed #a855f7;border-radius:8px;padding:14px;display:none;">
          <div style="font-size:11px;font-weight:700;color:#5b21b6;margin-bottom:10px;" id="saInlineTitle">➕ New School Admin</div>
          <input type="hidden" id="saInlineDbId" value="0">
          <div class="ig" style="row-gap:10px;">
            <div class="f" style="grid-column:span 2"><label>Display Name <span style="color:#e53e3e;font-size:10px;">*</span></label><input type="text" id="saInlineName" placeholder="e.g. Juan Dela Cruz"></div>
            <div class="f" style="grid-column:span 2"><label>Login Email <span style="color:#e53e3e;font-size:10px;">(@deped.gov.ph) *</span></label><input type="email" id="saInlineEmail" placeholder="schooladmin@deped.gov.ph" oninput="enforceDepedEmail(this)"></div>
            <div class="f" style="grid-column:span 2"><label id="saInlinePwLabel">Password <span style="color:#e53e3e;font-size:10px;">*</span></label><div class="ew"><input type="password" id="saInlinePw" placeholder="Enter password"><button class="eye-btn" onclick="toggleEye('saInlinePw',this)">👁</button></div></div>
          </div>
          <p id="saInlineErr" style="color:var(--rd);font-size:11px;display:none;margin-top:8px;"></p>
          <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="btn b-slt b-sm" onclick="closeSAInlineForm()">Cancel</button>
            <button class="btn b-sm" style="background:#7c3aed;color:white;" onclick="saveSAInline()">💾 Save Account</button>
          </div>
        </div>
        <button class="btn b-sm" style="background:#7c3aed;color:white;margin-top:4px;" onclick="openSAInlineForm(0)" id="saAddBtn">➕ Add School Admin</button>
      </div>

    </div>
    <div class="mf" style="gap:10px;">
      <button class="btn b-slt" onclick="closeMo('adminMo')">Cancel</button>
      <button class="btn b-pri" onclick="saveAdminProfile()">💾 Save Admin &amp; Encoder</button>
    </div>
  </div>
</div>

<!-- MODAL B2 — Encoder Profile (name only) -->
<div id="encoderMo" class="mo">
  <div class="mb xsm">
    <div class="mh"><h3>Encoder Profile</h3><button class="btn b-slt b-sm" onclick="closeMo('encoderMo')">✕</button></div>
    <div class="md">
      <p style="font-size:12px;color:var(--mu);margin-bottom:16px;line-height:1.65;">You can update your display name. Contact the Admin to change your login ID or password.</p>
      <div class="sdiv">Display Name</div>
      <div class="ig" style="margin-bottom:4px;">
        <div class="f" style="grid-column:span 2"><label>Name Shown in Topbar</label><input type="text" id="encProfName"></div>
      </div>
      <p id="encProfErr" style="color:var(--rd);font-size:11.5px;display:none;margin-top:8px;"></p>
    </div>
    <div class="mf"><button class="btn b-slt" onclick="closeMo('encoderMo')">Cancel</button><button class="btn b-pri" onclick="saveEncoderProfile()">💾 Save</button></div>
  </div>
</div>

<!-- MODAL C — Logout Confirmation -->
<div id="logoutMo" class="mo">
  <div class="mb xsm">
    <div class="mh"><h3 style="font-family:'Cormorant Garamond',serif;font-size:1.2rem;color:var(--g1)">Until next time</h3><button class="btn b-slt b-sm" onclick="closeMo('logoutMo')">✕</button></div>
    <div class="md" style="text-align:center;padding:36px 28px 28px;">
      <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--g1),var(--g2));display:flex;align-items:center;justify-content:center;margin:0 auto 18px;box-shadow:0 4px 18px rgba(26,92,66,.25);">
        <span style="font-size:1.8rem;line-height:1">🔒</span>
      </div>
      <p style="font-size:15px;font-weight:700;color:var(--cha);margin-bottom:6px;">Log out of the system?</p>
      <p style="font-size:12px;color:var(--mu);line-height:1.6;">You will be returned to the login screen.</p>
    </div>
    <div class="mf" style="gap:10px;">
      <button class="btn b-slt" style="flex:1" onclick="closeMo('logoutMo')">Cancel</button>
      <button class="btn b-red" style="flex:1" onclick="doLogout()">🔒 Logout</button>
    </div>
  </div>
</div>

<!-- MODAL D — Edit Leave Record -->
<div id="editRecMo" class="mo">
  <div class="mb sm">
    <div class="mh"><h3>&#9998; Edit Leave Record</h3><button class="btn b-slt b-sm" onclick="closeMo('editRecMo')">&#10005;</button></div>
    <div class="md">
      <div class="ig" style="margin-bottom:14px;">
        <div class="f"><label>Special Order #</label><input type="text" id="eRSO"></div>
        <div class="f"><label>Period Covered</label><input type="text" id="eRPrd"></div>
        <div class="f">
          <label>Date From</label>
          <div class="date-wrap">
            <input type="text" id="eRFr" placeholder="mm/dd/yyyy" maxlength="10" oninput="fmtDateInput(this);syncDatePicker('eRFr','eRFrPick')" class="date-text">
            <input type="date" id="eRFrPick" class="date-pick-hidden" onchange="syncFromPicker('eRFrPick','eRFr')">
            <button type="button" class="date-cal-btn" tabindex="-1">📅</button>
          </div>
        </div>
        <div class="f">
          <label>Date To</label>
          <div class="date-wrap">
            <input type="text" id="eRTo" placeholder="mm/dd/yyyy" maxlength="10" oninput="fmtDateInput(this);syncDatePicker('eRTo','eRToPick')" class="date-text">
            <input type="date" id="eRToPick" class="date-pick-hidden" onchange="syncFromPicker('eRToPick','eRTo')">
            <button type="button" class="date-cal-btn" tabindex="-1">📅</button>
          </div>
        </div>
        <div class="f">
          <label>Nature of Action</label>
          <input list="eRLL" id="eRAct" placeholder="Select or type..." oninput="eRNC(this.value)" autocomplete="off">
          <datalist id="eRLL">
            <option value="Vacation Leave"><option value="Mandatory/Force Leave">
            <option value="Sick Leave"><option value="Personal Leave">
            <option value="Compensatory Time Off (CTO)"><option value="Maternity Leave">
            <option value="Paternity Leave"><option value="Special Privilege Leave (SPL)">
            <option value="Solo Parent Leave"><option value="Study Leave">
            <option value="Rehabilitation Leave"><option value="Wellness Leave">
            <option value="Special Leave Benefits for Women (Magna Carta)">
            <option value="Violence Against Women and Children (VAWC) Leave">
            <option value="Terminal Leave"><option value="Monetization">
            <option value="Monetization (disapproved)"><option value="Force Leave (disapproved)">
            <option value="From DENR Region 12">
          </datalist>
        </div>
        <div class="f"><label>Additional Note</label><input type="text" id="eRActNote" placeholder="e.g. per CSC MC No. 14"></div>
        <div class="f"><label>Value Earned</label><input type="number" id="eRErn" step="0.001"></div>
        <div class="f"><label>Force Leave Number</label><input type="number" id="eRForce" step="1"></div>
      </div>
      <div id="eRMF" style="display:none;margin-bottom:14px;">
        <div class="sdiv">&#128176; Monetization &#8212; Deduct Amounts</div>
        <div class="ig">
          <div class="f hl"><label>Amount (Vacation Col / NT)</label><input type="number" id="eRMV" step="0.001"></div>
          <div class="f hl"><label>Amount (Sick Col / NT)</label><input type="number" id="eRMS" step="0.001"></div>
          <div class="f hl"><label>Amount (Teaching)</label><input type="number" id="eRMon" step="0.001"></div>
        </div>
      </div>
      <div id="eRMDF" style="display:none;margin-bottom:14px;">
        <div class="sdiv">&#128260; Monetization (Disapproved) &#8212; Add Back</div>
        <div class="ig">
          <div class="f hl"><label>Add-Back (Vacation Col / NT)</label><input type="number" id="eRMDV" step="0.001"></div>
          <div class="f hl"><label>Add-Back (Sick Col / NT)</label><input type="number" id="eRMDS" step="0.001"></div>
          <div class="f hl"><label>Add-Back (Teaching)</label><input type="number" id="eRMonDis" step="0.001"></div>
        </div>
      </div>
      <div id="eRTrF" style="display:none;margin-bottom:14px;">
        <div class="sdiv">&#128257; Transfer Balance &#8212; Initial Credits from Other Organization</div>
        <div class="ig">
          <div class="f hl"><label>Vacation Col Balance (NT) / Balance (T)</label><input type="number" id="eRTrV" step="0.001"></div>
          <div class="f hl"><label>Sick Col Balance (NT only)</label><input type="number" id="eRTrS" step="0.001"></div>
        </div>
      </div>
    </div>
    <div class="mf">
      <button class="btn b-slt" onclick="closeMo('editRecMo')">Cancel</button>
      <button class="btn b-pri" onclick="saveEditMo()">&#128190; Save Changes</button>
    </div>
  </div>
</div>

<!-- MODAL: Delete Row (password confirm) -->
<div id="deleteRowMo" class="mo">
  <div class="mb xsm">
    <div class="mh"><h3>🔐 Confirm Deletion</h3><button class="btn b-slt b-sm" onclick="closeMo('deleteRowMo')">✕</button></div>
    <div class="md" style="padding:24px 28px 16px;">
      <p style="font-size:13px;font-weight:600;color:var(--cha);margin-bottom:6px;">⚠️ Confirm row deletion</p>
      <p style="font-size:11.5px;color:var(--mu);line-height:1.6;margin-bottom:18px;">Enter your email and password to authorize this deletion. This action cannot be undone.</p>
      <div class="f" style="margin-bottom:12px;"><label>Email / Login ID</label><input type="email" id="delRowEmail" placeholder="your@email.com" style="height:40px;padding:0 12px;border:1.5px solid var(--br);border-radius:7px;font-size:12px;width:100%;font-family:Inter,sans-serif;"></div>
      <div class="f" style="margin-bottom:6px;"><label>Password</label><div class="ew"><input type="password" id="delRowPw" placeholder="Enter your password" onkeydown="if(event.key==='Enter')confirmDeleteRow()" style="height:40px;padding:0 36px 0 12px;border:1.5px solid var(--br);border-radius:7px;font-size:12px;width:100%;font-family:Inter,sans-serif;"><button class="eye-btn" onclick="toggleEye('delRowPw',this)">👁</button></div></div>
      <p id="delRowErr" style="color:var(--rd);font-size:11px;display:none;margin-top:6px;"></p>
    </div>
    <div class="mf" style="gap:10px;">
      <button class="btn b-slt" style="flex:1" onclick="closeMo('deleteRowMo')">Cancel</button>
      <button class="btn b-red" style="flex:1" onclick="confirmDeleteRow()">🗑️ Delete Row</button>
    </div>
  </div>
</div>

<!-- MODAL: Delete Era (password confirm) -->
<div id="deleteEraMo" class="mo">
  <div class="mb xsm">
    <div class="mh"><h3>🔐 Confirm Era Deletion</h3><button class="btn b-slt b-sm" onclick="closeMo('deleteEraMo')">✕</button></div>
    <div class="md" style="padding:24px 28px 16px;">
      <p style="font-size:13px;font-weight:600;color:var(--cha);margin-bottom:6px;">⚠️ Delete this empty era?</p>
      <p style="font-size:11.5px;color:var(--mu);line-height:1.6;margin-bottom:18px;">This will remove the era conversion marker. The employee's category will <b>not</b> be changed. Enter your credentials to confirm. This action cannot be undone.</p>
      <div class="f" style="margin-bottom:12px;"><label>Email / Login ID</label><input type="email" id="delEraEmail" placeholder="your@email.com" style="height:40px;padding:0 12px;border:1.5px solid var(--br);border-radius:7px;font-size:12px;width:100%;font-family:Inter,sans-serif;"></div>
      <div class="f" style="margin-bottom:6px;"><label>Password</label><div class="ew"><input type="password" id="delEraPw" placeholder="Enter your password" onkeydown="if(event.key==='Enter')doDeleteEra()" style="height:40px;padding:0 36px 0 12px;border:1.5px solid var(--br);border-radius:7px;font-size:12px;width:100%;font-family:Inter,sans-serif;"><button class="eye-btn" onclick="toggleEye('delEraPw',this)">👁</button></div></div>
      <p id="delEraErr" style="color:var(--rd);font-size:11px;display:none;margin-top:6px;"></p>
    </div>
    <div class="mf" style="gap:10px;">
      <button class="btn b-slt" style="flex:1" onclick="closeMo('deleteEraMo')">Cancel</button>
      <button class="btn b-red" style="flex:1" onclick="doDeleteEra()">🗑️ Delete Era</button>
    </div>
  </div>
</div>
<div id="cardStatusMo" class="mo">
  <div class="mb" style="max-width:700px;">
    <div class="mh"><h3>📊 Leave Card Update Status — <span id="cardStatusMonth"></span></h3><button class="btn b-slt b-sm" onclick="closeMo('cardStatusMo')">✕</button></div>
    <div class="md" style="padding:16px 20px;">
      <div id="cardStatusBody"></div>
    </div>
  </div>
</div>

<!-- MODAL: School Admin Profile (self-edit name only) -->
<div id="saProfMo" class="mo">
  <div class="mb xsm">
    <div class="mh"><h3>🏫 School Admin Profile</h3><button class="btn b-slt b-sm" onclick="closeMo('saProfMo')">✕</button></div>
    <div class="md" style="padding:20px 24px 12px;">
      <p style="font-size:12px;color:var(--mu);margin-bottom:16px;line-height:1.65;">You can update your display name. Contact the Admin to change your login email or password.</p>
      <div class="f" style="margin-bottom:6px;"><label>Display Name</label><input type="text" id="saProfName" style="height:40px;padding:0 12px;border:1.5px solid var(--br);border-radius:7px;font-size:12px;width:100%;font-family:Inter,sans-serif;box-sizing:border-box;"></div>
      <p id="saProfErr" style="color:var(--rd);font-size:11px;display:none;margin-top:6px;"></p>
    </div>
    <div class="mf" style="gap:10px;">
      <button class="btn b-slt" style="flex:1" onclick="closeMo('saProfMo')">Cancel</button>
      <button class="btn b-pri" style="flex:1" onclick="saveSAProfile()">💾 Save</button>
    </div>
  </div>
</div>

<div id="printPageHeader"></div>
<div id="pdfArea"></div>
<!-- External JavaScript -->
<script>
// Auto-append @deped.gov.ph hint: show inline error if email doesn't match domain
function enforceDepedEmail(inp){
  const v=inp.value.trim().toLowerCase();
  let hint=inp.parentElement.querySelector('.email-hint');
  if(!hint){
    hint=document.createElement('span');
    hint.className='email-hint';
    hint.style.cssText='font-size:10px;color:#e53e3e;display:none;margin-top:3px;';
    inp.parentElement.appendChild(hint);
  }
  if(v && !v.endsWith('@deped.gov.ph')){
    hint.textContent='⚠️ Email must end with @deped.gov.ph';
    hint.style.display='block';
  } else {
    hint.style.display='none';
  }
}
</script>
<script src="systemjs.js"></script>

</body>
</html>