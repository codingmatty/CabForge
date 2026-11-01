<?php

declare(strict_types=1);

namespace CabForge;

/**
 * Optional AI chat: a thin proxy between the browser and Anthropic or OpenAI.
 *
 * The browser runs the tools (they edit the job with the same engine code
 * the forms use); this class only adds the API key, calls the provider and
 * streams its reply back as a small set of server-sent events:
 *
 *   text  {"text": "..."}                       streamed reply text
 *   tool  {"id", "name", "input"}               a complete tool call
 *   done  {"stop", "append": [user, assistant]} the turn, in the provider's own
 *                                                message format, for the browser to keep
 *                                                and send back unchanged next time
 *   error {"message"}
 *
 * The conversation history is kept in the provider's format and only ever
 * appended to, so thinking blocks and prompt caching stay valid.
 *
 * Configuration (environment, or a git-ignored .env in the app or data/ folder):
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY   turns the chat on
 *   CABFORGE_AI_PROVIDER                 anthropic | openai (default: whichever key is set, Anthropic first)
 *   CABFORGE_AI_MODEL                    model id (default claude-opus-5-5; required for OpenAI)
 *   CABFORGE_AI_DAILY_LIMIT              model calls per day (default 200; 0 = no limit)
 *   CABFORGE_AI_BASE_URL                 API base URL override (proxies, tests)
 */
final class Ai
{
    public const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
    private const ANTHROPIC_VERSION = '2026-10-21';
    private const MAX_TOKENS = 16000;

    /** @var array<string, string> */
    private static array $dotenv = [];
    private static bool $dotenvLoaded = false;

    public function __construct(private readonly string $appDir, private readonly string $dataDir)
    {
    }

    // ---- configuration --------------------------------------------------------

    public function env(string $name): string
    {
        $v = getenv($name);
        if (is_string($v) && $v !== '') {
            return $v;
        }
        foreach ([$_SERVER, $_ENV] as $src) {
            if (isset($src[$name]) && is_string($src[$name]) && $src[$name] !== '') {
                return $src[$name];
            }
        }
        if (!self::$dotenvLoaded) {
            self::$dotenvLoaded = true;
            foreach ([$this->appDir . '/.env', $this->dataDir . '/.env'] as $file) {
                self::$dotenv += self::parseDotenv($file);
            }
        }
        return self::$dotenv[$name] ?? '';
    }

    /** @return array<string, string> KEY=value lines; # comments; optional quotes and "export ". */
    public static function parseDotenv(string $file): array
    {
        $out = [];
        if (!is_readable($file)) {
            return $out;
        }
        foreach (file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            if (!preg_match('/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/', $line, $m)) {
                continue;
            }
            $value = trim($m[2]);
            if ($value !== '' && ($value[0] === '"' || $value[0] === "'") && ($end = strpos($value, $value[0], 1)) !== false) {
                // "quoted value"  # an optional comment after it
                $value = substr($value, 1, $end - 1);
            } else {
                $value = trim(preg_replace('/\s+#.*$/', '', $value) ?? $value);
            }
            $out[$m[1]] = $value;
        }
        return $out;
    }

    /** @return array{enabled: bool, provider: ?string, model: ?string, reason?: string} */
    public function config(): array
    {
        $provider = strtolower($this->env('CABFORGE_AI_PROVIDER'));
        if ($provider === '') {
            $provider = $this->env('ANTHROPIC_API_KEY') !== '' ? 'anthropic' : ($this->env('OPENAI_API_KEY') !== '' ? 'openai' : '');
        }
        if ($provider === '') {
            return ['enabled' => false, 'provider' => null, 'model' => null, 'reason' => 'No ANTHROPIC_API_KEY or OPENAI_API_KEY set'];
        }
        if (!in_array($provider, ['anthropic', 'openai'], true)) {
            return ['enabled' => false, 'provider' => null, 'model' => null, 'reason' => "Unknown CABFORGE_AI_PROVIDER '$provider'"];
        }
        if ($this->key($provider) === '') {
            return ['enabled' => false, 'provider' => $provider, 'model' => null, 'reason' => strtoupper($provider) . '_API_KEY is not set'];
        }
        $model = $this->env('CABFORGE_AI_MODEL');
        if ($model === '') {
            if ($provider === 'openai') {
                return ['enabled' => false, 'provider' => $provider, 'model' => null, 'reason' => 'Set CABFORGE_AI_MODEL to an OpenAI model id'];
            }
            $model = self::DEFAULT_ANTHROPIC_MODEL;
        }
        return ['enabled' => true, 'provider' => $provider, 'model' => $model];
    }

