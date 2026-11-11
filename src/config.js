import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// settings.json: 공개해도 되는 알림 조건 (저장소에 커밋)
// 비밀값(텔레그램 토큰·채팅 ID)은 환경변수 / GitHub Secrets 로만 받음
export function loadConfig() {
  const c = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8').replace(/^﻿/, ''));
  c.telegram = { botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID };
  return c;
}
