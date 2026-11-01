<?php

// Tests for the chat proxy's pure parts: php tests/ai.test.php

declare(strict_types=1);

require __DIR__ . '/../lib/Ai.php';

use CabForge\Ai;

$failed = 0;
$count = 0;
function check(string $name, bool $ok): void
{
    global $failed, $count;
    $count++;
    if (!$ok) {
        $failed++;
        echo "✗ $name\n";
    }
}

$env = tempnam(sys_get_temp_dir(), 'env');
file_put_contents($env, "A=1\nexport B=\"two words\" # note\nC=x # comment\n# D=off\nE='sk#1'\n");
check('.env parsing', Ai::parseDotenv($env) === ['A' => '1', 'B' => 'two words', 'C' => 'x', 'E' => 'sk#1']);
unlink($env);

$in = ['text' => 'hi', 'images' => [['mediaType' => 'image/jpeg', 'data' => 'AAAA']], 'toolResults' => [['id' => 't1', 'content' => 'ok']]];
$a = Ai::anthropicInput($in);
check('anthropic: tool results first, then image, then text', array_column($a['content'], 'type') === ['tool_result', 'image', 'text']);
check('anthropic: nothing to send', Ai::anthropicInput([]) === null);
$o = Ai::openaiInput(array_merge($in, ['toolResults' => []]));
check('openai: user message with text and image', count($o) === 1 && array_column($o[0]['content'], 'type') === ['text', 'image_url']);
$o = Ai::openaiInput(['toolResults' => [['id' => 'c1', 'content' => 'bad', 'isError' => true]]]);
check('openai: tool message, error marked', $o === [['role' => 'tool', 'tool_call_id' => 'c1', 'content' => 'Error: bad']]);

$blocks = [
    ['type' => 'thinking', 'thinking' => '', 'signature' => 's1'],
    ['type' => 'text', 'text' => 'partial'],
    ['type' => 'tool_use', 'id' => 'x', 'name' => 'n', 'input' => new stdClass()],
    ['type' => 'fallback'],
    ['type' => 'thinking', 'thinking' => '', 'signature' => 's2'],
    ['type' => 'text', 'text' => ''],
    ['type' => 'text', 'text' => 'answer'],
];
$kept = Ai::echoableBlocks($blocks);
check('fallback: drops thinking and tool use before the marker, and empty text', array_column($kept, 'type') === ['text', 'fallback', 'thinking', 'text']);

echo ($failed ? 'FAIL' : 'PASS') . ' ' . ($count - $failed) . "/$count\n";
exit($failed ? 1 : 0);
