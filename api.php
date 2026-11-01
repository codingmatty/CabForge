<?php

declare(strict_types=1);

/*
 * CabForge JSON API.
 *
 *   GET    api.php?action=health
 *   GET    api.php?action=shop              -> { shop: object|null }
 *   PUT    api.php?action=shop              <- shop settings
 *   GET    api.php?action=prefs             -> { prefs: object|null }
 *   PUT    api.php?action=prefs             <- shop preferences (display units)
 *   GET    api.php?action=projects          -> { projects: [{ id, name, updated }] }
 *   GET    api.php?action=project&id=ID     -> { project }
 *   PUT    api.php?action=project&id=ID     <- project
 *   DELETE api.php?action=project&id=ID
 *
 * Writes need a JSON body and the X-CabForge: 1 header. Browsers won't send
 * a custom header cross-site without a CORS preflight, which this API never
 * grants, so other sites can't write here.
 */

require __DIR__ . '/lib/Storage.php';

use CabForge\Storage;

const MAX_BODY_BYTES = 2_000_000;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, mixed $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function fail(int $status, string $message): never
{
    respond($status, ['error' => $message]);
}

function requireAppHeader(): void
{
    if (($_SERVER['HTTP_X_CABFORGE'] ?? '') !== '1') {
        fail(403, 'Missing X-CabForge header');
    }
}

function readJsonBody(): object
{
    requireAppHeader();
    if (!str_starts_with((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
        fail(415, 'Expected application/json');
    }
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($raw === false || strlen($raw) > MAX_BODY_BYTES) {
        fail(413, 'Request body too large');
    }
    try {
        // Decode to objects (not arrays) so {} and [] survive the round trip.
        $data = json_decode($raw, false, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        fail(400, 'Invalid JSON');
    }
    if (!is_object($data)) {
        fail(400, 'Expected a JSON object');
    }
    return $data;
}

$storage = new Storage(__DIR__ . '/data');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string) ($_GET['action'] ?? '');

try {
    switch ($action) {
        case 'health':
            respond(200, ['ok' => true, 'php' => PHP_VERSION, 'writable' => $storage->writable()]);

        case 'shop':
            if ($method === 'GET') {
                respond(200, ['shop' => $storage->readShop()]);
            }
            if ($method === 'PUT') {
                $storage->writeShop(readJsonBody());
                respond(200, ['ok' => true]);
            }
            break;

        case 'prefs':
            if ($method === 'GET') {
                respond(200, ['prefs' => $storage->readPrefs()]);
            }
            if ($method === 'PUT') {
                $storage->writePrefs(readJsonBody());
                respond(200, ['ok' => true]);
            }
            break;

        case 'projects':
            if ($method === 'GET') {
                respond(200, ['projects' => $storage->listProjects()]);
            }
            break;

        case 'project':
            $id = (string) ($_GET['id'] ?? '');
            if (!Storage::validId($id)) {
                fail(400, 'Invalid project id');
            }
            if ($method === 'GET') {
                $project = $storage->readProject($id);
                $project === null ? fail(404, 'Project not found') : respond(200, ['project' => $project]);
            }
            if ($method === 'PUT') {
                $storage->writeProject($id, readJsonBody());
                respond(200, ['ok' => true]);
            }
            if ($method === 'DELETE') {
                requireAppHeader();
                $storage->deleteProject($id) ? respond(200, ['ok' => true]) : fail(404, 'Project not found');
            }
            break;

        default:
            fail(404, 'Unknown action');
    }
    fail(405, 'Method not allowed');
} catch (Throwable $e) {
    error_log('CabForge API: ' . $e->getMessage());
    fail(500, 'Server error');
}
