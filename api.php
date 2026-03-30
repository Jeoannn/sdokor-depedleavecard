<?php
// ============================================================
//  SDO City of Koronadal — Leave Management System
//  api.php — MySQL Backend API
//  Database: db
// ============================================================

ob_start(); // buffer any stray output so it never corrupts JSON

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// ── GLOBAL ERROR HANDLER — always return JSON, never raw HTML ──
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    ob_end_clean();
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => "PHP Error [$errno]: $errstr in $errfile on line $errline"]);
    exit;
});
register_shutdown_function(function() {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        ob_end_clean();
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => "Fatal: {$e['message']} in {$e['file']} on line {$e['line']}"]);
    }
});

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ── DB CONNECTION ──────────────────────────────────────────────
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'mydatabase');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');

try {

    $pdo = new PDO(
        'mysql:host='.DB_HOST.';dbname='.DB_NAME.';charset=utf8mb4',
        DB_USER, DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
         PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (PDOException $e) {
    jsonError('DB connection failed: ' . $e->getMessage(), 500);
}

// ── SELF-HEALING SCHEMA — add any missing columns automatically ──
// Matches the current DB schema exactly. Safe to run on every request.
(function() use ($pdo) {
    $required = [
        'leave_records' => [
            'sort_order'      => 'sort_order      INT           NOT NULL DEFAULT 0',
            'so'              => 'so              VARCHAR(100)  DEFAULT NULL',
            'prd'             => 'prd             VARCHAR(100)  DEFAULT NULL',
            'from_date'       => 'from_date       DATE          DEFAULT NULL',
            'to_date'         => 'to_date         DATE          DEFAULT NULL',
            'spec'            => 'spec            VARCHAR(200)  DEFAULT NULL',
            'action'          => 'action          VARCHAR(255)  DEFAULT NULL',
            'force_amount'    => 'force_amount    DECIMAL(10,3) NOT NULL DEFAULT 0',
            'setA_earned'     => 'setA_earned     DECIMAL(10,3) NOT NULL DEFAULT 0',
            'setA_abs_wp'     => 'setA_abs_wp     DECIMAL(10,3) NOT NULL DEFAULT 0',
            'setA_balance'    => 'setA_balance    DECIMAL(10,3) NOT NULL DEFAULT 0',
            'setA_wop'        => 'setA_wop        DECIMAL(10,3) NOT NULL DEFAULT 0',
            'setB_earned'     => 'setB_earned     DECIMAL(10,3) NOT NULL DEFAULT 0',
            'setB_abs_wp'     => 'setB_abs_wp     DECIMAL(10,3) NOT NULL DEFAULT 0',
            'setB_balance'    => 'setB_balance    DECIMAL(10,3) NOT NULL DEFAULT 0',
            'setB_wop'        => 'setB_wop        DECIMAL(10,3) NOT NULL DEFAULT 0',
            'is_conversion'   => 'is_conversion   TINYINT(1)    NOT NULL DEFAULT 0',
            'from_status'     => 'from_status     VARCHAR(50)   DEFAULT NULL',
            'to_status'       => 'to_status       VARCHAR(50)   DEFAULT NULL',
            'conversion_date' => 'conversion_date DATE          DEFAULT NULL',
        ],
        'personnel' => [
            'account_status'  => "account_status  ENUM('active','inactive') NOT NULL DEFAULT 'active'",
        ],
    ];
    foreach ($required as $table => $columns) {
        $existing = [];
        foreach ($pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_ASSOC) as $col) {
            $existing[] = strtolower($col['Field']);
        }
        foreach ($columns as $colName => $definition) {
            if (!in_array(strtolower($colName), $existing)) {
                $pdo->exec("ALTER TABLE `$table` ADD COLUMN $definition");
            }
        }
    }
    // ── Remove legacy tr_v / tr_s columns if they still exist ──
    $lrCols = array_column($pdo->query("SHOW COLUMNS FROM `leave_records`")->fetchAll(PDO::FETCH_ASSOC), 'Field');
    foreach (['tr_v', 'tr_s'] as $drop) {
        if (in_array($drop, $lrCols)) {
            $pdo->exec("ALTER TABLE `leave_records` DROP COLUMN `$drop`");
        }
    }
})();

// ── ROUTER ────────────────────────────────────────────────────
$action = $_GET['action'] ?? (getPost()['action'] ?? '');

switch ($action) {

    // ── AUTH ──────────────────────────────────────────────────
    case 'login':            doLogin();           break;
    case 'save_admin':       doSaveAdmin();       break;
    case 'save_encoder':     doSaveEncoder();     break;
    case 'save_school_admin': doSaveSchoolAdmin(); break;
    case 'delete_school_admin': doDeleteSchoolAdmin(); break;
    case 'get_school_admins': doGetSchoolAdmins(); break;

    // ── PERSONNEL ─────────────────────────────────────────────
    case 'get_personnel':    doGetPersonnel();    break;
    case 'save_employee':    doSaveEmployee();    break;
    case 'archive':          doArchive();         break;
    case 'unarchive':        doUnarchive();       break;

    // ── LEAVE RECORDS ─────────────────────────────────────────
    case 'get_records':      doGetRecords();      break;
    case 'save_record':      doSaveRecord();      break;
    case 'update_record':    doUpdateRecord();    break;
    case 'delete_record':    doDeleteRecord();    break;
    case 'delete_era':       doDeleteEra();       break;
    case 'reorder_records':  doReorderRecords();  break;
    case 'save_row_balance': doSaveRowBalance();  break;

    default: jsonError('Unknown action: ' . $action);
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function getPost() {
    static $parsed = null;
    if ($parsed === null) {
        $raw    = file_get_contents('php://input');
        $parsed = json_decode($raw, true) ?? [];
    }
    return $parsed;
}

function jsonOk($data = []) { ob_end_clean(); echo json_encode(['ok' => true] + $data); exit; }

function jsonError($msg, $code = 400) {
    ob_end_clean();
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
}

function req($key) {
    $p = getPost();
    if (!array_key_exists($key, $p)) jsonError("Missing field: $key");
    return $p[$key];
}

function opt($key, $default = null) { $p = getPost(); return $p[$key] ?? $default; }

// Convert JS record object → leave_records row array.
// Columns stored: all schema columns exactly. fwd_bv/fwd_bs do NOT exist in this
// schema — forwarded conversion balances are carried via setA_balance/setB_balance.
// mon_v/mon_s/mon_dv/mon_ds/monAmount/monDisAmt are JS-only (not stored).
// tr_v and tr_s have been REMOVED from the schema; transfer credit amounts are now
// stored in setA_earned (vacation/balance credit) and setB_earned (sick credit),
// exactly like all other earned values — save_row_balance writes those columns.
// earned is JS-only; the stored equivalent is setA_earned (written by save_row_balance).
function recordToRow(array $r, string $empId, int $sortOrder): array {
    $isConv = !empty($r['_conversion']);
    $action = strtolower($r['action'] ?? '');
    $isTransfer = str_contains($action, 'from denr');

    // For transfer rows, seed setA_earned/setB_earned from trV/trS so the first
    // save already has the correct values before save_row_balance fires.
    $setAEarned = isset($r['setA_earned']) ? (float)$r['setA_earned']
                : ($isTransfer ? (isset($r['trV']) ? (float)$r['trV'] : 0) : 0);
    $setBEarned = isset($r['setB_earned']) ? (float)$r['setB_earned']
                : ($isTransfer ? (isset($r['trS']) ? (float)$r['trS'] : 0) : 0);

    return [
        'employee_id'    => $empId,
        'sort_order'     => $sortOrder,
        'so'             => $r['so']    ?? '',
        'prd'            => $isConv ? '' : ($r['prd'] ?? ''),
        'from_date'      => normaliseDate($r['from'] ?? ''),
        'to_date'        => normaliseDate($r['to']   ?? ''),
        'spec'           => $r['spec']   ?? '',
        'action'         => $r['action'] ?? '',
        'force_amount'   => isset($r['forceAmount']) ? (float)$r['forceAmount'] : 0,
        // Running-balance columns (written by save_row_balance; seeded as 0 on first insert).
        // For conversion marker rows, setA_balance/setB_balance store the forwarded
        // balance (fwdBV / fwdBS) since this schema has no separate fwd_bv/fwd_bs columns.
        'setA_earned'    => $setAEarned,
        'setA_abs_wp'    => isset($r['setA_abs_wp'])  ? (float)$r['setA_abs_wp']  : 0,
        'setA_balance'   => $isConv
                              ? (isset($r['fwdBV']) ? (float)$r['fwdBV'] : 0)
                              : (isset($r['setA_balance']) ? (float)$r['setA_balance'] : 0),
        'setA_wop'       => isset($r['setA_wop'])     ? (float)$r['setA_wop']     : 0,
        'setB_earned'    => $setBEarned,
        'setB_abs_wp'    => isset($r['setB_abs_wp'])  ? (float)$r['setB_abs_wp']  : 0,
        'setB_balance'   => $isConv
                              ? (isset($r['fwdBS']) ? (float)$r['fwdBS'] : 0)
                              : (isset($r['setB_balance']) ? (float)$r['setB_balance'] : 0),
        'setB_wop'       => isset($r['setB_wop'])     ? (float)$r['setB_wop']     : 0,
        // Conversion marker fields
        'is_conversion'  => $isConv ? 1 : 0,
        'from_status'    => $r['fromStatus']  ?? '',
        'to_status'      => $r['toStatus']    ?? '',
        'conversion_date'=> normaliseDate($r['date'] ?? ''),
        // tr_v / tr_s REMOVED — transfer credits live in setA_earned / setB_earned
    ];
}

// Convert leave_records DB row → JS record object.
//
// tr_v / tr_s columns have been REMOVED from the schema.
// For transfer rows ("from denr"), trV and trS are reconstructed from
// setA_earned and setB_earned respectively (where save_row_balance stores them).
// earned / mon_* are JS-only (not in DB); reconstructed from stored columns:
//   • earned      → setA_earned  (accrual rows; also used by Teaching balance logic)
//   • monAmount   → setA_abs_wp  (Teaching monetization amount)
//   • monDisAmt   → setA_abs_wp  (Teaching monetization-disapproved amount)
//   • monV/monDV  → setA_abs_wp  (NT vacation monetization / disapproved)
//   • monS/monDS  → setB_abs_wp  (NT sick monetization / disapproved)
// fwd_bv / fwd_bs do NOT exist in this schema; forwarded balances for conversions
// are carried via setA_balance / setB_balance on the conversion marker row.
function rowToRecord(array $row): array {
    $action  = strtolower($row['action'] ?? '');
    $isMon   = str_contains($action, 'monetization') && !str_contains($action, 'disapproved');
    $isMD    = str_contains($action, 'monetization') &&  str_contains($action, 'disapproved');
    $isXfer  = str_contains($action, 'from denr');

    $setAE = (float)($row['setA_earned']  ?? 0);
    $setBE = (float)($row['setB_earned']  ?? 0);
    $setAA = (float)($row['setA_abs_wp']  ?? 0);
    $setBA = (float)($row['setB_abs_wp']  ?? 0);

    $r = [
        'so'           => $row['so']          ?? '',
        'prd'          => $row['prd']         ?? '',
        'from'         => $row['from_date']   ?? '',
        'to'           => $row['to_date']     ?? '',
        'spec'         => $row['spec']        ?? '',
        'action'       => $row['action']      ?? '',
        'forceAmount'  => (float)($row['force_amount'] ?? 0),
        // JS-only fields reconstructed from stored balance columns
        'earned'       => $setAE,
        'monAmount'    => $isMon ? $setAA : 0,
        'monDisAmt'    => $isMD  ? $setAA : 0,
        'monV'         => $isMon ? $setAA : 0,
        'monS'         => $isMon ? $setBA : 0,
        'monDV'        => $isMD  ? $setAA : 0,
        'monDS'        => $isMD  ? $setBA : 0,
        // trV / trS reconstructed from setA_earned / setB_earned for transfer rows
        'trV'          => $isXfer ? $setAE : 0,
        'trS'          => $isXfer ? $setBE : 0,
        // Stored balance columns
        'setA_earned'  => $setAE,
        'setA_abs_wp'  => $setAA,
        'setA_balance' => (float)($row['setA_balance'] ?? 0),
        'setA_wop'     => (float)($row['setA_wop']     ?? 0),
        'setB_earned'  => $setBE,
        'setB_abs_wp'  => $setBA,
        'setB_balance' => (float)($row['setB_balance'] ?? 0),
        'setB_wop'     => (float)($row['setB_wop']     ?? 0),
        '_record_id'   => (int)$row['record_id'],
    ];
    if (!empty($row['is_conversion'])) {
        $r['_conversion'] = true;
        $r['fromStatus']  = $row['from_status']     ?? '';
        $r['toStatus']    = $row['to_status']       ?? '';
        $r['date']        = $row['conversion_date'] ?? '';
        // Forwarded balances stored in the balance columns of the conversion marker row
        $r['fwdBV']       = (float)($row['setA_balance'] ?? 0);
        $r['fwdBS']       = (float)($row['setB_balance'] ?? 0);
    }
    return $r;
}

// Accept YYYY-MM-DD or mm/dd/yyyy; returns YYYY-MM-DD or null
function normaliseDate(?string $d): ?string {
    if (!$d) return null;
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) return $d;
    if (preg_match('#^(\d{2})/(\d{2})/(\d{4})$#', $d, $m)) return "$m[3]-$m[1]-$m[2]";
    return null;
}

// ═══════════════════════════════════════════════════════════════
//  AUTH ACTIONS
// ═══════════════════════════════════════════════════════════════
function doLogin() {
    global $pdo;
    $id = strtolower(trim(req('id')));
    $pw = req('password');

    // Empty credential guard
    if (!$id || !$pw) jsonError('Please enter your email and password.', 401);

    // ── Admin / Encoder login ──
    $stmt = $pdo->prepare('SELECT * FROM admin_config WHERE LOWER(login_id)=?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();

    if ($row && $row['password'] === $pw) {
        jsonOk([
            'role'     => $row['role'],
            'name'     => $row['name'],
            'login_id' => $row['login_id'],
            'db_id'    => (int)$row['id'],
        ]);
    }

    // ── Employee login ──
    $stmt2->execute([$id]);
    $emp = $stmt2->fetch();

    if ($emp && $emp['password'] === $pw) {
        // Block inactive accounts
        $acctStatus = $emp['account_status'] ?? 'active';
        if ($acctStatus === 'inactive') {
            jsonError('Your account is inactive. Please contact the administrator.', 403);
        }
        jsonOk([
            'role'           => 'employee',
            'employee_id'    => $emp['employee_id'],
            'name'           => trim($emp['given'].' '.$emp['surname']),
            'status'         => $emp['status'],
            'account_status' => $acctStatus,
        ]);
    }

    jsonError('Incorrect email or password. Please try again.', 401);
}

function doSaveAdmin() {
    global $pdo;
    $name  = trim(req('name'));
    $newId = trim(req('login_id'));
    $pw    = opt('password', '');

    if (!$name || !$newId) jsonError('Name and login ID are required.');
    if (!str_ends_with(strtolower($newId), '@deped.gov.ph')) jsonError('Login ID must use the @deped.gov.ph domain.');

    $stmt = $pdo->prepare("SELECT * FROM admin_config WHERE role='admin' LIMIT 1");
    $stmt->execute();
    $row = $stmt->fetch();

    if ($row) {
        $finalPw = ($pw !== '') ? $pw : $row['password'];
        $pdo->prepare("UPDATE admin_config SET name=?, login_id=?, password=? WHERE id=?")
            ->execute([$name, $newId, $finalPw, $row['id']]);
    } else {
        $finalPw = $pw !== '' ? $pw : 'admin123';
        $pdo->prepare("INSERT INTO admin_config (login_id,password,name,role) VALUES (?,?,?,'admin')")
            ->execute([$newId, $finalPw, $name]);
    }

    $encName = opt('enc_name', '');
    $encId   = opt('enc_login_id', '');
    $encPw   = opt('enc_password', '');

    $stmt2 = $pdo->prepare("SELECT * FROM admin_config WHERE role='encoder' LIMIT 1");
    $stmt2->execute();
    $enc = $stmt2->fetch();
    if ($enc) {
        $updates = [];
        if ($encName) $updates['name']     = $encName;
        if ($encId)   $updates['login_id'] = $encId;
        if ($encPw)   $updates['password'] = $encPw;
        if ($updates) {
            $sets = implode(',', array_map(fn($k) => "$k=?", array_keys($updates)));
            $vals = array_values($updates);
            $vals[] = $enc['id'];
            $pdo->prepare("UPDATE admin_config SET $sets WHERE id=?")->execute($vals);
        }
    } else if ($encId) {
        $ePw = $encPw ?: 'encoder123';
        $pdo->prepare("INSERT INTO admin_config (login_id,password,name,role) VALUES (?,?,?,'encoder')")
            ->execute([$encId, $ePw, $encName ?: 'Encoder']);
    }

    jsonOk();
}

function doSaveEncoder() {
    global $pdo;
    $name = trim(req('name'));
    if (!$name) jsonError('Name is required.');
    $stmt = $pdo->prepare("SELECT id FROM admin_config WHERE role='encoder' LIMIT 1");
    $stmt->execute();
    $row = $stmt->fetch();
    if ($row) {
        $pdo->prepare("UPDATE admin_config SET name=? WHERE id=?")->execute([$name, $row['id']]);
    }
    jsonOk();
}

// ═══════════════════════════════════════════════════════════════
//  SCHOOL ADMIN ACTIONS
// ═══════════════════════════════════════════════════════════════
function doGetSchoolAdmins() {
    global $pdo;
    $stmt = $pdo->prepare("SELECT id, login_id, name FROM admin_config WHERE role='school_admin' ORDER BY name");
    $stmt->execute();
    jsonOk(['school_admins' => $stmt->fetchAll()]);
}

function doSaveSchoolAdmin() {
    global $pdo;
    $p    = getPost();
    $saId = (int)($p['sa_id'] ?? 0); // DB row id; 0 = new
    $name = trim($p['name']    ?? '');
    $loginId = strtolower(trim($p['login_id'] ?? ''));
    $pw   = $p['password'] ?? '';

    if (!$name)    jsonError('Display name is required.');
    if (!$loginId) jsonError('Login email is required.');
    if (!filter_var($loginId, FILTER_VALIDATE_EMAIL)) jsonError('Invalid email format.');
    if (!str_ends_with($loginId, '@deped.gov.ph'))
        jsonError('Login ID must use @deped.gov.ph domain.');

    // Duplicate login_id check
    $dupStmt = $pdo->prepare('SELECT id FROM admin_config WHERE LOWER(login_id)=? AND id!=?');
    $dupStmt->execute([$loginId, $saId]);
    if ($dupStmt->fetch()) jsonError('That email is already in use by another account.');

    if ($saId > 0) {
        // UPDATE existing school_admin
        $existing = $pdo->prepare("SELECT * FROM admin_config WHERE id=? AND role='school_admin'");
        $existing->execute([$saId]);
        $row = $existing->fetch();
        if (!$row) jsonError('School Admin account not found.');
        $finalPw = ($pw !== '') ? $pw : $row['password'];
        $pdo->prepare("UPDATE admin_config SET name=?, login_id=?, password=? WHERE id=?")
            ->execute([$name, $loginId, $finalPw, $saId]);
    } else {
        // INSERT new school_admin
        if (!$pw) jsonError('Password is required for new accounts.');
        $pdo->prepare("INSERT INTO admin_config (login_id, password, name, role) VALUES (?,?,?,'school_admin')")
            ->execute([$loginId, $pw, $name]);
        $saId = (int)$pdo->lastInsertId();
    }
    jsonOk(['sa_id' => $saId]);
}

function doDeleteSchoolAdmin() {
    global $pdo;
    $saId = (int)req('sa_id');
    $stmt = $pdo->prepare("DELETE FROM admin_config WHERE id=? AND role='school_admin'");
    $stmt->execute([$saId]);
    if ($stmt->rowCount() === 0) jsonError('School Admin account not found.');
    jsonOk();
}


function doGetPersonnel() {
    global $pdo;
    $showInactive = (int)($_GET['archived'] ?? 0);
    $filterStatus = $showInactive ? 'inactive' : 'active';
    $stmt = $pdo->prepare("SELECT * FROM personnel WHERE account_status=? ORDER BY surname,given");
    $stmt->execute([$filterStatus]);
    $rows = $stmt->fetchAll();

    // conversion_log removed — conversion data lives in leave_records (is_conversion=1)
    $logMap = [];

    $out = [];
    foreach ($rows as $r) {
        $out[] = personnelRowToJs($r, $logMap[$r['employee_id']] ?? []);
    }
    jsonOk(['data' => $out]);
}

function personnelRowToJs(array $r, array $convLog = []): array {
    return [
        'id'             => $r['employee_id'],
        'email'          => $r['email'],
        'password'       => $r['password'],
        'surname'        => $r['surname'],
        'given'          => $r['given'],
        'suffix'         => $r['suffix'],
        'maternal'       => $r['maternal'],
        'sex'            => $r['sex'],
        'civil'          => $r['civil'],
        'dob'            => $r['dob'],
        'pob'            => $r['pob'],
        'addr'           => $r['addr'],
        'spouse'         => $r['spouse'],
        'edu'            => $r['edu'],
        'elig'           => $r['elig'],
        'rating'         => $r['rating'],
        'tin'            => $r['tin'],
        'pexam'          => $r['pexam'],
        'dexam'          => $r['dexam'],
        'appt'           => $r['appt'],
        'status'         => $r['status'],
        'account_status' => $r['account_status'] ?? 'active',
        'pos'            => $r['pos'],
        'school'         => $r['school'],
        'lastEditedAt'   => $r['last_edited_at'],
        'conversionLog'  => $convLog,
        'records'        => [],
    ];
}

function doSaveEmployee() {
    global $pdo;
    $p  = getPost();
    $id = trim($p['id'] ?? '');
    if (!$id) jsonError('Employee ID is required.');

    // ── Validate Employee ID: exactly 8 numeric digits ──
    if (!preg_match('/^\d{8}$/', $id)) jsonError('Invalid Employee ID — must be exactly 8 numbers.');

    // ── Validate email ──
    $email = strtolower(trim($p['email'] ?? ''));
    if (!$email) jsonError('Email address is required.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) jsonError('Invalid email address format.');
    if (!str_ends_with($email, '@deped.gov.ph')) jsonError('Email must use the @deped.gov.ph domain (e.g. juan@deped.gov.ph).');

    // ── Validate required personnel fields ──
    if (empty(trim($p['surname'] ?? '')))  jsonError('Surname is required.');
    if (empty(trim($p['given']   ?? '')))  jsonError('Given name is required.');
    if (empty(trim($p['sex']     ?? '')))  jsonError('Sex is required.');
    if (empty(trim($p['status']  ?? '')))  jsonError('Category (Teaching/Non-Teaching) is required.');
    if (empty(trim($p['dob']     ?? '')))  jsonError('Date of Birth is required.');
    if (empty(trim($p['addr']    ?? '')))  jsonError('Present Address is required.');
    if (empty(trim($p['pos']     ?? '')))  jsonError('Position / Designation is required.');
    if (empty(trim($p['school']  ?? '')))  jsonError('School / Office Assignment is required.');
    if (!str_ends_with($email, '@deped.gov.ph')) jsonError('Email must use the @deped.gov.ph domain (e.g. juan@deped.gov.ph).');

    // ── Duplicate Employee ID check (only for new employees) ──
    $existsStmt = $pdo->prepare('SELECT employee_id FROM personnel WHERE employee_id=?');
    $existsStmt->execute([$id]);
    $existing = $existsStmt->fetch();
    // If this is a NEW employee (no existing record), block if ID taken
    // If EDITING existing, the ID must match what's already there (we detect by checking)

    // ── Duplicate Email check ──
    $emailCheck = $pdo->prepare('SELECT employee_id FROM personnel WHERE LOWER(email)=? AND employee_id!=?');
    $emailCheck->execute([$email, $id]);
    if ($emailCheck->fetch()) {
        jsonError('Email "' . $email . '" is already registered to another employee.');
    }

    $data = [
        'employee_id'    => $id,
        'email'          => $email,
        'password'       => $p['password'] ?? '',
        'surname'        => $p['surname']  ?? '',
        'given'          => $p['given']    ?? '',
        'suffix'         => $p['suffix']   ?? '',
        'maternal'       => $p['maternal'] ?? '',
        'sex'            => $p['sex']      ?? '',
        'civil'          => $p['civil']    ?? '',
        'dob'            => normaliseDate($p['dob']   ?? ''),
        'pob'            => $p['pob']      ?? '',
        'addr'           => $p['addr']     ?? '',
        'spouse'         => $p['spouse']   ?? '',
        'edu'            => $p['edu']      ?? '',
        'elig'           => $p['elig']     ?? '',
        'rating'         => $p['rating']   ?? '',
        'tin'            => $p['tin']      ?? '',
        'pexam'          => $p['pexam']    ?? '',
        'dexam'          => normaliseDate($p['dexam'] ?? ''),
        'appt'           => normaliseDate($p['appt']  ?? ''),
        'status'         => $p['status']   ?? 'Teaching',
        'account_status' => in_array($p['account_status'] ?? '', ['active','inactive']) ? $p['account_status'] : 'active',
        'pos'            => $p['pos']      ?? '',
        'school'         => $p['school']   ?? '',
        'last_edited_at' => date('Y-m-d H:i:s'),
    ];

    if ($existing) {
        if (!$data['password']) {
            $cur = $pdo->prepare('SELECT password FROM personnel WHERE employee_id=?');
            $cur->execute([$id]);
            $data['password'] = $cur->fetchColumn();
        }
        $sets = implode(',', array_map(fn($k) => "$k=?", array_keys($data)));
        $vals = array_values($data);
        $pdo->prepare("UPDATE personnel SET $sets WHERE employee_id=?")->execute([...$vals, $id]);
    } else {
        $cols = implode(',', array_keys($data));
        $phs  = implode(',', array_fill(0, count($data), '?'));
        $pdo->prepare("INSERT INTO personnel ($cols) VALUES ($phs)")->execute(array_values($data));
    }

    if (isset($p['records']) && is_array($p['records'])) {
        syncRecords($id, $p['records']);
    }

    jsonOk(['employee_id' => $id]);
}

function doArchive() {
    global $pdo;
    $id     = req('employee_id');
    $reason = opt('reason', '');
    $pdo->prepare("UPDATE personnel SET account_status='inactive' WHERE employee_id=?")
        ->execute([$id]);
    jsonOk();
}

function doUnarchive() {
    global $pdo;
    $id = req('employee_id');
    $pdo->prepare("UPDATE personnel SET account_status='active' WHERE employee_id=?")
        ->execute([$id]);
    jsonOk();
}

// ═══════════════════════════════════════════════════════════════
//  LEAVE RECORD ACTIONS
// ═══════════════════════════════════════════════════════════════
function doGetRecords() {
    global $pdo;
    $empId = $_GET['employee_id'] ?? req('employee_id');
    $stmt  = $pdo->prepare(
        'SELECT * FROM leave_records WHERE employee_id=? ORDER BY sort_order ASC, record_id ASC'
    );
    $stmt->execute([$empId]);
    $rows    = $stmt->fetchAll();
    $records = array_map('rowToRecord', $rows);
    jsonOk(['records' => $records]);
}

function doSaveRecord() {
    global $pdo;
    $empId = req('employee_id');
    $r     = req('record');

    $maxSort = $pdo->prepare('SELECT COALESCE(MAX(sort_order),0) FROM leave_records WHERE employee_id=?');
    $maxSort->execute([$empId]);
    $sortOrder = (int)$maxSort->fetchColumn() + 1;

    $row  = recordToRow($r, $empId, $sortOrder);
    $cols = implode(',', array_keys($row));
    $phs  = implode(',', array_fill(0, count($row), '?'));
    $stmt = $pdo->prepare("INSERT INTO leave_records ($cols) VALUES ($phs)");
    $stmt->execute(array_values($row));
    $newId = $pdo->lastInsertId();

    $pdo->prepare('UPDATE personnel SET last_edited_at=? WHERE employee_id=?')
        ->execute([date('Y-m-d H:i:s'), $empId]);

    jsonOk(['record_id' => (int)$newId]);
}

function doUpdateRecord() {
    global $pdo;
    $empId    = req('employee_id');
    $recordId = (int)req('record_id');
    $r        = req('record');

    $sortStmt = $pdo->prepare('SELECT sort_order FROM leave_records WHERE record_id=?');
    $sortStmt->execute([$recordId]);
    $sortOrder = (int)($sortStmt->fetchColumn() ?: 0);

    $row = recordToRow($r, $empId, $sortOrder);
    unset($row['employee_id']);

    $sets   = implode(',', array_map(fn($k) => "$k=?", array_keys($row)));
    $vals   = array_values($row);
    $vals[] = $recordId;
    $pdo->prepare("UPDATE leave_records SET $sets WHERE record_id=?")->execute($vals);

    $pdo->prepare('UPDATE personnel SET last_edited_at=? WHERE employee_id=?')
        ->execute([date('Y-m-d H:i:s'), $empId]);

    jsonOk();
}

function doDeleteRecord() {
    global $pdo;
    $recordId = (int)req('record_id');
    $empId    = req('employee_id');

    $stmt = $pdo->prepare('SELECT is_conversion FROM leave_records WHERE record_id=? AND employee_id=?');
    $stmt->execute([$recordId, $empId]);
    $row = $stmt->fetch();
    if (!$row) jsonError('Record not found.');
    if ($row['is_conversion']) jsonError('Cannot delete conversion markers directly.');

    $pdo->prepare('DELETE FROM leave_records WHERE record_id=?')->execute([$recordId]);
    $pdo->prepare('UPDATE personnel SET last_edited_at=? WHERE employee_id=?')
        ->execute([date('Y-m-d H:i:s'), $empId]);
    jsonOk();
}

function doDeleteEra() {
    global $pdo;
    $recordId = (int)req('record_id');
    $empId    = req('employee_id');

    $stmt = $pdo->prepare('SELECT is_conversion FROM leave_records WHERE record_id=? AND employee_id=?');
    $stmt->execute([$recordId, $empId]);
    $row = $stmt->fetch();
    if (!$row) jsonError('Record not found.');
    if (!$row['is_conversion']) jsonError('Not a conversion marker.');

    $pdo->prepare('DELETE FROM leave_records WHERE record_id=?')->execute([$recordId]);
    jsonOk();
}

function doReorderRecords() {
    global $pdo;
    $empId   = req('employee_id');
    $ordered = req('record_ids');

    $stmt = $pdo->prepare('UPDATE leave_records SET sort_order=? WHERE record_id=? AND employee_id=?');
    foreach ($ordered as $i => $rid) {
        $stmt->execute([$i, (int)$rid, $empId]);
    }
    jsonOk();
}

// ─── Full records sync (used on conversion / bulk import) ──────
function syncRecords(string $empId, array $records) {
    global $pdo;
    $pdo->prepare('DELETE FROM leave_records WHERE employee_id=?')->execute([$empId]);
    foreach ($records as $i => $r) {
        $row  = recordToRow($r, $empId, $i);
        $cols = implode(',', array_keys($row));
        $phs  = implode(',', array_fill(0, count($row), '?'));
        $pdo->prepare("INSERT INTO leave_records ($cols) VALUES ($phs)")->execute(array_values($row));
    }
}

// ═══════════════════════════════════════════════════════════════
//  SAVE ROW BALANCE — update 8 computed columns for a single row
// ═══════════════════════════════════════════════════════════════
function doSaveRowBalance() {
    global $pdo;

    $record_id   = req('record_id');
    $employee_id = req('employee_id');

    $setA_earned  = (float)req('setA_earned');
    $setA_abs_wp  = (float)req('setA_abs_wp');
    $setA_balance = (float)req('setA_balance');
    $setA_wop     = (float)req('setA_wop');
    $setB_earned  = (float)req('setB_earned');
    $setB_abs_wp  = (float)req('setB_abs_wp');
    $setB_balance = (float)req('setB_balance');
    $setB_wop     = (float)req('setB_wop');

    // FIX: if setA_earned is 0 that means no earned value was entered —
    // write 0 but do NOT let a stale non-zero value remain. The JS now
    // sends the correct per-row earned (not a cumulative total), so we
    // trust it exactly as received.

    // Update only the 8 setA/setB balance columns that exist in the DB schema.
    $stmt = $pdo->prepare("
        UPDATE leave_records SET
            setA_earned=?,
            setA_abs_wp=?,
            setA_balance=?,
            setA_wop=?,
            setB_earned=?,
            setB_abs_wp=?,
            setB_balance=?,
            setB_wop=?
        WHERE record_id=?
    ");

    $stmt->execute([
        $setA_earned,
        $setA_abs_wp,
        $setA_balance,
        $setA_wop,
        $setB_earned,
        $setB_abs_wp,
        $setB_balance,
        $setB_wop,
        $record_id
    ]);

    jsonOk();
}