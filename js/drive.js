// Google Drive v3 REST 어댑터. 토큰은 getToken()이 돌려준다.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,modifiedTime,md5Checksum';

export class AuthError extends Error {
  constructor(message = '로그인이 필요합니다') {
    super(message);
    this.name = 'AuthError';
  }
}

export class GoogleDrive {
  constructor({ getToken, folderId = null, fetchImpl = (...a) => fetch(...a) }) {
    this.getToken = getToken;
    this.folderId = folderId;
    this.fetch = fetchImpl;
  }

  async _request(url, init = {}) {
    const token = await this.getToken();
    const res = await this.fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new AuthError('인증이 만료되었습니다');
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Drive ${res.status}: ${detail.slice(0, 200)}`);
    }
    return res;
  }

  async list() {
    const files = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `'${this.folderId}' in parents and trashed = false`,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: '1000',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await (await this._request(`${API}/files?${params}`)).json();
      files.push(...(data.files || []));
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return files;
  }

  async read(fileId) {
    return (await this._request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).text();
  }

  async create(name, text) {
    const boundary = `appsyncmemo${Math.random().toString(16).slice(2)}`;
    const metadata = JSON.stringify({ name, parents: [this.folderId], mimeType: 'application/json' });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
      + `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
    const res = await this._request(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return res.json();
  }

  async update(fileId, text) {
    const res = await this._request(
      `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${FILE_FIELDS}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: text },
    );
    return res.json();
  }

  // 설정 화면에서 동기화 폴더를 고를 때 쓴다. 이름에 query가 들어간 폴더를 찾는다.
  async searchFolders(query) {
    const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const params = new URLSearchParams({
      q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and name contains '${escaped}'`,
      fields: 'files(id,name,modifiedTime,parents)',
      pageSize: '30',
      orderBy: 'modifiedTime desc',
    });
    const data = await (await this._request(`${API}/files?${params}`)).json();
    return data.files || [];
  }
}