    private function key(string $provider): string
    {
        return $this->env($provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');
    }

    private function baseUrl(string $provider): string
    {
        $base = $this->env('CABFORGE_AI_BASE_URL');
        if ($base === '') {
            $base = $provider === 'openai' ? 'https://api.openai.com' : 'https://api.anthropic.com';
        }
        return rtrim($base, '/');
    }

    public function dailyLimit(): int
    {
        $v = $this->env('CABFORGE_AI_DAILY_LIMIT');
        return $v === '' ? 200 : max(0, (int) $v);
    }

    /** @return array{day: string, count: int} today's model calls */
    public function usage(): array
    {
        $path = $this->dataDir . '/ai-usage.json';
        $data = is_readable($path) ? json_decode((string) file_get_contents($path), true) : null;
        $today = gmdate('Y-m-d');
        $count = is_array($data) && ($data['day'] ?? '') === $today ? (int) ($data['count'] ?? 0) : 0;
        return ['day' => $today, 'count' => $count];
    }

    /** Counts one model call against today's limit; false when the limit is reached. */
    public function takeCall(): bool
    {
        $limit = $this->dailyLimit();
        if (!is_dir($this->dataDir)) {
            @mkdir($this->dataDir, 0775, true);
        }
        $fh = fopen($this->dataDir . '/ai-usage.json', 'c+');
        if ($fh === false) {
            return $limit === 0;
        }
        try {
            flock($fh, LOCK_EX);
            $data = json_decode((string) stream_get_contents($fh), true);
            $today = gmdate('Y-m-d');
            $count = is_array($data) && ($data['day'] ?? '') === $today ? (int) ($data['count'] ?? 0) : 0;
            if ($limit > 0 && $count >= $limit) {
                return false;
            }
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, json_encode(['day' => $today, 'count' => $count + 1]));
            fflush($fh);
            return true;
        } finally {
            flock($fh, LOCK_UN);
            fclose($fh);
        }
    }

    // ---- the chat turn -----------------------------------------------------------

    /**
     * Runs one model call and streams the events to $emit(string $event, array $data).
     *
     * $req (decoded as objects, so {} stays {} when the history is sent on):
     *   {system: string, tools: [{name, description, schema}], history: [native messages],
     *    input: {text?: string, images?: [{mediaType, data}], toolResults?: [{id, content, isError?}]}}
     */
    public function turn(object $req, callable $emit): void
    {
        $cfg = $this->config();
        if (!$cfg['enabled']) {
            $emit('error', ['message' => 'The AI chat is off: ' . ($cfg['reason'] ?? 'not configured')]);
            return;
        }
        $history = is_array($req->history ?? null) ? array_values($req->history) : [];
        // The input holds only strings and lists: plain arrays are safe there.
        $input = json_decode(json_encode($req->input ?? new \stdClass()), true) ?: [];
        $tools = [];
        foreach (is_array($req->tools ?? null) ? $req->tools : [] as $t) {
            if (is_object($t) && is_string($t->name ?? null)) {
                $tools[] = ['name' => $t->name, 'description' => (string) ($t->description ?? ''), 'schema' => is_object($t->schema ?? null) ? $t->schema : (object) ['type' => 'object']];
            }
        }
        $system = is_string($req->system ?? null) ? $req->system : '';

        $openai = $cfg['provider'] === 'openai';
        $userMessages = $openai ? self::openaiInput($input) : [self::anthropicInput($input)];
        if (!$userMessages) {
            $emit('error', ['message' => 'Nothing to send']);
            return;
        }
        if (!$this->takeCall()) {
            $emit('error', ['message' => 'The daily AI request limit (' . $this->dailyLimit() . ') is reached. It resets at midnight UTC; CABFORGE_AI_DAILY_LIMIT changes it.']);
            return;
        }
        $messages = array_merge($history, $userMessages);
        if ($openai) {
            $this->openaiTurn($cfg['model'], $system, $tools, $messages, $userMessages, $emit);
        } else {
            $this->anthropicTurn($cfg['model'], $system, $tools, $messages, $userMessages[0], $emit);
        }
    }

