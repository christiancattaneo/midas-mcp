/**
 * GitHub OAuth Device Flow Authentication
 * 
 * Provides CLI-based GitHub authentication similar to `gh auth login`.
 * Uses the device flow which is ideal for CLI tools without a web server.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.midas');
const AUTH_FILE = join(CONFIG_DIR, 'auth.json');

// GitHub OAuth App credentials (register at github.com/settings/developers)
// These are public client IDs - safe to commit
const GITHUB_CLIENT_ID = process.env.MIDAS_GITHUB_CLIENT_ID || 'Ov23liUFW5zWcrGH72tV';

export interface AuthState {
  githubAccessToken?: string;
  githubUsername?: string;
  githubUserId?: number;
  githubAvatarUrl?: string;
  authenticatedAt?: string;
  expiresAt?: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadAuth(): AuthState {
  ensureConfigDir();
  
  if (!existsSync(AUTH_FILE)) {
    return {};
  }
  
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveAuth(auth: AuthState): void {
  ensureConfigDir();
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
}

export function clearAuth(): void {
  saveAuth({});
}

export function isAuthenticated(): boolean {
  const auth = loadAuth();
  return !!auth.githubAccessToken && !!auth.githubUsername;
}

export function getAuthenticatedUser(): { username: string; userId: number } | null {
  const auth = loadAuth();
  if (!auth.githubUsername || !auth.githubUserId) return null;
  return { username: auth.githubUsername, userId: auth.githubUserId };
}

/**
 * Start GitHub device flow authentication
 * Returns device code info for user to complete in browser
 */
export async function startDeviceFlow(): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      scope: 'read:user',
    }),
  });
  
  if (!response.ok) {
    throw new Error(`GitHub device flow failed: ${response.status}`);
  }
  
  const data = await response.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
  
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

/**
 * Poll for token after user authorizes
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onPoll?: () => void
): Promise<string> {
  const startTime = Date.now();
  const expiresAt = startTime + expiresIn * 1000;
  
  while (Date.now() < expiresAt) {
    if (onPoll) onPoll();
    
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
    
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    
    if (!response.ok) continue;
    
    const data = await response.json() as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    
    if (data.access_token) {
      return data.access_token;
    }
    
    if (data.error === 'authorization_pending') {
      continue;
    }
    
    if (data.error === 'slow_down') {
      interval += 5;
      continue;
    }
    
    if (data.error === 'expired_token') {
      throw new Error('Device code expired. Please try again.');
    }
    
    if (data.error === 'access_denied') {
      throw new Error('Access denied. User cancelled authorization.');
    }
    
    throw new Error(data.error_description || data.error || 'Unknown error');
  }
  
  throw new Error('Authorization timed out. Please try again.');
}

/**
 * Get GitHub user info from access token
 */
export async function getGitHubUser(accessToken: string): Promise<{
  login: string;
  id: number;
  avatar_url: string;
}> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }
  
  return response.json() as Promise<{ login: string; id: number; avatar_url: string }>;
}

/**
 * Complete authentication flow
 * Saves token and user info to ~/.midas/auth.json
 */
export async function completeAuth(accessToken: string): Promise<AuthState> {
  const user = await getGitHubUser(accessToken);
  
  const auth: AuthState = {
    githubAccessToken: accessToken,
    githubUsername: user.login,
    githubUserId: user.id,
    githubAvatarUrl: user.avatar_url,
    authenticatedAt: new Date().toISOString(),
  };
  
  saveAuth(auth);
  return auth;
}

/**
 * Interactive login flow for CLI
 */
export async function login(): Promise<AuthState> {
  console.log('\n  Starting GitHub authentication...\n');
  
  const flow = await startDeviceFlow();
  
  console.log('  ┌─────────────────────────────────────────────────┐');
  console.log('  │  GitHub Device Authorization                    │');
  console.log('  ├─────────────────────────────────────────────────┤');
  console.log('  │                                                 │');
  console.log(`  │  1. Copy this code:  ${flow.userCode.padEnd(27)}│`);
  console.log('  │                                                 │');
  console.log(`  │  2. Open: ${flow.verificationUri.padEnd(38)}│`);
  console.log('  │                                                 │');
  console.log('  │  3. Paste the code and authorize                │');
  console.log('  │                                                 │');
  console.log('  └─────────────────────────────────────────────────┘');
  console.log('\n  Waiting for authorization...');
  
  // Try to open browser automatically
  try {
    const { exec } = await import('child_process');
    const openCmd = process.platform === 'darwin' ? 'open' :
                    process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${openCmd} ${flow.verificationUri}`);
  } catch {
    // Silent fail - user can manually open URL
  }
  
  let dots = 0;
  const accessToken = await pollForToken(
    flow.deviceCode,
    flow.interval,
    flow.expiresIn,
    () => {
      process.stdout.write(`\r  Waiting for authorization${''.padEnd(dots % 4, '.')}    `);
      dots++;
    }
  );
  
  const auth = await completeAuth(accessToken);
  
  console.log(`\n\n  ✓ Logged in as @${auth.githubUsername}\n`);
  
  return auth;
}

/**
 * Logout - clear saved credentials
 */
export function logout(): void {
  clearAuth();
  console.log('\n  ✓ Logged out successfully\n');
}
