<?php
/**
 * Vitalise outbound mail relay — deploy on the DreamHost account (NOT Render, which blocks
 * SMTP egress). The Node app POSTs the composed message here over HTTPS; this script submits
 * it through DreamHost's SMTP relay (smtp.dreamhost.com:587, STARTTLS + SMTP AUTH).
 *
 * Deploy:
 *   1. Upload this file to a directory under your DreamHost web root, e.g.
 *        https://bulk.vitalise.io/relay/send.php
 *      (a dedicated bulk subdomain keeps campaign volume off the root domain).
 *   2. Set the two secrets below (or via environment) — RELAY_KEY must match the app's
 *      MAIL_RELAY_SECRET, and SMTP_* are the DreamHost mailbox credentials.
 *   3. Point the app at it: MAIL_RELAY_URL=https://bulk.vitalise.io/relay/send.php
 *
 * Sending is authenticated SMTP only (PHPMailer). PHP's mail() is deliberately NOT used:
 * DreamHost applies DKIM only to SMTP-authenticated messages, and an unsigned message fails
 * DMARC because SPF does not domain-align through the MailChannels relay. If PHPMailer or the
 * SMTP credentials are missing, the relay returns 503 rather than sending unsigned mail.
 */

declare(strict_types=1);

$CONFIG = [
    'relay_key' => getenv('RELAY_KEY') ?: '',                 // must equal the app's MAIL_RELAY_SECRET
    'smtp_host' => getenv('SMTP_HOST') ?: 'smtp.dreamhost.com',
    'smtp_port' => (int)(getenv('SMTP_PORT') ?: 587),
    'smtp_user' => getenv('SMTP_USER') ?: '',                 // full mailbox address, e.g. you@vitalise.io
    'smtp_pass' => getenv('SMTP_PASS') ?: '',                 // the mailbox password
    'phpmailer' => __DIR__ . '/PHPMailer/src/PHPMailer.php',  // adjust to your PHPMailer location
];

// DreamHost shared PHP does NOT inherit shell environment variables, so the secrets above would
// be empty. Instead, read them from a protected config.php sitting next to this file. config.php
// returns an array of the same keys; those values override the getenv() defaults. Keep config.php
// OUT of version control — it stores your mailbox password. Accessing it over HTTP is safe: PHP
// executes it and it outputs nothing.
$configFile = __DIR__ . '/config.php';
if (is_file($configFile)) {
    $loaded = require $configFile;
    if (is_array($loaded)) {
        foreach (['relay_key', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass'] as $key) {
            if (array_key_exists($key, $loaded)) $CONFIG[$key] = $loaded[$key];
        }
    }
    $CONFIG['smtp_port'] = (int) $CONFIG['smtp_port'];
}

header('Content-Type: application/json; charset=utf-8');

function fail(int $code, string $message): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

// Only accept POSTs from the app that know the shared secret.
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'Method not allowed.');
if ($CONFIG['relay_key'] === '' || !hash_equals($CONFIG['relay_key'], (string)($_SERVER['HTTP_X_RELAY_KEY'] ?? ''))) {
    fail(401, 'Invalid relay key.');
}

$raw = file_get_contents('php://input');
$body = json_decode((string)$raw, true);
if (!is_array($body)) fail(400, 'Expected a JSON body.');

$from  = filter_var((string)($body['from'] ?? ''), FILTER_VALIDATE_EMAIL);
$to    = array_values(array_filter((array)($body['to'] ?? []), 'filter_var_int'));
$cc    = array_values(array_filter((array)($body['cc'] ?? []), 'filter_var_int'));
if (!$from) fail(400, 'A valid From address is required.');
if (!$to)   fail(400, 'At least one recipient is required.');

$subject = (string)($body['subject'] ?? '(no subject)');
$html    = (string)($body['html'] ?? '');
$text    = (string)($body['text'] ?? strip_tags($html));
$fromName= (string)($body['fromName'] ?? '');

function filter_var_int($email): bool { return (bool)filter_var($email, FILTER_VALIDATE_EMAIL); }

// Prefer per-request SMTP credentials supplied by the authenticated app (it already holds the
// mailbox login), so the relay does not need to store the password. Falls back to config.php /
// env only when the body omits them.
if (isset($body['smtp_user']) && $body['smtp_user'] !== '') $CONFIG['smtp_user'] = (string) $body['smtp_user'];
if (isset($body['smtp_pass']) && $body['smtp_pass'] !== '') $CONFIG['smtp_pass'] = (string) $body['smtp_pass'];

// Send ONLY via authenticated SMTP (PHPMailer). There is intentionally no mail() fallback:
// DreamHost signs SMTP-authenticated mail with DKIM, and an unsigned message would fail DMARC
// (SPF does not domain-align through the MailChannels relay). Misconfiguration fails loudly.
if (!is_file($CONFIG['phpmailer'])) {
    fail(503, 'PHPMailer is not installed at the configured path; refusing to send unsigned mail.');
}
if ($CONFIG['smtp_user'] === '' || $CONFIG['smtp_pass'] === '') {
    fail(503, 'SMTP credentials are not configured (set SMTP_USER and SMTP_PASS).');
}

require_once $CONFIG['phpmailer'];
require_once dirname($CONFIG['phpmailer']) . '/SMTP.php';
require_once dirname($CONFIG['phpmailer']) . '/Exception.php';
$mail = new \PHPMailer\PHPMailer\PHPMailer(true);
try {
    $mail->isSMTP();
    $mail->Host       = $CONFIG['smtp_host'];
    $mail->Port       = $CONFIG['smtp_port'];
    $mail->SMTPAuth   = true;
    $mail->Username   = $CONFIG['smtp_user'];
    $mail->Password   = $CONFIG['smtp_pass'];
    $mail->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    $mail->setFrom($from, $fromName);
    foreach ($to as $addr) $mail->addAddress($addr);
    foreach ($cc as $addr) $mail->addCC($addr);
    $mail->CharSet = 'UTF-8';
    $mail->Subject = $subject;
    $mail->isHTML(true);
    $mail->Body    = $html;
    $mail->AltBody = $text;
    $mail->send();
    echo json_encode(['ok' => true]);
} catch (\Throwable $e) {
    fail(502, 'SMTP send failed: ' . $e->getMessage());
}
