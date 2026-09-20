import { HttpError } from './errors.js';

/** One finished result on the AudioExtract server. */
export interface RemoteFile {
  path: string;
  name: string;
  size: number;
  updatedAt: string;
}

const TIMEOUT_MS = 30_000;

/**
 * Thin client for the AudioExtract server on the docker network.
 *
 * Paths there are `<taskDir>/<filename>` and its rename endpoint only ever changes
 * the basename, so the directory is a stable id for a result across renames — that
 * is what lets Musik recognise a file it already imported.
 */
export interface AudioExtractClient {
  readonly configured: boolean;
  listFiles(): Promise<RemoteFile[]>;
  fetchFile(path: string): Promise<Response>;
  /** Best effort: the new path, or null when the remote refused (gone, name clash, unreachable). */
  rename(path: string, name: string): Promise<{ path: string; name: string } | null>;
}

/** The directory half of a remote path — stable while the file gets renamed. */
export const sourceIdOf = (remotePath: string) => remotePath.split('/')[0] ?? '';

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export function createAudioExtractClient(baseUrl?: string): AudioExtractClient {
  const base = baseUrl?.replace(/\/$/, '');

  const request = async (route: string, init?: RequestInit): Promise<Response> => {
    if (!base) throw new HttpError(404, 'AudioExtract is not configured');
    let res: Response;
    try {
      res = await fetch(`${base}${route}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new HttpError(502, `AudioExtract unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        // keep status text
      }
      throw new HttpError(502, `AudioExtract: ${message}`);
    }
    return res;
  };

  return {
    configured: Boolean(base),
    listFiles: async () => (await (await request('/api/files')).json()) as RemoteFile[],
    fetchFile: (p: string) => request(`/api/files/${encodePath(p)}`),
    rename: async (p: string, name: string) => {
      if (!base) return null;
      try {
        const res = await request('/api/files/rename', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: p, name }),
        });
        return (await res.json()) as { path: string; name: string };
      } catch {
        // A rename in the other app must never fail the edit the user made here.
        return null;
      }
    },
  };
}
