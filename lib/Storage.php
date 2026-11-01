<?php

declare(strict_types=1);

namespace CabForge;

/**
 * JSON-file storage for projects, the shop settings (material library +
 * construction standards) and the shop preferences (display units). Files live under data/, which .htaccess keeps
 * out of reach of the web.
 */
final class Storage
{
    private const ID_PATTERN = '/^[a-z0-9][a-z0-9-]{0,63}$/';

    public function __construct(private readonly string $dir)
    {
    }

    public static function validId(string $id): bool
    {
        return preg_match(self::ID_PATTERN, $id) === 1;
    }

    public function writable(): bool
    {
        return $this->ensureDir($this->dir) && is_writable($this->dir);
    }

    public function readShop(): ?object
    {
        return $this->read($this->dir . '/shop.json');
    }

    public function writeShop(object $shop): void
    {
        $this->write($this->dir . '/shop.json', $shop);
    }

    public function readPrefs(): ?object
    {
        return $this->read($this->dir . '/prefs.json');
    }

    public function writePrefs(object $prefs): void
    {
        $this->write($this->dir . '/prefs.json', $prefs);
    }

    /** @return list<array{id: string, name: string, updated: int}> newest first */
    public function listProjects(): array
    {
        $projects = [];
        foreach (glob($this->projectDir() . '/*.json') ?: [] as $path) {
            $id = basename($path, '.json');
            if (!self::validId($id)) {
                continue;
            }
            $project = $this->read($path);
            $projects[] = [
                'id' => $id,
                'name' => is_string($project->name ?? null) ? $project->name : $id,
                'updated' => (int) filemtime($path),
            ];
        }
        usort($projects, static fn (array $a, array $b): int => $b['updated'] <=> $a['updated']);
        return $projects;
    }

    public function readProject(string $id): ?object
    {
        return $this->read($this->projectPath($id));
    }

    public function writeProject(string $id, object $project): void
    {
        $project->id = $id;
        $this->write($this->projectPath($id), $project);
    }

    public function deleteProject(string $id): bool
    {
        $path = $this->projectPath($id);
        return is_file($path) && unlink($path);
    }

    private function projectDir(): string
    {
        return $this->dir . '/projects';
    }

    private function projectPath(string $id): string
    {
        if (!self::validId($id)) {
            throw new \InvalidArgumentException('Invalid project id');
        }
        return $this->projectDir() . '/' . $id . '.json';
    }

    private function read(string $path): ?object
    {
        if (!is_file($path)) {
            return null;
        }
        $raw = file_get_contents($path);
        if ($raw === false) {
            throw new \RuntimeException("Cannot read $path");
        }
        $data = json_decode($raw, false, 512, JSON_THROW_ON_ERROR);
        return is_object($data) ? $data : null;
    }

    /** Writes atomically: a temp file in the same directory, then rename. */
    private function write(string $path, object $data): void
    {
        $dir = dirname($path);
        if (!$this->ensureDir($dir)) {
            throw new \RuntimeException("Cannot create $dir");
        }
        $json = json_encode(
            $data,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
            | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR
        );
        $tmp = tempnam($dir, '.tmp-');
        if ($tmp === false || file_put_contents($tmp, $json, LOCK_EX) === false) {
            throw new \RuntimeException("Cannot write $path");
        }
        @chmod($tmp, 0664);
        if (!rename($tmp, $path)) {
            @unlink($tmp);
            throw new \RuntimeException("Cannot replace $path");
        }
    }

    private function ensureDir(string $dir): bool
    {
        return is_dir($dir) || mkdir($dir, 0775, true) || is_dir($dir);
    }
}
