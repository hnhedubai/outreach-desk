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
 * Sending uses PHPMailer when available (recommended — authenticated, DKIM-friendly). If
 * PHPMailer is not present it falls back to PHP's mail(), which DreamHost routes over its
 * own SMTP transport for the hosting domain.
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

// Prefer authenticated SMTP via PHPMailer.
if (is_file($CONFIG['phpmailer'])) {
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
    exit;
}

// Fallback: PHP mail() — DreamHost routes this over its own SMTP for the hosting domain.
$headers  = 'From: ' . ($fromName !== '' ? sprintf('%s <%s>', $fromName, $from) : $from) . "\r\n";
if ($cc) $headers .= 'Cc: ' . implode(', ', $cc) . "\r\n";
$headers .= 'MIME-Version: 1.0' . "\r\n";
$boundary = 'vitalise-' . bin2hex(random_bytes(8));
$headers .= "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n";
$message  = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n$text\r\n";
$message .= "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n$html\r\n";
$message .= "--$boundary--";
foreach ($to as $addr) {
    if (!mail($addr, $subject, $message, $headers)) fail(502, 'mail() failed for ' . $addr);
}
echo json_encode(['ok' => true]);