    // ---- Anthropic Messages API --------------------------------------------------

    /** The browser's input as an Anthropic user message. */
    public static function anthropicInput(array $input): ?array
    {
        $content = [];
        foreach ((array) ($input['toolResults'] ?? []) as $r) {
            $content[] = [
                'type' => 'tool_result',
                'tool_use_id' => (string) ($r['id'] ?? ''),
                'content' => (string) ($r['content'] ?? ''),
                'is_error' => (bool) ($r['isError'] ?? false),
            ];
        }
        foreach ((array) ($input['images'] ?? []) as $img) {
            $content[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => (string) ($img['mediaType'] ?? 'image/jpeg'), 'data' => (string) ($img['data'] ?? '')]];
        }
        $text = trim((string) ($input['text'] ?? ''));
        if ($text !== '') {
            $content[] = ['type' => 'text', 'text' => $text];
        }
        return $content ? ['role' => 'user', 'content' => $content] : null;
    }

    private function anthropicTurn(string $model, string $system, array $tools, array $messages, array $userMessage, callable $emit): void
    {
        $body = [
            'model' => $model,
            'max_tokens' => self::MAX_TOKENS,
            'stream' => true,
            // Resent history is the same every turn: cache it.
            'cache_control' => ['type' => 'ephemeral'],
            'messages' => $messages,
        ];
        if ($system !== '') {
            $body['system'] = $system;
        }
        if ($tools) {
            $body['tools'] = array_map(static fn (array $t): array => [
                'name' => (string) $t['name'],
                'description' => (string) ($t['description'] ?? ''),
                'input_schema' => $t['schema'],
            ], $tools);
        }
        $headers = [
            'content-type: application/json',
            'x-api-key: ' . $this->key('anthropic'),
            'anthropic-version: ' . self::ANTHROPIC_VERSION,
        ];
        // A request a safety classifier declines is retried server-side on
        // the model Anthropic recommends for it (Opus/Sonnet 5.5 and later).
        if (preg_match('/^claude-(opus|sonnet|fable)-5/', $model)) {
            $body['fallbacks'] = 'default';
            $headers[] = 'anthropic-beta: server-side-fallback-2026-07-01';
        }

        $blocks = [];      // content blocks by index, as the API builds them
        $json = [];        // tool input JSON being streamed, by index
        $stop = null;
        $usage = [];
        $error = null;
        $onEvent = function (string $event, array $d) use (&$blocks, &$json, &$stop, &$usage, &$error, $emit): void {
            switch ($d['type'] ?? $event) {
                case 'message_start':
                    $usage = $d['message']['usage'] ?? [];
                    break;
                case 'content_block_start':
                    $i = (int) $d['index'];
                    $blocks[$i] = $d['content_block'];
                    if (($blocks[$i]['type'] ?? '') === 'tool_use') {
                        $json[$i] = '';
                    }
                    break;
                case 'content_block_delta':
                    $i = (int) $d['index'];
                    $delta = $d['delta'] ?? [];
                    switch ($delta['type'] ?? '') {
                        case 'text_delta':
                            $blocks[$i]['text'] = ($blocks[$i]['text'] ?? '') . $delta['text'];
                            $emit('text', ['text' => $delta['text']]);
                            break;
                        case 'input_json_delta':
                            $json[$i] = ($json[$i] ?? '') . $delta['partial_json'];
                            break;
                        case 'thinking_delta':
                            $blocks[$i]['thinking'] = ($blocks[$i]['thinking'] ?? '') . $delta['thinking'];
                            break;
                        case 'signature_delta':
                            $blocks[$i]['signature'] = ($blocks[$i]['signature'] ?? '') . $delta['signature'];
                            break;
                        case 'citations_delta':
                            $blocks[$i]['citations'][] = $delta['citation'];
                            break;
                    }
                    break;
                case 'content_block_stop':
                    $i = (int) $d['index'];
                    if (($blocks[$i]['type'] ?? '') === 'tool_use') {
                        $input = trim($json[$i] ?? '') === '' ? [] : json_decode($json[$i], true);
                        $blocks[$i]['input'] = is_array($input) ? (object) $input : new \stdClass();
                        $emit('tool', ['id' => $blocks[$i]['id'], 'name' => $blocks[$i]['name'], 'input' => $blocks[$i]['input'], 'invalid' => !is_array($input)]);
                    }
                    break;
                case 'message_delta':
                    $stop = $d['delta']['stop_reason'] ?? $stop;
                    $usage = array_merge($usage, $d['usage'] ?? []);
                    break;
                case 'error':
                    $error = $d['error']['message'] ?? 'The model returned an error';
                    break;
            }
        };
        $status = $this->stream($this->baseUrl('anthropic') . '/v1/messages', $headers, $body, $onEvent, $errorBody);
        if ($status !== 200) {
            $emit('error', ['message' => self::apiError($status, $errorBody)]);
            return;
        }
        if ($error !== null) {
            $emit('error', ['message' => $error]);
            return;
        }
        ksort($blocks);
        $content = self::echoableBlocks(array_values($blocks));
        $emit('done', [
            'stop' => self::anthropicStop($stop),
            'append' => [$userMessage, ['role' => 'assistant', 'content' => $content ?: [['type' => 'text', 'text' => '…']]]],
            'usage' => $usage,
        ]);
    }

    /**
     * Blocks to send back next turn. After a server-side fallback in the middle
     * of a reply, thinking and tool-use blocks before the last fallback marker
     * are dropped (the fallback model never saw them).
     */
    public static function echoableBlocks(array $blocks): array
    {
        $last = -1;
        foreach ($blocks as $i => $b) {
            if (($b['type'] ?? '') === 'fallback') {
                $last = $i;
            }
        }
        $out = [];
        foreach ($blocks as $i => $b) {
            if ($i < $last && in_array($b['type'] ?? '', ['thinking', 'redacted_thinking', 'tool_use'], true)) {
                continue;
            }
            // An empty text block is rejected when sent back.
            if (($b['type'] ?? '') === 'text' && ($b['text'] ?? '') === '') {
                continue;
            }
            $out[] = $b;
        }
        return $out;
    }

    private static function anthropicStop(?string $stop): string
    {
        return match ($stop) {
            'tool_use' => 'tool_use',
            'max_tokens' => 'max_tokens',
            'refusal' => 'refusal',
            default => 'end',
        };
    }

    // ---- OpenAI Chat Completions ----------------------------------------------------

    /** @return list<array> the browser's input as OpenAI messages (tool results, then the user message) */
    public static function openaiInput(array $input): array
    {
        $out = [];
        foreach ((array) ($input['toolResults'] ?? []) as $r) {
            $content = (string) ($r['content'] ?? '');
            $out[] = ['role' => 'tool', 'tool_call_id' => (string) ($r['id'] ?? ''), 'content' => !empty($r['isError']) ? "Error: $content" : $content];
        }
        $parts = [];
        $text = trim((string) ($input['text'] ?? ''));
        if ($text !== '') {
            $parts[] = ['type' => 'text', 'text' => $text];
        }
        foreach ((array) ($input['images'] ?? []) as $img) {
            $parts[] = ['type' => 'image_url', 'image_url' => ['url' => 'data:' . ($img['mediaType'] ?? 'image/jpeg') . ';base64,' . ($img['data'] ?? '')]];
        }
        if ($parts) {
            $out[] = ['role' => 'user', 'content' => $parts];
        }
        return $out;
    }

    private function openaiTurn(string $model, string $system, array $tools, array $messages, array $userMessages, callable $emit): void
    {
        $body = [
            'model' => $model,
            'stream' => true,
            'stream_options' => ['include_usage' => true],
            'max_completion_tokens' => self::MAX_TOKENS,
            'messages' => array_merge($system !== '' ? [['role' => 'system', 'content' => $system]] : [], $messages),
        ];
        if ($tools) {
            $body['tools'] = array_map(static fn (array $t): array => [
                'type' => 'function',
                'function' => ['name' => (string) $t['name'], 'description' => (string) ($t['description'] ?? ''), 'parameters' => $t['schema']],
            ], $tools);
        }
        $headers = ['content-type: application/json', 'authorization: Bearer ' . $this->key('openai')];

        $text = '';
        $calls = [];
        $finish = null;
        $usage = [];
        $onEvent = function (string $event, array $d) use (&$text, &$calls, &$finish, &$usage, $emit): void {
            if (isset($d['usage']) && is_array($d['usage'])) {
                $usage = $d['usage'];
            }
            foreach ($d['choices'] ?? [] as $choice) {
                $delta = $choice['delta'] ?? [];
                if (isset($delta['content']) && is_string($delta['content']) && $delta['content'] !== '') {
                    $text .= $delta['content'];
                    $emit('text', ['text' => $delta['content']]);
                }
                foreach ($delta['tool_calls'] ?? [] as $tc) {
                    $i = (int) ($tc['index'] ?? 0);
                    $calls[$i] ??= ['id' => '', 'name' => '', 'arguments' => ''];
                    $calls[$i]['id'] .= $tc['id'] ?? '';
                    $calls[$i]['name'] .= $tc['function']['name'] ?? '';
                    $calls[$i]['arguments'] .= $tc['function']['arguments'] ?? '';
                }
                $finish = $choice['finish_reason'] ?? $finish;
            }
        };
        $status = $this->stream($this->baseUrl('openai') . '/v1/chat/completions', $headers, $body, $onEvent, $errorBody);
        if ($status !== 200) {
            $emit('error', ['message' => self::apiError($status, $errorBody)]);
            return;
        }
        ksort($calls);
        $toolCalls = [];
        foreach ($calls as $c) {
            $input = trim($c['arguments']) === '' ? [] : json_decode($c['arguments'], true);
            $emit('tool', ['id' => $c['id'], 'name' => $c['name'], 'input' => is_array($input) ? (object) $input : new \stdClass(), 'invalid' => !is_array($input)]);
            $toolCalls[] = ['id' => $c['id'], 'type' => 'function', 'function' => ['name' => $c['name'], 'arguments' => $c['arguments'] === '' ? '{}' : $c['arguments']]];
        }
        $assistant = ['role' => 'assistant', 'content' => $text === '' ? null : $text];
        if ($toolCalls) {
            $assistant['tool_calls'] = $toolCalls;
        }
        $emit('done', [
            'stop' => $toolCalls ? 'tool_use' : ($finish === 'length' ? 'max_tokens' : ($finish === 'content_filter' ? 'refusal' : 'end')),
            'append' => array_merge($userMessages, [$assistant]),
            'usage' => $usage,
        ]);
    }

    // ---- HTTP ------------------------------------------------------------------------

    /**
     * POSTs $body and feeds each server-sent event to $onEvent(event, data).
     * Returns the HTTP status; a non-200 response body lands in $errorBody.
     */
    private function stream(string $url, array $headers, array $body, callable $onEvent, ?string &$errorBody): int
    {
        $buffer = '';
        $errorBody = '';
        $status = 0;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION),
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 600,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$status): int {
                if (preg_match('#^HTTP/\S+\s+(\d+)#', $line, $m)) {
                    $status = (int) $m[1];
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$buffer, &$status, &$errorBody, $onEvent): int {
                if ($status !== 200) {
                    $errorBody .= $chunk;
                    return strlen($chunk);
                }
                $buffer .= str_replace("\r\n", "\n", $chunk);
                while (($end = strpos($buffer, "\n\n")) !== false) {
                    $raw = substr($buffer, 0, $end);
                    $buffer = substr($buffer, $end + 2);
                    $event = 'message';
                    $data = '';
                    foreach (explode("\n", $raw) as $line) {
                        if (str_starts_with($line, 'event:')) {
                            $event = trim(substr($line, 6));
                        } elseif (str_starts_with($line, 'data:')) {
                            $data .= ltrim(substr($line, 5));
                        }
                    }
                    if ($data === '' || $data === '[DONE]') {
                        continue;
                    }
                    $decoded = json_decode($data, true);
                    if (is_array($decoded)) {
                        $onEvent($event, $decoded);
                    }
                }
                return strlen($chunk);
            },
        ]);
        $ok = curl_exec($ch);
        if ($ok === false && $status === 0) {
            $errorBody = curl_error($ch);
        }
        unset($ch);
        return $status;
    }

    private static function apiError(int $status, ?string $body): string
    {
        $data = json_decode((string) $body, true);
        $message = is_array($data) ? ($data['error']['message'] ?? null) : null;
        if ($status === 0) {
            return 'Could not reach the AI provider' . ($body ? ": $body" : '');
        }
        return "The AI provider returned HTTP $status" . ($message ? ": $message" : '');
    }
}
