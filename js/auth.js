// Google Identity Services 토큰 방식. 서버도 클라이언트 시크릿도 필요 없다.
import { AuthError } from './drive.js';

// 데스크탑 Drive 폴더의 파일을 읽으려면 전체 Drive 범위가 필요하다.
// (drive.file 범위는 이 앱이 만든 파일만 보여 준다.)
export const SCOPE = 'https://www.googleapis.com/auth/drive';
const TOKEN_KEY = 'appsyncmemo.token';
const GSI_SRC = 'https://accounts.google.com/gsi/client';
const EXPIRY_MARGIN_MS = 60_000;

let gsiPromise = null;

function loadGsi() {
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      if (globalThis.google?.accounts?.oauth2) return resolve();
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { gsiPromise = null; reject(new Error('Google 로그인 스크립트를 불러오지 못했습니다 (오프라인?)')); };
      document.head.appendChild(script);
    });
  }
  return gsiPromise;
}

function readStored() {
  try {
    const token = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (token?.accessToken && token.expiresAt > Date.now() + EXPIRY_MARGIN_MS) return token;
  } catch { /* 깨진 값은 무시 */ }
  return null;
}

export function hasValidToken() {
  return readStored() !== null;
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function signOut() {
  const token = readStored();
  clearToken();
  if (token && globalThis.google?.accounts?.oauth2) globalThis.google.accounts.oauth2.revoke(token.accessToken, () => {});
}

function requestToken(clientId, prompt) {
  return loadGsi().then(() => new Promise((resolve, reject) => {
    const client = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt,
      callback: (res) => {
        if (res.error || !res.access_token) return reject(new AuthError(res.error_description || res.error || '로그인 실패'));
        const token = { accessToken: res.access_token, expiresAt: Date.now() + Number(res.expires_in || 3600) * 1000 };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        resolve(token);
      },
      error_callback: (err) => reject(new AuthError(err?.message || err?.type || '로그인 창이 닫혔습니다')),
    });
    client.requestAccessToken();
  }));
}

// interactive=false: 저장된 토큰이 없으면 팝업 없이 조용히 갱신만 시도한다. 실패하면 AuthError
// interactive=true : 버튼을 누른 직후에 호출해야 한다. (팝업 차단 방지)
export async function getAccessToken(clientId, { interactive = false } = {}) {
  if (!clientId) throw new AuthError('클라이언트 ID가 설정되지 않았습니다');
  const stored = readStored();
  if (stored) return stored.accessToken;
  const token = await requestToken(clientId, interactive ? 'select_account' : 'none');
  return token.accessToken;
}
